/**
 * Cron service — two scheduled jobs:
 *  1. Every 10 minutes: ingest the latest NBA/NHL odds and refresh today's picks.
 *  2. Daily at 3:30 AM: finalize close odds, score, and validate completed games.
 */

import cron from "node-cron";
import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
  validationMetricsTable,
} from "@workspace/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { computeValidationMetrics, type PickWithFullData } from "../scoring/validatePicks";
import { logger } from "../lib/logger";
import { capAndSort, computeStaleScoredPicksKeys } from "../lib/pickUtils";
import {
  isOfficialCandidate,
  scorePicks,
  type GameMarketInput,
} from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import { computeClvWritebackValues } from "../scoring/clvWriteback";
import { gradeModelWatchForSnapshot } from "../scoring/modelWatchGrader";
import {
  deletePendingOfficialEvaluationResult,
  settleOfficialEvaluationResult,
  upsertOfficialCandidateEvaluation,
} from "../scoring/officialEvaluationWriter";
import { runModelWatchAlertCheck } from "../scoring/modelWatchAlerts";
import { fetchOdds, fetchScores, transformGame, SPORT_KEYS } from "../lib/oddsApi";
import type { League, MarketType } from "../config/scoringModelConfig";
import { ODDS_RANGE_GUARDRAIL_LEAGUES } from "../config/scoringModelConfig";
import { fetchEspnScores } from "./historicalIngest";

const LEAGUES: League[] = ["nba", "nhl", "mlb"];
const MARKETS: MarketType[] = ["moneyline", "spread", "total"];

// Per-league markets override. MLB is in Phase 0.75D foundation: only
// moneyline is wired (no run line / total models exist). Restricting the
// markets list at the cron level avoids a `getModel` throw and matches
// the defensive `MARKET_DISABLED` entries for mlb_spread / mlb_total.
const MARKETS_BY_LEAGUE: Partial<Record<League, MarketType[]>> = {
  mlb: ["moneyline"],
};

function deriveCloseSource(bestBooks: {
  moneylineHome?: string;
  moneylineAway?: string;
  spreadHome?: string;
  spreadAway?: string;
  totalOver?: string;
  totalUnder?: string;
} | null | undefined): string {
  if (!bestBooks) return "unknown";
  const unique = Array.from(
    new Set(
      Object.values(bestBooks)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim()),
    ),
  ).sort();
  return unique.length > 0 ? unique.join(",") : "unknown";
}

