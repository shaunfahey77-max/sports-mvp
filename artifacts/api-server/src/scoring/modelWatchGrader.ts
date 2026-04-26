/**
 * Model-Watch grader.
 *
 * For markets in MARKET_MODEL_WATCH_ONLY (currently nhl_spread and
 * mlb_moneyline) the scoring pipeline writes a candidate row to
 * candidate_bets with selection_reason='model_watch_only' but never lets
 * those candidates enter scored_picks (so they cannot leak into the
 * public Performance / History numbers).
 *
 * This grader replays what would have happened if those markets were
 * Official picks: it re-runs assignTier WITHOUT the model_watch_only
 * override (so we see the would-be tier), grades the outcome via
 * computeOutcomeResult, computes CLV via computeClvWritebackValues, and
 * upserts the row into model_watch_results. That table is the internal
 * scoreboard consumed only by /admin/model-watch/performance.
 *
 * Reuses computeOutcomeResult and computeClvWritebackValues so this code
 * stays in lockstep with the live nightly settlement path.
 */

import { db } from "@workspace/db";
import {
  candidateBetsTable,
  gameSnapshotsTable,
  modelWatchResultsTable,
  type GameSnapshot,
  type CandidateBet,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { computeOutcomeResult } from "./validatePicks";
import { computeClvWritebackValues } from "./clvWriteback";
import { assignTier } from "./assignTiers";
import {
  MARKET_MODEL_WATCH_ONLY,
  ODDS_RANGE_GUARDRAIL_LEAGUES,
  type League,
  type MarketType,
} from "../config/scoringModelConfig";
import { logger } from "../lib/logger";

export interface ModelWatchGradeResult {
  graded: number;
  skipped: number;
}

function parseNumOrNull(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Grade every Model-Watch candidate attached to one settled game snapshot.
 * No-op when the snapshot has no final score.
 *
 * Returns the number of rows upserted into model_watch_results.
 */
export async function gradeModelWatchForSnapshot(
  snap: GameSnapshot
): Promise<ModelWatchGradeResult> {
  const out: ModelWatchGradeResult = { graded: 0, skipped: 0 };
  if (snap.homeScore == null || snap.awayScore == null) return out;

  const candidates = await db
    .select()
    .from(candidateBetsTable)
    .where(
      and(
        eq(candidateBetsTable.gameKey, snap.gameKey),
        eq(candidateBetsTable.selectionReason, "model_watch_only")
      )
    );

  for (const c of candidates) {
    const marketKey = `${c.league}_${c.marketType}`;
    // Defensive: only grade markets currently in the registry. Toggling a
    // market off the registry should NOT cause new internal rows to be
    // graded for it (existing rows are kept for historical comparison).
    if (!MARKET_MODEL_WATCH_ONLY[marketKey]) {
      out.skipped++;
      continue;
    }

    const upserted = await gradeOneCandidate(snap, c);
    if (upserted) out.graded++;
    else out.skipped++;
  }
  return out;
}

/**
 * Re-tier a single Model-Watch candidate as if the override were lifted.
 * Returns true when a row was upserted; false when the candidate would
 * have been PASS-by-risk-control (no Official pick → nothing to grade).
 */
async function gradeOneCandidate(
  snap: GameSnapshot,
  c: CandidateBet
): Promise<boolean> {
  const league = c.league as League;
  const marketType = c.marketType as MarketType;
  const publishOdds = parseFloat(c.publishOdds);
  const publishLine = parseNumOrNull(c.publishLine);

  const { tier } = assignTier({
    rankScore: parseFloat(c.rankScore),
    edge: parseFloat(c.edge),
    ev: parseFloat(c.ev),
    marketQuality: parseFloat(c.marketQuality),
    league,
    marketType,
    publishOdds,
    publishLine,
    enableOddsRangeGuardrail: (
      ODDS_RANGE_GUARDRAIL_LEAGUES as readonly League[]
    ).includes(league),
  });

  if (tier === "PASS") return false;

  const result = computeOutcomeResult({
    market: marketType,
    pick: c.side,
    homeScore: snap.homeScore!,
    awayScore: snap.awayScore!,
    homeSpread: parseNumOrNull(snap.publishSpread),
    total: parseNumOrNull(snap.publishTotal),
  });

  const clv = computeClvWritebackValues(
    {
      market: marketType,
      pick: c.side,
      publishOdds: c.publishOdds,
      publishLine: c.publishLine,
    },
    {
      homeCloseMl: snap.homeCloseMl,
      awayCloseMl: snap.awayCloseMl,
      closeSpread: snap.closeSpread,
      closeSpreadLine: snap.closeSpreadLine,
      closeAwaySpreadLine: snap.closeAwaySpreadLine,
      closeTotal: snap.closeTotal,
      closeOverLine: snap.closeOverLine,
      closeUnderLine: snap.closeUnderLine,
    }
  );

  await db
    .insert(modelWatchResultsTable)
    .values({
      date: c.snapshotDate,
      gameKey: c.gameKey,
      league: c.league,
      market: c.marketType,
      pick: c.side,
      tier,
      publishOdds: c.publishOdds,
      publishLine: c.publishLine ?? undefined,
      modelProbCalibrated: c.modelProbCalibrated,
      edge: c.edge,
      ev: c.ev,
      rankScore: c.rankScore,
      result,
      closeOdds: clv.closeOdds,
      closeLine: clv.closeLine,
      clvImpliedDelta: clv.clvImpliedDelta,
      clvLineDelta: clv.clvLineDelta,
      eventStart: c.eventStart,
      modelVersion: c.modelVersion,
      scoringVersion: "v1",
    })
    .onConflictDoUpdate({
      target: [
        modelWatchResultsTable.date,
        modelWatchResultsTable.gameKey,
        modelWatchResultsTable.market,
        modelWatchResultsTable.pick,
      ],
      set: {
        tier,
        publishOdds: sql`EXCLUDED.publish_odds`,
        publishLine: sql`EXCLUDED.publish_line`,
        modelProbCalibrated: sql`EXCLUDED.model_prob_calibrated`,
        edge: sql`EXCLUDED.edge`,
        ev: sql`EXCLUDED.ev`,
        rankScore: sql`EXCLUDED.rank_score`,
        result,
        closeOdds: clv.closeOdds,
        closeLine: clv.closeLine,
        clvImpliedDelta: clv.clvImpliedDelta,
        clvLineDelta: clv.clvLineDelta,
        updatedAt: new Date(),
      },
    });

  return true;
}

/**
 * Sweep all final game snapshots in [startDate, endDate] and re-grade
 * their Model-Watch candidates. Used by the admin endpoint to backfill
 * historical evidence (since the live cron only grades new finals going
 * forward) and to repair after registry / threshold changes.
 *
 * Idempotent: re-running over the same window updates rows in place.
 */
export async function backfillModelWatchResults(
  startDate: string,
  endDate: string
): Promise<ModelWatchGradeResult & { snapshotsScanned: number }> {
  const totals = { graded: 0, skipped: 0, snapshotsScanned: 0 };

  const snaps = await db
    .select()
    .from(gameSnapshotsTable)
    .where(
      and(
        eq(gameSnapshotsTable.status, "final"),
        sql`${gameSnapshotsTable.snapshotDate} >= ${startDate}`,
        sql`${gameSnapshotsTable.snapshotDate} <= ${endDate}`
      )
    );

  for (const snap of snaps) {
    if (snap.homeScore == null || snap.awayScore == null) continue;
    totals.snapshotsScanned++;
    try {
      const r = await gradeModelWatchForSnapshot(snap);
      totals.graded += r.graded;
      totals.skipped += r.skipped;
    } catch (err) {
      logger.error(
        { gameKey: snap.gameKey, err },
        "Model-Watch grader: error grading snapshot"
      );
    }
  }

  return totals;
}
