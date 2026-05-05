/**
 * Historical Data Ingest Service
 *
 * Fetches historical odds from the Odds API + scores from ESPN's free public
 * API for a date range, runs the scoring model, grades results, and stores
 * in scored_picks.
 *
 * Odds API credit usage: ~30 credits per historical odds call (verified
 * empirically 2026-04 — earlier 10-credit estimate was stale; the
 * historical endpoint costs more than the current/upcoming endpoints).
 * ESPN scores API: free, no key required.
 */

import { db } from "@workspace/db";
import { gameSnapshotsTable, scoredPicksTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  fetchHistoricalOdds,
  transformGame,
  SPORT_KEYS,
} from "../lib/oddsApi";
import {
  isOfficialCandidate,
  scorePicks,
  type GameMarketInput,
} from "../scoring/scorePicks";
import { computeOutcomeResult } from "../scoring/validatePicks";
import {
  settleOfficialEvaluationResult,
  upsertOfficialCandidateEvaluation,
} from "../scoring/officialEvaluationWriter";
import type { League, MarketType } from "../config/scoringModelConfig";

const MARKETS: MarketType[] = ["moneyline", "spread", "total"];

// ESPN sport path for each league
const ESPN_SPORT_PATH: Record<string, string> = {
  nba: "basketball/nba",
  nhl: "hockey/nhl",
  mlb: "baseball/mlb",
  // NFL Phase 0.75E foundation: registered for future ESPN backstop use.
  // Not actively called until NFL is added to cron LEAGUES.
  nfl: "football/nfl",
  // NCAAF Phase 0.75F foundation: registered for future ESPN backstop use.
  // Not actively called until NCAAF is added to cron LEAGUES.
  ncaaf: "football/college-football",
};

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EspnScore {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

/**
 * Fetch completed game scores from ESPN's free public scoreboard API.
 * Returns a map of home team name → scores for all completed games on that date.
 */
export async function fetchEspnScores(league: string, date: string): Promise<Map<string, EspnScore>> {
  const sportPath = ESPN_SPORT_PATH[league];
  if (!sportPath) return new Map();

  const yyyymmdd = date.replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${yyyymmdd}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API ${res.status} for ${league} on ${date}`);

  const json = (await res.json()) as {
    events?: Array<{
      competitions?: Array<{
        status?: { type?: { completed?: boolean } };
        competitors?: Array<{
          homeAway?: string;
          team?: { displayName?: string; shortDisplayName?: string };
          score?: string;
        }>;
      }>;
    }>;
  };

  const scoreMap = new Map<string, EspnScore>();

  for (const event of json.events ?? []) {
    for (const competition of event.competitions ?? []) {
      if (!competition.status?.type?.completed) continue;
      const competitors = competition.competitors ?? [];
      const homeComp = competitors.find((c) => c.homeAway === "home");
      const awayComp = competitors.find((c) => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const homeName = homeComp.team?.displayName ?? "";
      const awayName = awayComp.team?.displayName ?? "";
      const homeScore = parseInt(homeComp.score ?? "");
      const awayScore = parseInt(awayComp.score ?? "");
      if (!homeName || !awayName || isNaN(homeScore) || isNaN(awayScore)) continue;

      const entry: EspnScore = { homeTeam: homeName, awayTeam: awayName, homeScore, awayScore };
      scoreMap.set(homeName, entry);
      // Also index by last word (e.g. "Lakers") for fuzzy matching
      const homeLastWord = homeName.split(" ").pop()?.toLowerCase() ?? "";
      if (homeLastWord) scoreMap.set(homeLastWord, entry);
    }
  }

  return scoreMap;
}

function generateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

export interface HistoricalIngestConfig {
  startDate: string;
  endDate: string;
  leagues?: League[];
  delayMs?: number;
}

export interface HistoricalIngestProgress {
  startDate: string;
  endDate: string;
  datesTotal: number;
  datesProcessed: number;
  gamesIngested: number;
  picksInserted: number;
  creditsUsed: number;
  errors: string[];
  status: "running" | "complete" | "failed";
}

let currentJob: HistoricalIngestProgress | null = null;

export function getHistoricalIngestStatus(): HistoricalIngestProgress | null {
  return currentJob;
}

export function startHistoricalIngest(config: HistoricalIngestConfig): void {
  const leagues: League[] = config.leagues ?? ["nba", "nhl"];
  const delayMs = config.delayMs ?? 300;
  const dates = generateDates(config.startDate, config.endDate);

  currentJob = {
    startDate: config.startDate,
    endDate: config.endDate,
    datesTotal: dates.length,
    datesProcessed: 0,
    gamesIngested: 0,
    picksInserted: 0,
    creditsUsed: 0,
    errors: [],
    status: "running",
  };

  logger.info(
    { startDate: config.startDate, endDate: config.endDate, totalDates: dates.length },
    "Historical ingest starting"
  );

  runIngest(dates, leagues, delayMs).catch((err) => {
    logger.error({ err }, "Historical ingest failed");
    if (currentJob) currentJob.status = "failed";
  });
}

async function runIngest(
  dates: string[],
  leagues: League[],
  delayMs: number
): Promise<void> {
  for (const date of dates) {
    try {
      await processDate(date, leagues, delayMs);
    } catch (err) {
      const msg = `${date}: ${String(err)}`;
      logger.error({ date, err }, "Historical ingest: date failed");
      if (currentJob) currentJob.errors.push(msg);
    }
    if (currentJob) currentJob.datesProcessed++;
    await sleep(delayMs);
  }
  if (currentJob) currentJob.status = "complete";
  logger.info(currentJob, "Historical ingest complete");
}

async function processDate(date: string, leagues: League[], delayMs: number): Promise<void> {
  // Fetch odds at 4pm UTC on the game date — solid pre-game snapshot (11am ET)
  const oddsDatetime = `${date}T16:00:00Z`;

  for (const league of leagues) {
    const sportKey = SPORT_KEYS[league];
    if (!sportKey) continue;

    try {
      // 1. Fetch historical odds from Odds API
      const { data: games, headers: oddsHeaders } = await fetchHistoricalOdds(sportKey, oddsDatetime);
      if (currentJob) currentJob.creditsUsed += oddsHeaders.requestsUsed;
      await sleep(delayMs);

      // Filter to only games that start on this date
      const dateGames = games.filter((g) => g.commence_time.startsWith(date));
      if (dateGames.length === 0) continue;

      // 2. Fetch completed scores from ESPN (free, no API key)
      const espnScores = await fetchEspnScores(league, date);
      await sleep(Math.min(delayMs, 150)); // ESPN is free, lighter throttle

      // 3. Process each game — match odds to ESPN score
      const gameInputsWithScores: Array<{
        input: GameMarketInput;
        score: { homeScore: number; awayScore: number };
      }> = [];

      for (const game of dateGames) {
        const snap = transformGame(game, league);
        if (!snap) continue;

        // Try matching by full home team name first, then last word
        const espnEntry =
          espnScores.get(game.home_team) ??
          espnScores.get(game.home_team.split(" ").pop()?.toLowerCase() ?? "");

        // Upsert game snapshot (with or without final score)
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
            homeScore: espnEntry?.homeScore,
            awayScore: espnEntry?.awayScore,
            status: espnEntry ? "final" : "scheduled",
            snapshotDate: snap.snapshotDate,
          })
          .onConflictDoNothing();

        // Only score picks if we have a final result
        if (!espnEntry) continue;
        if (currentJob) currentJob.gamesIngested++;

        gameInputsWithScores.push({
          input: {
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
          },
          score: { homeScore: espnEntry.homeScore, awayScore: espnEntry.awayScore },
        });
      }

      if (gameInputsWithScores.length === 0) continue;

      // 4. Run the scoring model against all games with confirmed scores
      const candidates = await scorePicks(
        gameInputsWithScores.map((g) => g.input),
        MARKETS,
        "v1"
      );
      const picks = candidates.filter((c) => isOfficialCandidate(c));

      // 5. Grade each pick and insert into scored_picks
      for (const pick of picks) {
        await upsertOfficialCandidateEvaluation(pick);
        const gameEntry = gameInputsWithScores.find((g) => g.input.gameKey === pick.gameKey);
        if (!gameEntry) continue;

        // Use canonical home-team spread and total from the snapshot input,
        // not the team-signed pick.publishLine, so away-side picks grade
        // correctly after the computeOutcomeResult signature change.
        const outcome = computeOutcomeResult({
          market: pick.marketType,
          pick: pick.side,
          homeScore: gameEntry.score.homeScore,
          awayScore: gameEntry.score.awayScore,
          homeSpread: gameEntry.input.publishSpread ?? null,
          total: gameEntry.input.publishTotal ?? null,
        });

        await db
          .insert(scoredPicksTable)
          .values({
            date: pick.snapshotDate,
            gameKey: pick.gameKey,
            league: pick.league,
            market: pick.marketType,
            pick: pick.side,
            result: outcome,
            publishOdds: String(pick.publishOdds),
            publishLine: pick.publishLine != null ? String(pick.publishLine) : undefined,
            modelProbRaw: String(pick.modelProbRaw),
            modelProbCalibrated: String(pick.modelProbCalibrated),
            marketProbFair: String(pick.marketProbFair),
            edge: String(pick.edge),
            ev: String(pick.ev),
            rankScore: String(pick.rankScore),
            tier: pick.tier,
            modelVersion: "v1",
            scoringVersion: "v1",
          })
          .onConflictDoNothing();

        await settleOfficialEvaluationResult({
          date: pick.snapshotDate,
          gameKey: pick.gameKey,
          market: pick.marketType,
          pick: pick.side,
          result: outcome,
        });

        if (currentJob) currentJob.picksInserted++;
      }

      logger.info(
        {
          date,
          league,
          gamesWithOdds: dateGames.length,
          gamesWithScores: gameInputsWithScores.length,
          picks: picks.length,
          creditsRemaining: oddsHeaders.requestsRemaining,
        },
        "Historical ingest: date+league complete"
      );
    } catch (err) {
      const msg = `${date}/${league}: ${String(err)}`;
      logger.error({ date, league, err }, "Historical ingest: league error");
      if (currentJob) currentJob.errors.push(msg);
    }
  }
}
