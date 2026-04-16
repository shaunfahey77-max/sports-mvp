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
} from "@workspace/db";
import { eq, and, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { capAndSort } from "../lib/pickUtils";
import { scorePicks, type GameMarketInput } from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import { fetchOdds, fetchScores, transformGame, SPORT_KEYS } from "../lib/oddsApi";
import type { League, MarketType } from "../config/scoringModelConfig";
import { fetchEspnScores } from "./historicalIngest";

const LEAGUES: League[] = ["nba", "nhl"];
const MARKETS: MarketType[] = ["moneyline", "spread", "total"];

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
              // If game has already started, record the most recent odds as "close" odds
              ...(isInProgress
                ? {
                    homeCloseMl: String(snap.homePublishMl),
                    awayCloseMl: String(snap.awayPublishMl),
                    closeSpread: snap.publishSpread != null ? String(snap.publishSpread) : undefined,
                    closeSpreadLine: snap.publishSpreadLine != null ? String(snap.publishSpreadLine) : undefined,
                    closeTotal: snap.publishTotal != null ? String(snap.publishTotal) : undefined,
                    closeOverLine: snap.publishOverLine != null ? String(snap.publishOverLine) : undefined,
                    closeUnderLine: snap.publishUnderLine != null ? String(snap.publishUnderLine) : undefined,
                  }
                : {}),
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

      // Re-score all upcoming games to pick up updated odds
      const candidates = await scorePicks(snapshots, MARKETS, "v1");
      // Sort by rankScore DESC before capping so the best picks per league/game are kept
      const picks = capAndSort(
        candidates
          .filter((c) => c.tier !== "PASS")
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
            },
          });
      }

      // Upsert scored picks (pending only for future games)
      // Use onConflictDoUpdate so odds changes and eventStart are always refreshed.
      // Never overwrite result/closeOdds — those are set by the validation job.
      if (picks.length > 0) {
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

        const snap = snapshots.find(
          (s) =>
            s.homeTeam === score.home_team ||
            s.homeTeam.split(" ").pop()?.toLowerCase() === score.home_team.split(" ").pop()?.toLowerCase()
        );

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

          // Compute CLV implied delta (close odds vs publish odds)
          const closeOdds =
            pick.market === "moneyline"
              ? pick.pick === "home"
                ? snap.homeCloseMl
                : snap.awayCloseMl
              : null;

          let clvImpliedDelta: string | undefined;
          if (closeOdds && pick.publishOdds) {
            const publishImplied = americanToImplied(parseFloat(pick.publishOdds));
            const closeImplied = americanToImplied(parseFloat(closeOdds));
            // Positive CLV: market moved toward our side after publish.
            // closeImplied > publishImplied means sharps bet our side → we got better opening price.
            clvImpliedDelta = String(closeImplied - publishImplied);
          }

          await db
            .update(scoredPicksTable)
            .set({
              result,
              closeOdds: closeOdds ?? undefined,
              clvImpliedDelta,
              updatedAt: new Date(),
            })
            .where(eq(scoredPicksTable.id, pick.id));

          picksValidated++;
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

  logger.info({ jobId, scoresFetched, picksValidated }, "Cron: nightly validation finished");
}

function americanToImplied(american: number): number {
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
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

            const closeOdds =
              pick.market === "moneyline"
                ? pick.pick === "home"
                  ? snap.homeCloseMl
                  : snap.awayCloseMl
                : null;

            let clvImpliedDelta: string | undefined;
            if (closeOdds && pick.publishOdds) {
              const publishImplied = americanToImplied(parseFloat(pick.publishOdds));
              const closeImplied = americanToImplied(parseFloat(closeOdds));
              clvImpliedDelta = String(closeImplied - publishImplied);
            }

            // Concurrency guard: only settle if still pending. Prevents
            // double-counting when nightly validation and backfill overlap.
            const updated = await db
              .update(scoredPicksTable)
              .set({
                result: outcome,
                closeOdds: closeOdds ?? undefined,
                clvImpliedDelta,
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
export { runNightlyValidation, runOddsIngest };

export function startCronJobs(): void {
  // Job 1: Every 10 minutes — ingest latest odds
  cron.schedule("*/10 * * * *", async () => {
    try {
      await runOddsIngest();
    } catch (err) {
      logger.error({ err }, "Cron: unhandled error in odds ingest");
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

  logger.info("Cron jobs scheduled: odds ingest every 10 min, validation at 3:30 AM daily");
}