// ---------------------------------------------------------------------------
// Job 1 — Every 10 minutes: ingest latest odds → refresh picks
// ---------------------------------------------------------------------------
async function runOddsIngest(): Promise<void> {
  const jobId = `ingest-${Date.now()}`;
  logger.info({ jobId }, "Cron: starting odds ingest");

  let totalGames = 0;
  let totalPicks = 0;

  for (const league of LEAGUES) {
    const sportKey = SPORT_KEYS[league];
    if (!sportKey) continue;

    try {
      const { data: games, headers } = await fetchOdds(sportKey);
      const snapshots: GameMarketInput[] = [];

      for (const game of games) {
        const snap = transformGame(game, league);
        if (!snap) continue;

        const now = new Date();
        const eventStart = new Date(snap.eventStart);

        // Determine if this is still an open game (before or after start but not final)
        const isInProgress = eventStart <= now;

        // Upsert the snapshot — if game already started, also store close odds
        await db
          .insert(gameSnapshotsTable)
          .values({
            gameKey: snap.gameKey,
            league: snap.league,
            eventStart: eventStart,
            homeTeam: snap.homeTeam,
            awayTeam: snap.awayTeam,
            homePublishMl: String(snap.homePublishMl),
            awayPublishMl: String(snap.awayPublishMl),
            publishSpread: snap.publishSpread != null ? String(snap.publishSpread) : undefined,
            publishSpreadLine: snap.publishSpreadLine != null ? String(snap.publishSpreadLine) : undefined,
            publishAwaySpreadLine: snap.publishAwaySpreadLine != null ? String(snap.publishAwaySpreadLine) : undefined,
            publishTotal: snap.publishTotal != null ? String(snap.publishTotal) : undefined,
            publishOverLine: snap.publishOverLine != null ? String(snap.publishOverLine) : undefined,
            publishUnderLine: snap.publishUnderLine != null ? String(snap.publishUnderLine) : undefined,
            bestBooks: snap.bestBooks,
            status: "scheduled",
            snapshotDate: snap.snapshotDate,
          })
          .onConflictDoUpdate({
            target: gameSnapshotsTable.gameKey,
            set: {
              homePublishMl: String(snap.homePublishMl),
              awayPublishMl: String(snap.awayPublishMl),
              publishSpread: snap.publishSpread != null ? String(snap.publishSpread) : undefined,
              publishSpreadLine: snap.publishSpreadLine != null ? String(snap.publishSpreadLine) : undefined,
              publishAwaySpreadLine: snap.publishAwaySpreadLine != null ? String(snap.publishAwaySpreadLine) : undefined,
              publishTotal: snap.publishTotal != null ? String(snap.publishTotal) : undefined,
              publishOverLine: snap.publishOverLine != null ? String(snap.publishOverLine) : undefined,
              publishUnderLine: snap.publishUnderLine != null ? String(snap.publishUnderLine) : undefined,
              bestBooks: snap.bestBooks,
              // CLV-integrity fix (2026-04-26): the in-progress branch used to copy
              // publish_* into close_* here. That short-circuited true CLV: every
              // settled pick saw close_odds == publish_odds, so clv_implied_delta was
              // mechanically 0 (or null). The dedicated `runClosingOddsCapture` cron
              // (every 2 min) is now the *single writer* of close_* fields, sourced
              // from a fresh Odds API poll near event_start. See cronService.ts
              // runClosingOddsCapture and scripts/backfillCloseOdds45d.ts.
              updatedAt: new Date(),
            },
          });

        // Only score games that haven't started yet
        if (!isInProgress) {
          snapshots.push({
            gameKey: snap.gameKey,
            league: snap.league as League,
            eventStart: eventStart,
            homeTeam: snap.homeTeam,
            awayTeam: snap.awayTeam,
            homePublishMl: snap.homePublishMl,
            awayPublishMl: snap.awayPublishMl,
            publishSpread: snap.publishSpread,
            publishSpreadLine: snap.publishSpreadLine,
            publishAwaySpreadLine: snap.publishAwaySpreadLine,
            publishTotal: snap.publishTotal,
            publishOverLine: snap.publishOverLine,
            publishUnderLine: snap.publishUnderLine,
            snapshotDate: snap.snapshotDate,
          });
          totalGames++;
        }
      }

      if (snapshots.length === 0) continue;

      // Re-score all upcoming games to pick up updated odds. MLB only
      // runs moneyline in Phase 0.75D — see MARKETS_BY_LEAGUE rationale.
      const marketsForLeague = MARKETS_BY_LEAGUE[league] ?? MARKETS;
      const candidates = await scorePicks(snapshots, marketsForLeague, "v1", {
        oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
      });
      // Sort by rankScore DESC before capping so the best picks per league/game are kept
      const picks = capAndSort(
        candidates
          .filter((c) => isOfficialCandidate(c))
          .sort((a, b) => b.rankScore - a.rankScore)
      );
      const date = snapshots[0]?.snapshotDate ?? new Date().toISOString().split("T")[0];

      // Upsert candidates — update scoring data if odds have moved since last run
      if (candidates.length > 0) {
        await db
          .insert(candidateBetsTable)
          .values(
            candidates.map((c) => ({
              gameKey: c.gameKey,
              league: c.league,
              marketType: c.marketType,
              side: c.side,
              eventStart: c.eventStart,
              publishOdds: String(c.publishOdds),
              publishLine: c.publishLine != null ? String(c.publishLine) : undefined,
              modelProbRaw: String(c.modelProbRaw),
              modelProbCalibrated: String(c.modelProbCalibrated),
              marketProbFair: String(c.marketProbFair),
              edge: String(c.edge),
              ev: String(c.ev),
              rankScore: String(c.rankScore),
              tier: c.tier,
              calibrationMethod: c.calibrationMethod,
              calibrationVersion: c.calibrationVersion,
              marketQuality: String(c.marketQuality),
              selectionReason: c.selectionReason,
              surfaceStatus: c.surfaceStatus ?? "shadow",
              snapshotDate: date,
              modelVersion: "v1",
            }))
          )
          .onConflictDoUpdate({
            target: [
              candidateBetsTable.snapshotDate,
              candidateBetsTable.gameKey,
              candidateBetsTable.marketType,
              candidateBetsTable.side,
            ],
            set: {
              publishOdds: sql`EXCLUDED.publish_odds`,
              publishLine: sql`EXCLUDED.publish_line`,
              modelProbRaw: sql`EXCLUDED.model_prob_raw`,
              modelProbCalibrated: sql`EXCLUDED.model_prob_calibrated`,
              marketProbFair: sql`EXCLUDED.market_prob_fair`,
              edge: sql`EXCLUDED.edge`,
              ev: sql`EXCLUDED.ev`,
              rankScore: sql`EXCLUDED.rank_score`,
              tier: sql`EXCLUDED.tier`,
              selectionReason: sql`EXCLUDED.selection_reason`,
              surfaceStatus: sql`EXCLUDED.surface_status`,
            },
          });
      }

      // Upsert scored picks (pending only for future games)
      // Use onConflictDoUpdate so odds changes and eventStart are always refreshed.
      // Never overwrite result/closeOdds — those are set by the validation job.
      if (picks.length > 0) {
        for (const c of picks) {
          await upsertOfficialCandidateEvaluation(c);
        }
        await db
          .insert(scoredPicksTable)
          .values(
            picks.map((c) => ({
              date: c.snapshotDate,
              gameKey: c.gameKey,
              league: c.league,
              market: c.marketType,
              pick: c.side,
              result: "pending",
              publishOdds: String(c.publishOdds),
              publishLine: c.publishLine != null ? String(c.publishLine) : undefined,
              modelProbRaw: String(c.modelProbRaw),
              modelProbCalibrated: String(c.modelProbCalibrated),
              marketProbFair: String(c.marketProbFair),
              edge: String(c.edge),
              ev: String(c.ev),
              rankScore: String(c.rankScore),
              tier: c.tier,
              eventStart: c.eventStart,
              modelVersion: "v1",
              scoringVersion: "v1",
            }))
          )
          .onConflictDoUpdate({
            target: [scoredPicksTable.date, scoredPicksTable.gameKey, scoredPicksTable.market, scoredPicksTable.pick],
            set: {
              publishOdds: sql`EXCLUDED.publish_odds`,
              publishLine: sql`EXCLUDED.publish_line`,
              modelProbRaw: sql`EXCLUDED.model_prob_raw`,
              modelProbCalibrated: sql`EXCLUDED.model_prob_calibrated`,
              marketProbFair: sql`EXCLUDED.market_prob_fair`,
              edge: sql`EXCLUDED.edge`,
              ev: sql`EXCLUDED.ev`,
              rankScore: sql`EXCLUDED.rank_score`,
              tier: sql`EXCLUDED.tier`,
              eventStart: sql`EXCLUDED.event_start`,
              updatedAt: new Date(),
            },
          });
        totalPicks += picks.length;
      }

      // Reconcile: remove pending scored_picks rows for candidates that
      // are now PASS this run (e.g. odds-range guardrail flipped them).
      const staleKeys = computeStaleScoredPicksKeys(candidates);
      for (const k of staleKeys) {
        await deletePendingOfficialEvaluationResult({
          date,
          gameKey: k.gameKey,
          market: k.market,
          pick: k.pick,
        });
        await db
          .delete(scoredPicksTable)
          .where(
            and(
              eq(scoredPicksTable.date, date),
              eq(scoredPicksTable.gameKey, k.gameKey),
              eq(scoredPicksTable.market, k.market),
              eq(scoredPicksTable.pick, k.pick),
              eq(scoredPicksTable.result, "pending")
            )
          );
      }

      logger.info(
        { jobId, league, games: snapshots.length, picks: picks.length, creditsRemaining: headers.requestsRemaining },
        "Cron: ingest complete for league"
      );
    } catch (err) {
      logger.error({ jobId, league, err }, "Cron: ingest error");
    }
  }

  logger.info({ jobId, totalGames, totalPicks }, "Cron: odds ingest finished");
}

