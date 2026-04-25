import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { scorePicks, type GameMarketInput, type CandidateOutput } from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import type { League, MarketType } from "../config/scoringModelConfig";
import { ODDS_RANGE_GUARDRAIL_LEAGUES } from "../config/scoringModelConfig";
import {
  fetchOdds,
  fetchScores,
  transformGame,
  SPORT_KEYS,
} from "../lib/oddsApi";
import { NBA_TEAMS, NHL_TEAMS } from "../lib/teamAbbreviations";
import { capAndSort, computeStaleScoredPicksKeys } from "../lib/pickUtils";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/odds/ingest
// Fetch today's real NBA + NHL odds from The Odds API, ingest snapshots, run scoring.
// ---------------------------------------------------------------------------
router.post("/odds/ingest", async (req, res): Promise<void> => {
  const leagues: League[] = (req.body?.leagues as League[]) ?? ["nba", "nhl"];
  const markets: MarketType[] = (req.body?.markets as MarketType[]) ?? ["moneyline", "spread", "total"];

  const results: Record<string, { games: number; candidates: number; picks: number; creditsRemaining?: number }> = {};
  const errors: string[] = [];

  for (const league of leagues) {
    const sportKey = SPORT_KEYS[league];
    if (!sportKey) continue;

    try {
      const { data: games, headers } = await fetchOdds(sportKey);
      let gameCount = 0;
      const snapshots: GameMarketInput[] = [];

      for (const game of games) {
        const snap = transformGame(game, league);
        if (!snap) continue;

        try {
          await db
            .insert(gameSnapshotsTable)
            .values({
              gameKey: snap.gameKey,
              league: snap.league,
              eventStart: new Date(snap.eventStart),
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
                updatedAt: new Date(),
              },
            });
          snapshots.push({
            gameKey: snap.gameKey,
            league: snap.league as League,
            eventStart: new Date(snap.eventStart),
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
          gameCount++;
        } catch (e) {
          errors.push(`${snap.gameKey}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Run scoring pipeline
      const candidates =
        snapshots.length > 0
          ? await scorePicks(snapshots, markets, "v1", {
              oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
            })
          : [];

      if (candidates.length > 0) {
        await db.insert(candidateBetsTable).values(
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
            snapshotDate: snapshots[0]?.snapshotDate ?? new Date().toISOString().split("T")[0],
            modelVersion: "v1",
          }))
        ).onConflictDoUpdate({
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

        // Sort by rankScore DESC before capping so the best picks per league/game are kept
        const picks = capAndSort(
          candidates
            .filter((c) => c.tier !== "PASS")
            .sort((a, b) => b.rankScore - a.rankScore)
        );
        if (picks.length > 0) {
          await db.insert(scoredPicksTable).values(
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
          ).onConflictDoUpdate({
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
        }

        // Reconcile: strip prior pending rows for candidates that are now PASS.
        const staleKeys = computeStaleScoredPicksKeys(candidates);
        const reconcileDate = snapshots[0]?.snapshotDate ?? new Date().toISOString().split("T")[0];
        for (const k of staleKeys) {
          await db
            .delete(scoredPicksTable)
            .where(
              and(
                eq(scoredPicksTable.date, reconcileDate),
                eq(scoredPicksTable.gameKey, k.gameKey),
                eq(scoredPicksTable.market, k.market),
                eq(scoredPicksTable.pick, k.pick),
                eq(scoredPicksTable.result, "pending")
              )
            );
        }

        results[league] = {
          games: gameCount,
          candidates: candidates.length,
          picks: picks.length,
          creditsRemaining: headers.requestsRemaining,
        };
      } else {
        results[league] = { games: gameCount, candidates: 0, picks: 0, creditsRemaining: headers.requestsRemaining };
      }
    } catch (e) {
      errors.push(`${league}: ${e instanceof Error ? e.message : String(e)}`);
      results[league] = { games: 0, candidates: 0, picks: 0 };
    }
  }

  res.json({ success: errors.length === 0, results, errors });
});

// ---------------------------------------------------------------------------
// POST /api/odds/validate-scores
// Fetch recent completed game scores and validate pending picks.
// ---------------------------------------------------------------------------
router.post("/odds/validate-scores", async (req, res): Promise<void> => {
  const daysFrom = Number(req.body?.daysFrom ?? 3);
  const leagues: League[] = (req.body?.leagues as League[]) ?? ["nba", "nhl"];
  let scoresFetched = 0;
  let picksValidated = 0;
  const errors: string[] = [];

  for (const league of leagues) {
    const sportKey = SPORT_KEYS[league];
    if (!sportKey) continue;

    try {
      const { data: scores } = await fetchScores(sportKey, daysFrom);

      for (const score of scores) {
        if (!score.completed || !score.scores) continue;

        // Find matching game_snapshot by teams + commence date
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(score.commence_time));
        const snapshots = await db
          .select()
          .from(gameSnapshotsTable)
          .where(and(eq(gameSnapshotsTable.snapshotDate, date), eq(gameSnapshotsTable.league, league)));

        // Match by home/away team name
        const snap = snapshots.find(
          (s) =>
            s.homeTeam.toLowerCase().includes(score.home_team.split(" ").pop()?.toLowerCase() ?? "") ||
            s.homeTeam === score.home_team
        );
        if (!snap) continue;

        const homeScoreEntry = score.scores.find((s) => s.name === score.home_team);
        const awayScoreEntry = score.scores.find((s) => s.name === score.away_team);
        if (!homeScoreEntry || !awayScoreEntry) continue;

        const homeScore = parseInt(homeScoreEntry.score);
        const awayScore = parseInt(awayScoreEntry.score);
        if (isNaN(homeScore) || isNaN(awayScore)) continue;

        // Update game snapshot with final score
        await db
          .update(gameSnapshotsTable)
          .set({ homeScore, awayScore, status: "final", updatedAt: new Date() })
          .where(eq(gameSnapshotsTable.id, snap.id));
        scoresFetched++;

        // Validate pending picks for this game
        const pending = await db
          .select()
          .from(scoredPicksTable)
          .where(and(eq(scoredPicksTable.gameKey, snap.gameKey), eq(scoredPicksTable.result, "pending")));

        // Canonical home-team spread and total come from the snapshot, not
        // the (team-signed) pick.publishLine, so away picks grade correctly.
        const canonicalHomeSpread = snap.publishSpread != null
          ? parseFloat(snap.publishSpread)
          : null;
        const canonicalTotal = snap.publishTotal != null
          ? parseFloat(snap.publishTotal)
          : null;
        for (const pick of pending) {
          const result = computeOutcomeResult({
            market: pick.market,
            pick: pick.pick,
            homeScore,
            awayScore,
            homeSpread: canonicalHomeSpread,
            total: canonicalTotal,
          });

          await db
            .update(scoredPicksTable)
            .set({ result, updatedAt: new Date() })
            .where(eq(scoredPicksTable.id, pick.id));
          picksValidated++;
        }
      }
    } catch (e) {
      errors.push(`${league}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  res.json({ success: errors.length === 0, scoresFetched, picksValidated, errors });
});

// ---------------------------------------------------------------------------
// POST /api/odds/backfill
// Generate 45 days of synthetic historical game data, run scoring, assign outcomes.
// ---------------------------------------------------------------------------
router.post("/odds/backfill", async (_req, res): Promise<void> => {
  res.status(410).json({
    ok: false,
    error: "Synthetic backfill has been disabled in recovery mode."
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function seededFloat(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function probToAmericanOdds(p: number): number {
  const clamped = Math.max(0.02, Math.min(0.98, p));
  if (clamped >= 0.5) {
    const odds = Math.round(-100 * clamped / (1 - clamped));
    return Math.round(odds / 5) * 5; // round to nearest 5
  } else {
    const odds = Math.round(100 * (1 - clamped) / clamped);
    return Math.round(odds / 5) * 5;
  }
}

interface SyntheticGameInput extends GameMarketInput {
  homeScore: number | null;
  awayScore: number | null;
}

function generateSyntheticGames(date: string, league: League, dayIndex: number): SyntheticGameInput[] {
  const teams = league === "nba" ? NBA_TEAMS : NHL_TEAMS;
  const seed = hashStr(date + league);

  // 3-5 games per day per league
  const numGames = league === "nba" ? 3 + (seed % 3) : 2 + (seed % 3);
  const shuffled = [...teams];

  // Seeded Fisher-Yates shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(seededFloat(seed + i + dayIndex) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const games: SyntheticGameInput[] = [];
  const used = new Set<string>();

  for (let g = 0; g < numGames && g * 2 + 1 < shuffled.length; g++) {
    const away = shuffled[g * 2];
    const home = shuffled[g * 2 + 1];
    if (!away || !home || away.abbrev === home.abbrev) continue;
    if (used.has(away.abbrev) || used.has(home.abbrev)) continue;
    used.add(away.abbrev);
    used.add(home.abbrev);

    const gameSeed = hashStr(date + league + away.abbrev + home.abbrev);

    // Generate realistic odds
    const homeWinP = 0.44 + seededFloat(gameSeed) * 0.24; // 0.44 - 0.68
    const homeMl = -probToAmericanOdds(homeWinP);
    const awayMl = probToAmericanOdds(1 - homeWinP);

    let publishSpread: number | null = null;
    let publishSpreadLine: number | null = null;
    let publishTotal: number | null = null;
    let publishOverLine: number | null = null;
    let publishUnderLine: number | null = null;

    if (league === "nba") {
      publishSpread = homeWinP >= 0.5
        ? -(Math.round((homeWinP - 0.5) * 25 * 2) / 2)
        : Math.round((0.5 - homeWinP) * 25 * 2) / 2;
      publishSpreadLine = -110;
      publishTotal = 213 + Math.round(seededFloat(gameSeed + 1) * 14); // 213-227
      publishOverLine = -110;
      publishUnderLine = -110;
    } else {
      // NHL puck line
      publishSpread = -1.5;
      publishSpreadLine = Math.round(130 + seededFloat(gameSeed + 1) * 50); // +130 to +180
      publishTotal = 5.5 + (seededFloat(gameSeed + 2) > 0.5 ? 0.5 : 0);
      publishOverLine = seededFloat(gameSeed + 3) > 0.5 ? -115 : -105;
      publishUnderLine = publishOverLine === -115 ? -105 : -115;
    }

    // Generate realistic final scores
    const { homeScore, awayScore } = generateScores(league, homeWinP, gameSeed, publishSpread, publishTotal);

    const gameKey = `${league}_${date}_${away.abbrev}_${home.abbrev}`;
    const eventStart = new Date(`${date}T${19 + g}:00:00Z`);

    games.push({
      gameKey,
      league,
      eventStart,
      homeTeam: home.name,
      awayTeam: away.name,
      homePublishMl: homeMl,
      awayPublishMl: awayMl,
      publishSpread,
      publishSpreadLine,
      publishTotal,
      publishOverLine,
      publishUnderLine,
      snapshotDate: date,
      homeScore,
      awayScore,
    });
  }

  return games;
}

function generateScores(
  league: League,
  homeWinP: number,
  seed: number,
  spread: number | null,
  total: number | null
): { homeScore: number; awayScore: number } {
  const r = seededFloat(seed + 77);
  const homeWins = r < homeWinP;

  if (league === "nba") {
    const base = total ? Math.round(total / 2) : 108;
    const margin = 3 + Math.round(seededFloat(seed + 88) * 12); // 3-15 pts
    const homeBase = base + Math.round((seededFloat(seed + 99) - 0.5) * 8);
    const awayBase = base - Math.round((seededFloat(seed + 99) - 0.5) * 8);
    return homeWins
      ? { homeScore: homeBase + Math.ceil(margin / 2), awayScore: awayBase - Math.floor(margin / 2) }
      : { homeScore: homeBase - Math.ceil(margin / 2), awayScore: awayBase + Math.floor(margin / 2) };
  } else {
    // NHL
    const homeGoals = homeWins
      ? 2 + Math.round(seededFloat(seed + 11) * 2)
      : 1 + Math.round(seededFloat(seed + 11) * 2);
    const awayGoals = homeWins
      ? Math.max(0, homeGoals - 1 - Math.round(seededFloat(seed + 22) * 2))
      : homeGoals + 1 + Math.round(seededFloat(seed + 22));
    return { homeScore: homeGoals, awayScore: awayGoals };
  }
}

/**
 * Compute historical outcome deterministically from model calibrated probability.
 * Uses the game key + market as seed so results are stable across re-runs.
 */
function computeHistoricalOutcome(
  pick: CandidateOutput,
  date: string
): "win" | "loss" | "push" {
  const seed = hashStr(pick.gameKey + pick.marketType + pick.side + date);
  const r = seededFloat(seed);

  // 3% push rate
  if (r < 0.03) return "push";

  // Use calibrated probability to determine win — positive edge picks win slightly more often
  // Add a small boost for positive EV to simulate our model finding genuine edges
  const boostFactor = pick.ev > 0 ? 0.03 : -0.01;
  const effectiveP = Math.min(0.78, pick.modelProbCalibrated + boostFactor);

  return r < 0.03 + effectiveP * 0.97 ? "win" : "loss";
}

/**
 * Simulate a CLV delta (closing line value vs publish odds).
 * Positive = market moved in our favor.
 */
function computeBackfillClv(pick: CandidateOutput, result: string, date: string): number {
  const seed = hashStr(pick.gameKey + pick.marketType + pick.side + date + "clv");
  const r = seededFloat(seed);
  // Winning picks: 65% chance of positive CLV
  // Losing picks: 40% chance of positive CLV
  const positiveRate = result === "win" ? 0.65 : 0.40;
  const magnitude = 0.01 + seededFloat(seed + 1) * 0.045; // 0.01 - 0.055
  return r < positiveRate ? magnitude : -magnitude;
}

export default router;
