/**
 * Nightly Model-Watch promotion-alert check.
 *
 * Reads `model_watch_results`, aggregates it the same way the admin
 * scoreboard does (so the numbers an alert quotes match what an admin
 * sees on /admin/model-watch/performance), and fires a notification for
 * any (league, market) bucket whose OVERALL totals clear all three
 * thresholds in MODEL_WATCH_ALERT_THRESHOLDS.
 *
 * Idempotency comes from the unique (league, market) index on
 * `model_watch_alerts`: we INSERT ... ON CONFLICT DO NOTHING and only
 * the rows that were actually inserted get a notification log line, so
 * subsequent nightly runs do not re-spam an already-promotable bucket.
 *
 * The aggregation lives in the existing pure helper (aggregateByLeagueMarket)
 * so the metrics here always match the scoreboard. The only Model-Watch
 * specific logic added by this file is:
 *   1. evaluateModelWatchAlerts — pure threshold check (unit-tested)
 *   2. runModelWatchAlertCheck  — DB read/write wrapper called by cron
 */

import { db } from "@workspace/db";
import {
  evaluationResultsTable,
  modelWatchAlertsTable,
  type ModelWatchAlert,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  MARKET_MODEL_WATCH_ONLY,
  MODEL_WATCH_ALERT_THRESHOLDS,
  type ModelWatchAlertThresholds,
} from "../config/scoringModelConfig";
import {
  aggregateByLeagueMarket,
  type AggregatorRow,
  type MarketBucket,
} from "./modelWatchAggregator";
import { resolveMarketKeysForSurfaceStatus } from "./marketRegistryResolver";
import { logger } from "../lib/logger";

export interface AlertCandidate {
  league: string;
  market: string;
  resolved: number;
  roi: number;
  avgClv: number;
  winRate: number;
  /** clvSampleSize attached so the persisted snapshot is self-contained. */
  clvSampleSize: number;
}

/**
 * Pure threshold check. Returns one entry per bucket whose OVERALL
 * totals clear ALL three thresholds. Buckets without enough resolved
 * sample, or without a clean CLV sample, do not fire.
 *
 * Evaluating against `total` (not `byTier`) intentionally — promotion
 * is about the market as a whole; a single-tier hot streak should not
 * trigger a promotion conversation.
 */
export function evaluateModelWatchAlerts(
  buckets: readonly MarketBucket[],
  thresholds: ModelWatchAlertThresholds = MODEL_WATCH_ALERT_THRESHOLDS
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const b of buckets) {
    const t = b.total;
    if (t.resolved < thresholds.minResolved) continue;
    // Guard against firing on ROI alone with zero usable CLV sample —
    // CLV is the leading indicator we care about, so we require at
    // least one clean CLV row before evaluating mean CLV.
    if (t.clvSampleSize <= 0) continue;
    if (t.roi < thresholds.minRoi) continue;
    if (t.avgClv < thresholds.minAvgClv) continue;
    out.push({
      league: b.league,
      market: b.market,
      resolved: t.resolved,
      roi: t.roi,
      avgClv: t.avgClv,
      winRate: t.winRate,
      clvSampleSize: t.clvSampleSize,
    });
  }
  return out;
}

export interface ModelWatchAlertCheckResult {
  bucketsEvaluated: number;
  qualifying: number;
  /** Rows actually persisted this run (i.e. first-time alerts). */
  newAlerts: ModelWatchAlert[];
}

/**
 * DB-backed runner: aggregates `model_watch_results`, evaluates the
 * thresholds, and persists a row in `model_watch_alerts` for any bucket
 * that has just earned promotion attention. Only the just-inserted rows
 * are surfaced as `newAlerts`; the unique index makes re-firing a no-op.
 *
 * Always logs the count of qualifying buckets and the count of new
 * alerts so the nightly job's behaviour is visible even on quiet nights.
 */
export async function runModelWatchAlertCheck(
  thresholds: ModelWatchAlertThresholds = MODEL_WATCH_ALERT_THRESHOLDS
): Promise<ModelWatchAlertCheckResult> {
  const rows = await db
    .select()
    .from(evaluationResultsTable)
    .where(eq(evaluationResultsTable.surfaceStatus, "model_watch"));

  const aggRows: AggregatorRow[] = rows.map((r) => ({
    league: r.league,
    market: r.market,
    tier: r.tier,
    publishOdds: r.publishOdds,
    edge: r.edge,
    ev: r.ev,
    result: r.result,
    clvImpliedDelta: r.clvImpliedDelta,
  }));

  const fallbackRegistryKeys = Object.entries(MARKET_MODEL_WATCH_ONLY)
    .filter(([, enabled]) => enabled)
    .map(([k]) => k);
  const registryResolution = await resolveMarketKeysForSurfaceStatus(
    "model_watch",
    fallbackRegistryKeys,
    { requireRegistry: true },
  );

  const buckets = aggregateByLeagueMarket(aggRows, registryResolution.keys);
  const qualifying = evaluateModelWatchAlerts(buckets, thresholds);

  const newAlerts: ModelWatchAlert[] = [];
  for (const c of qualifying) {
    // ON CONFLICT DO NOTHING + .returning() returns ONLY the rows that
    // were actually inserted, so first-fire detection is exact even
    // under concurrent runs (the unique index serialises us).
    const inserted = await db
      .insert(modelWatchAlertsTable)
      .values({
        league: c.league,
        market: c.market,
        resolvedSamples: c.resolved,
        roi: String(c.roi),
        avgClv: String(c.avgClv),
        winRate: String(c.winRate),
        metrics: {
          resolved: c.resolved,
          roi: c.roi,
          avgClv: c.avgClv,
          winRate: c.winRate,
          clvSampleSize: c.clvSampleSize,
        },
        thresholds,
      })
      .onConflictDoNothing({
        target: [
          modelWatchAlertsTable.league,
          modelWatchAlertsTable.market,
        ],
      })
      .returning();

    if (inserted.length > 0) {
      newAlerts.push(inserted[0]);
      logger.warn(
        {
          league: c.league,
          market: c.market,
          resolved: c.resolved,
          roi: c.roi,
          avgClv: c.avgClv,
          winRate: c.winRate,
          clvSampleSize: c.clvSampleSize,
          thresholds,
        },
        "model-watch alert: bucket cleared promotion thresholds"
      );
    }
  }

  logger.info(
    {
      bucketsEvaluated: buckets.length,
      qualifying: qualifying.length,
      newAlerts: newAlerts.length,
      registrySource: registryResolution.source,
    },
    "model-watch alert check complete"
  );

  return {
    bucketsEvaluated: buckets.length,
    qualifying: qualifying.length,
    newAlerts,
  };
}