// ---------------------------------------------------------------------------
// Job 1b — Every 2 minutes: capture true close odds near event_start
//
// CLV-integrity fix (2026-04-26). Before this job existed, "close" odds were
// just a copy of the most recent publish odds at game-start time, written by
// the 10-min ingest's onConflictDoUpdate (when isInProgress was true) and by
// /snapshots/finalize. That made clv_implied_delta mechanically zero (or null
// for spread/total) for every settled pick, so CLV was structurally
// uninformative as a model-quality signal.
//
// This job is now the SINGLE writer of game_snapshots.close_* fields for
// live games. It runs every 2 minutes, looks at scheduled snapshots whose
// event_start falls in [now-15min, now+5min] AND whose home_close_ml is
// still NULL, and overwrites close_* with a fresh Odds API poll keyed off
// the same gameKey produced by transformGame. The 15-minute look-back makes
// the job self-healing through a single missed cron tick or a brief Odds API
// 5xx; deeper backfills (e.g. games that aged past 15 min without a capture)
// are handled by the dedicated 45-day historical script instead.
//
// API budget: at most one /v4/sports/{sport}/odds call per league per run.
// In offseason or off-hours, the candidate query returns zero rows and the
// job exits without any API call (zero credits burned).
// ---------------------------------------------------------------------------
async function runClosingOddsCapture(): Promise<void> {
  const jobId = `close-capture-${Date.now()}`;

  // Scheduled snapshots in the close-capture window without close odds yet.
  // Status filter ('scheduled') excludes already-final games; the IS NULL
  // filter keeps the job idempotent — once close odds are captured, the
  // next run skips that snapshot entirely.
  const candidates = await db
    .select()
    .from(gameSnapshotsTable)
    .where(
      and(
        eq(gameSnapshotsTable.status, "scheduled"),
        sql`${gameSnapshotsTable.homeCloseMl} IS NULL`,
        sql`${gameSnapshotsTable.eventStart} BETWEEN NOW() - INTERVAL '15 minutes' AND NOW() + INTERVAL '5 minutes'`,
      ),
    );

  if (candidates.length === 0) {
    logger.debug({ jobId }, "Cron: closing-odds capture — no candidates in window");
    return;
  }

  const byLeague = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const arr = byLeague.get(c.league) ?? [];
    arr.push(c);
    byLeague.set(c.league, arr);
  }

  let totalCaptured = 0;
  let totalMissed = 0;

  for (const [league, games] of byLeague) {
    const sportKey = SPORT_KEYS[league];
    if (!sportKey) {
      logger.warn({ jobId, league }, "Cron: closing-odds capture — no sportKey for league");
      continue;
    }

    try {
      const { data: liveGames, headers } = await fetchOdds(sportKey);

      // Normalize each live game through the same transformer the publish
      // ingest uses, so close_* fields have identical filtering semantics
      // (best-line shopping, plausibility filters, ML/spread consistency
      // rail). Snapshots transformGame rejects (returns null) won't appear
      // in the map and the targeted game will get logged as a miss below.
      const snapByGameKey = new Map<string, ReturnType<typeof transformGame>>();
      for (const game of liveGames) {
        const fresh = transformGame(game, league);
        if (fresh) snapByGameKey.set(fresh.gameKey, fresh);
      }

      let leagueCaptured = 0;
      let leagueMissed = 0;
      for (const target of games) {
        const fresh = snapByGameKey.get(target.gameKey);
        if (!fresh) {
          leagueMissed++;
          logger.warn(
            {
              jobId,
              league,
              gameKey: target.gameKey,
              eventStart: target.eventStart,
              liveGameCount: liveGames.length,
            },
            "clv_capture_failed: no live odds for game in close-window (will retry next tick within 15-min look-back; outside window use scripts/backfillCloseOdds45d.ts)",
          );
          continue;
        }

        // Atomicity guard (architect review fix): write only if home_close_ml
        // is still NULL. Without this, two overlapping cron ticks (e.g. a slow
        // run finishing while a fast run starts) could each fetch a different
        // odds payload and the second write would clobber the first close.
        // The .returning() lets us tell when the guard rejected the write so
        // we don't double-count it as a fresh capture.
        const written = await db
          .update(gameSnapshotsTable)
          .set({
            homeCloseMl: String(fresh.homePublishMl),
            awayCloseMl: String(fresh.awayPublishMl),
            closeSpread: fresh.publishSpread != null ? String(fresh.publishSpread) : undefined,
            closeSpreadLine: fresh.publishSpreadLine != null ? String(fresh.publishSpreadLine) : undefined,
            closeAwaySpreadLine:
              fresh.publishAwaySpreadLine != null ? String(fresh.publishAwaySpreadLine) : undefined,
            closeTotal: fresh.publishTotal != null ? String(fresh.publishTotal) : undefined,
            closeOverLine: fresh.publishOverLine != null ? String(fresh.publishOverLine) : undefined,
            closeUnderLine: fresh.publishUnderLine != null ? String(fresh.publishUnderLine) : undefined,
            closeCapturedAt: new Date(),
            closeSource: deriveCloseSource(fresh.bestBooks),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(gameSnapshotsTable.id, target.id),
              sql`${gameSnapshotsTable.homeCloseMl} IS NULL`,
            ),
          )
          .returning({ id: gameSnapshotsTable.id });
        if (written.length > 0) leagueCaptured++;
      }

      totalCaptured += leagueCaptured;
      totalMissed += leagueMissed;

      logger.info(
        {
          jobId,
          league,
          captured: leagueCaptured,
          missed: leagueMissed,
          targetCount: games.length,
          creditsRemaining: headers.requestsRemaining,
        },
        "Cron: closing-odds capture for league",
      );
    } catch (err) {
      logger.error({ jobId, league, err }, "Cron: closing-odds capture error for league");
    }
  }

  logger.info(
    { jobId, totalCaptured, totalMissed, candidateCount: candidates.length },
    "Cron: closing-odds capture finished",
  );
}

// ---------------------------------------------------------------------------
// Job 2 — 3:30 AM: finalize closes, fetch scores, validate picks
// ---------------------------------------------------------------------------
async function runNightlyValidation(): Promise<void> {
  const jobId = `validate-${Date.now()}`;
  logger.info({ jobId }, "Cron: starting nightly validation");

  let scoresFetched = 0;
  let picksValidated = 0;

  for (const league of LEAGUES) {
    const sportKey = SPORT_KEYS[league];
    if (!sportKey) continue;

    try {
      // Odds API /scores caps daysFrom at 3. We backstop this with an
      // ESPN-based backfill after the Odds-API pass (see below) so that a
      // single missed cron run cannot permanently strand completed games.
      const { data: scores } = await fetchScores(sportKey, 3);

      for (const score of scores) {
        if (!score.completed || !score.scores) continue;

        const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(score.commence_time));

        // Find matching snapshot by date + league + team name match
        const snapshots = await db
          .select()
          .from(gameSnapshotsTable)
          .where(and(eq(gameSnapshotsTable.snapshotDate, date), eq(gameSnapshotsTable.league, league)));

        // Match by home-team name (full or last word) AND require the
        // away-team to also match. Without the away check, MLB
        // doubleheaders (two games same day, same home team, different
        // away team) and naming collisions could silently settle the
        // wrong snapshot. Mirrors the safer pattern used by the ESPN
        // backstop sweep below.
        const awayLast = score.away_team.split(" ").pop()?.toLowerCase() ?? "";
        const snap = snapshots.find((s) => {
          const homeMatches =
            s.homeTeam === score.home_team ||
            s.homeTeam.split(" ").pop()?.toLowerCase() ===
              score.home_team.split(" ").pop()?.toLowerCase();
          if (!homeMatches) return false;
          const snapAwayLast = s.awayTeam.split(" ").pop()?.toLowerCase() ?? "";
          return s.awayTeam === score.away_team || snapAwayLast === awayLast;
        });

        if (!snap) continue;

        const homeEntry = score.scores.find((s) => s.name === score.home_team);
        const awayEntry = score.scores.find((s) => s.name === score.away_team);
        if (!homeEntry || !awayEntry) continue;

        const homeScore = parseInt(homeEntry.score);
        const awayScore = parseInt(awayEntry.score);
        if (isNaN(homeScore) || isNaN(awayScore)) continue;

        // Update game snapshot
        await db
          .update(gameSnapshotsTable)
          .set({ homeScore, awayScore, status: "final", updatedAt: new Date() })
          .where(eq(gameSnapshotsTable.id, snap.id));

        scoresFetched++;

        // Validate all pending picks for this game
        const pending = await db
          .select()
          .from(scoredPicksTable)
          .where(and(eq(scoredPicksTable.gameKey, snap.gameKey), eq(scoredPicksTable.result, "pending")));

        for (const pick of pending) {
          const result = computeOutcomeResult({
            market: pick.market,
            pick: pick.pick,
            homeScore,
            awayScore,
            // Canonical home-team spread from the snapshot — NOT pick.publishLine,
            // which is team-signed and would double-negate for away picks.
            homeSpread: snap.publishSpread ? parseFloat(snap.publishSpread) : null,
            total: snap.publishTotal ? parseFloat(snap.publishTotal) : null,
          });

          // CLV writeback for all three markets. Pre-Plan-1 this block hard-gated on
          // `pick.market === "moneyline"`, so spread/total picks never got close_odds /
          // close_line / clv_implied_delta / clv_line_delta written. computeClvWritebackValues
          // centralises the per-market mapping; see scoring/clvWriteback.ts.
          const clv = computeClvWritebackValues(pick, snap);

          await db
            .update(scoredPicksTable)
            .set({
              result,
              closeOdds: clv.closeOdds,
              closeLine: clv.closeLine,
              clvImpliedDelta: clv.clvImpliedDelta,
              clvLineDelta: clv.clvLineDelta,
              updatedAt: new Date(),
            })
            .where(eq(scoredPicksTable.id, pick.id));

          await settleOfficialEvaluationResult({
            date: pick.date,
            gameKey: pick.gameKey,
            market: pick.market,
            pick: pick.pick,
            result,
            closeOdds: clv.closeOdds,
            closeLine: clv.closeLine,
            clvImpliedDelta: clv.clvImpliedDelta,
            clvLineDelta: clv.clvLineDelta,
          });

          picksValidated++;
        }

        // Internal Model-Watch grader: replay would-be picks for markets
        // in MARKET_MODEL_WATCH_ONLY against this just-final snapshot.
        // Failure here must NOT abort the public settlement loop — these
        // rows feed only the admin scoreboard, never public surfaces.
        try {
          const updatedSnap = { ...snap, homeScore, awayScore, status: "final" };
          await gradeModelWatchForSnapshot(updatedSnap);
        } catch (err) {
          logger.error(
            { jobId, gameKey: snap.gameKey, err },
            "Cron: model-watch grading failed (non-fatal)"
          );
        }
      }
    } catch (err) {
      logger.error({ jobId, league, err }, "Cron: validation error");
    }
  }

  // Self-healing backstop: sweep the last 7 days via ESPN so any games that
  // aged past the Odds API's 3-day /scores window (missed cron, restart, or
  // Odds API 5xx) still get settled. Idempotent — skips already-final games.
  try {
    const today = new Date().toISOString().split("T")[0];
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 7);
    const startDate = start.toISOString().split("T")[0];
    const sweep = await backfillSettlementEspn(startDate, today, LEAGUES);
    logger.info(
      { jobId, espnSnapshotsSettled: sweep.snapshotsSettled, espnPicksSettled: sweep.picksSettled },
      "Cron: ESPN backstop sweep complete"
    );
  } catch (err) {
    logger.error({ jobId, err }, "Cron: ESPN backstop sweep failed");
  }

  // Roll up daily validation_metrics for the last 7 days so /performance/history
  // has rows for any games just settled (including late ESPN backstops).
  try {
    const today = new Date().toISOString().split("T")[0];
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 7);
    const startDate = start.toISOString().split("T")[0];
    const metricsResult = await backfillValidationMetrics(startDate, today);
    logger.info({ jobId, metricsWritten: metricsResult.rowsWritten }, "Cron: validation_metrics rollup complete");
  } catch (err) {
    logger.error({ jobId, err }, "Cron: validation_metrics rollup failed");
  }

  // Model-Watch promotion-alert check. Aggregates `model_watch_results`
  // (now freshly updated by the per-snapshot grader call above) and
  // logs / persists an alert for any (league, market) bucket that has
  // newly cleared MODEL_WATCH_ALERT_THRESHOLDS. Idempotent — re-runs
  // do not re-spam already-fired alerts. Failure here must NOT abort
  // the nightly job, the alert is purely advisory.
  try {
    const alertResult = await runModelWatchAlertCheck();
    logger.info(
      {
        jobId,
        bucketsEvaluated: alertResult.bucketsEvaluated,
        qualifying: alertResult.qualifying,
        newAlerts: alertResult.newAlerts.length,
      },
      "Cron: model-watch alert check complete"
    );
  } catch (err) {
    logger.error({ jobId, err }, "Cron: model-watch alert check failed");
  }

  logger.info({ jobId, scoresFetched, picksValidated }, "Cron: nightly validation finished");
}

// ---------------------------------------------------------------------------
// Validation-metrics rollup. /performance/history reads from validation_metrics;
// this persists a per-day, per-league summary row (windowDays=1, market=null)
// from graded rows in scored_picks. Idempotent: deletes existing daily rows
// in the date range before reinserting.
// ---------------------------------------------------------------------------
export interface ValidationMetricsBackfillResult {
  datesProcessed: number;
  rowsWritten: number;
  errors: string[];
}

export async function backfillValidationMetrics(
  startDate: string,
  endDate: string,
  leagues: League[] = LEAGUES
): Promise<ValidationMetricsBackfillResult> {
  const result: ValidationMetricsBackfillResult = {
    datesProcessed: 0,
    rowsWritten: 0,
    errors: [],
  };

  // Idempotent: clear existing daily rollup rows in the window so re-runs after
  // late-settled games produce the correct aggregates.
  await db
    .delete(validationMetricsTable)
    .where(
      and(
        eq(validationMetricsTable.windowDays, 1),
        sql`${validationMetricsTable.runDate} >= ${startDate}`,
        sql`${validationMetricsTable.runDate} <= ${endDate}`
      )
    );

  let date = startDate;
  while (date <= endDate) {
    for (const league of leagues) {
      try {
        const picks = await db
          .select()
          .from(scoredPicksTable)
          .where(and(eq(scoredPicksTable.date, date), eq(scoredPicksTable.league, league)));

        if (picks.length === 0) continue;

        const picksForValidation: PickWithFullData[] = picks.map((p) => ({
          id: p.id,
          league: p.league,
          market: p.market,
          pick: p.pick,
          publishOdds: parseFloat(p.publishOdds),
          closeOdds: p.closeOdds ? parseFloat(p.closeOdds) : null,
          closeLine: p.closeLine ? parseFloat(p.closeLine) : null,
          publishLine: p.publishLine ? parseFloat(p.publishLine) : null,
          modelProbCalibrated: parseFloat(p.modelProbCalibrated),
          result: p.result as "win" | "loss" | "push" | "pending",
          ev: parseFloat(p.ev),
          edge: parseFloat(p.edge),
          clvImpliedDelta: p.clvImpliedDelta ? parseFloat(p.clvImpliedDelta) : null,
          tier: p.tier,
        }));

        const m = computeValidationMetrics(picksForValidation, 1);

        await db.insert(validationMetricsTable).values({
          runDate: date,
          league,
          market: null,
          windowDays: 1,
          totalPicks: m.totalPicks,
          wins: m.wins,
          losses: m.losses,
          pushes: m.pushes,
          roi: String(m.roi),
          winRate: String(m.winRate),
          unitsWon: String(m.unitsWon),
          maxDrawdown: String(m.maxDrawdown),
          avgEv: String(m.avgEv),
          avgEdge: String(m.avgEdge),
          clvHitRate: String(m.clvHitRate),
          avgClv: String(m.avgClv),
          brierScore: String(m.brierScore),
          logLoss: String(m.logLoss),
          passRate: String(m.passRate),
          picksPerDay: String(m.picksPerDay),
          modelVersion: "v1",
        });
        result.rowsWritten++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${date}/${league}: ${msg}`);
        logger.error({ date, league, err }, "validation_metrics rollup error");
      }
    }
    result.datesProcessed++;
    date = addDaysIso(date, 1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Backfill settlement using ESPN's free scoreboard API.
// Used when games have aged beyond the Odds API /scores daysFrom window
// (typical after a multi-day outage or server restart through a cron window).
// ---------------------------------------------------------------------------
export interface BackfillResult {
  datesProcessed: number;
  snapshotsSettled: number;
  picksSettled: number;
  errors: string[];
}

function addDaysIso(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

export async function backfillSettlementEspn(
  startDate: string,
  endDate: string,
  leagues: League[] = LEAGUES
): Promise<BackfillResult> {
  const jobId = `backfill-${Date.now()}`;
  const result: BackfillResult = {
    datesProcessed: 0,
    snapshotsSettled: 0,
    picksSettled: 0,
    errors: [],
  };

  logger.info({ jobId, startDate, endDate, leagues }, "Backfill settlement starting");

  let date = startDate;
  while (date <= endDate) {
    for (const league of leagues) {
      try {
        const espnScores = await fetchEspnScores(league, date);
        if (espnScores.size === 0) continue;

        // Pull all snapshots for this date+league that still need settlement.
        const snapshots = await db
          .select()
          .from(gameSnapshotsTable)
          .where(
            and(
              eq(gameSnapshotsTable.snapshotDate, date),
              eq(gameSnapshotsTable.league, league)
            )
          );

        for (const snap of snapshots) {
          if (snap.status === "final" && snap.homeScore != null && snap.awayScore != null) continue;

          // Match by full home team name, then by last word (e.g. "Lakers"),
          // and require the away team to match as well so naming collisions
          // (e.g. doubleheaders, renamed franchises) cannot silently settle
          // the wrong snapshot.
          const espnEntry =
            espnScores.get(snap.homeTeam) ??
            espnScores.get(snap.homeTeam.split(" ").pop()?.toLowerCase() ?? "");
          if (!espnEntry) continue;
          const awayLast = snap.awayTeam.split(" ").pop()?.toLowerCase() ?? "";
          const espnAwayLast = espnEntry.awayTeam.split(" ").pop()?.toLowerCase() ?? "";
          if (snap.awayTeam !== espnEntry.awayTeam && awayLast !== espnAwayLast) {
            logger.warn(
              { gameKey: snap.gameKey, snapAway: snap.awayTeam, espnAway: espnEntry.awayTeam },
              "Backfill: away-team mismatch, skipping"
            );
            continue;
          }

          await db
            .update(gameSnapshotsTable)
            .set({
              homeScore: espnEntry.homeScore,
              awayScore: espnEntry.awayScore,
              status: "final",
              updatedAt: new Date(),
            })
            .where(eq(gameSnapshotsTable.id, snap.id));
          result.snapshotsSettled++;

          // Settle pending picks for this game.
          const pending = await db
            .select()
            .from(scoredPicksTable)
            .where(
              and(
                eq(scoredPicksTable.gameKey, snap.gameKey),
                eq(scoredPicksTable.result, "pending")
              )
            );

          for (const pick of pending) {
            const outcome = computeOutcomeResult({
              market: pick.market,
              pick: pick.pick,
              homeScore: espnEntry.homeScore,
              awayScore: espnEntry.awayScore,
              homeSpread: snap.publishSpread ? parseFloat(snap.publishSpread) : null,
              total: snap.publishTotal ? parseFloat(snap.publishTotal) : null,
            });

            // CLV writeback parity with the nightly path. See scoring/clvWriteback.ts.
            const clv = computeClvWritebackValues(pick, snap);

            // Concurrency guard: only settle if still pending. Prevents
            // double-counting when nightly validation and backfill overlap.
            const updated = await db
              .update(scoredPicksTable)
              .set({
                result: outcome,
                closeOdds: clv.closeOdds,
                closeLine: clv.closeLine,
                clvImpliedDelta: clv.clvImpliedDelta,
                clvLineDelta: clv.clvLineDelta,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(scoredPicksTable.id, pick.id),
                  eq(scoredPicksTable.result, "pending")
                )
              )
              .returning({ id: scoredPicksTable.id });
            if (updated.length > 0) result.picksSettled++;
            if (updated.length > 0) {
              await settleOfficialEvaluationResult({
                date: pick.date,
                gameKey: pick.gameKey,
                market: pick.market,
                pick: pick.pick,
                result: outcome,
                closeOdds: clv.closeOdds,
                closeLine: clv.closeLine,
                clvImpliedDelta: clv.clvImpliedDelta,
                clvLineDelta: clv.clvLineDelta,
              });
            }
          }

          // Internal Model-Watch grader (ESPN backstop path).
          // Mirrors the runNightlyValidation hook so games settled by
          // the backstop sweep also produce model_watch_results rows.
          // Non-fatal: errors must not block the public settlement loop.
          try {
            const updatedSnap = {
              ...snap,
              homeScore: espnEntry.homeScore,
              awayScore: espnEntry.awayScore,
              status: "final",
            };
            await gradeModelWatchForSnapshot(updatedSnap);
          } catch (err) {
            logger.error(
              { jobId, gameKey: snap.gameKey, err },
              "Backfill: model-watch grading failed (non-fatal)"
            );
          }
        }
      } catch (err) {
        const msg = `${date}/${league}: ${String(err)}`;
        logger.error({ jobId, date, league, err }, "Backfill: error");
        result.errors.push(msg);
      }
    }
    result.datesProcessed++;
    date = addDaysIso(date, 1);
  }

  logger.info({ jobId, ...result }, "Backfill settlement complete");
  return result;
}

// ---------------------------------------------------------------------------
// Start all cron jobs
// ---------------------------------------------------------------------------
export { runNightlyValidation, runOddsIngest, runClosingOddsCapture };

export function startCronJobs(): void {
  // Job 1: Every 10 minutes — ingest latest odds for upcoming games
  cron.schedule("*/10 * * * *", async () => {
    try {
      await runOddsIngest();
    } catch (err) {
      logger.error({ err }, "Cron: unhandled error in odds ingest");
    }
  });

  // Job 1b: Every 2 minutes — capture true close odds near event_start.
  // SOLE writer of game_snapshots.close_*. See runClosingOddsCapture comment
  // block for the CLV-integrity rationale; see scripts/backfillCloseOdds45d.ts
  // for the historical-window companion.
  cron.schedule("*/2 * * * *", async () => {
    try {
      await runClosingOddsCapture();
    } catch (err) {
      logger.error({ err }, "Cron: unhandled error in closing-odds capture");
    }
  });

  // Job 2: 3:30 AM daily — finalize closes, validate picks
  cron.schedule("30 3 * * *", async () => {
    try {
      await runNightlyValidation();
    } catch (err) {
      logger.error({ err }, "Cron: unhandled error in nightly validation");
    }
  });

  logger.info(
    "Cron jobs scheduled: odds ingest every 10 min, closing-odds capture every 2 min, validation at 3:30 AM daily",
  );
}
