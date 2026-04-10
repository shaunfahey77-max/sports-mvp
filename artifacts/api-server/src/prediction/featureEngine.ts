/**
 * Feature Engine
 *
 * Computes real, data-driven features for each game before prediction models run.
 * Replaces the hash-based noise that was the previous "signal."
 *
 * Features computed:
 *  - Rest days for each team (days since last game)
 *  - Back-to-back flag (0 rest days)
 *  - Home ATS win rate (last 25 graded home spread picks)
 *  - Road ATS win rate (last 25 graded road spread picks)
 *  - Over rate for each team (last 25 graded total picks)
 *  - Rest advantage (home rest - away rest, capped ±3)
 */

import { db } from "@workspace/db";
import { gameSnapshotsTable, scoredPicksTable } from "@workspace/db";
import { and, eq, gte, lt } from "drizzle-orm";
import type { GameMarketInput, GameFeatures } from "../scoring/scorePicks";
import { NBA_TEAM_ABBREVS, NHL_TEAM_ABBREVS } from "../lib/teamAbbreviations";

const ABBREV_LOOKUP: Record<string, Record<string, string>> = {
  nba: NBA_TEAM_ABBREVS,
  nhl: NHL_TEAM_ABBREVS,
};

function getAbbrev(teamName: string, league: string): string {
  const map = ABBREV_LOOKUP[league] ?? {};
  return map[teamName] ?? teamName.split(" ").pop()?.toLowerCase() ?? "unk";
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

interface TeamFeatureData {
  restDays: number;
  isB2B: boolean;
  homeATS: number;
  roadATS: number;
  overRate: number;
  sampleSize: number;
  goalsForAvg: number;
  goalsAgainstAvg: number;
  last5TotalAvg: number;
  last10TotalAvg: number;
}

async function computeTeamFeatures(
  abbrev: string,
  league: string,
  gameDate: string
): Promise<TeamFeatureData> {
  const ninetyDaysAgo = addDays(gameDate, -90);
  const fourteenDaysAgo = addDays(gameDate, -14);

  // --- Recent historical games for this team ---
  let recentGames: Array<{
    gameKey: string;
    snapshotDate: string;
    homeScore: number | null;
    awayScore: number | null;
  }> = [];

  // --- Rest days: last game before gameDate in past 14 days ---
  let restDays = 7;
  try {
    recentGames = await db
      .select({
        gameKey: gameSnapshotsTable.gameKey,
        snapshotDate: gameSnapshotsTable.snapshotDate,
        homeScore: gameSnapshotsTable.homeScore,
        awayScore: gameSnapshotsTable.awayScore,
      })
      .from(gameSnapshotsTable)
      .where(
        and(
          eq(gameSnapshotsTable.league, league),
          gte(gameSnapshotsTable.snapshotDate, fourteenDaysAgo),
          lt(gameSnapshotsTable.snapshotDate, gameDate)
        )
      );

    const teamGames = recentGames
      .filter((g) => {
        const parts = g.gameKey.split("_");
        return parts[2] === abbrev || parts[3] === abbrev;
      })
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));

    if (teamGames.length > 0 && teamGames[0]) {
      restDays = daysBetween(teamGames[0].snapshotDate, gameDate);
    }
  } catch {
    // fallback to neutral rest
  }

  const isB2B = restDays <= 1;

  // --- ATS and over/under rates: last 25 graded picks ---
  let homeATSWins = 0, homeATSTotal = 0;
  let roadATSWins = 0, roadATSTotal = 0;
  let overWins = 0, overTotal = 0;
  let goalsForSum = 0, goalsAgainstSum = 0, scoredGames = 0;
  const gameTotals = [];

  try {
    const recentPicks = await db
      .select({
        gameKey: scoredPicksTable.gameKey,
        market: scoredPicksTable.market,
        pick: scoredPicksTable.pick,
        result: scoredPicksTable.result,
      })
      .from(scoredPicksTable)
      .where(
        and(
          eq(scoredPicksTable.league, league),
          gte(scoredPicksTable.date, ninetyDaysAgo),
          lt(scoredPicksTable.date, gameDate)
        )
      );

    const teamPicks = recentPicks.filter((p) => {
      if (p.result === "pending" || p.result === "push") return false;
      const parts = p.gameKey.split("_");
      return parts[2] === abbrev || parts[3] === abbrev;
    });

    const recentScoredGames = recentGames
      .filter((g) => {
        const parts = g.gameKey.split("_");
        return parts[2] === abbrev || parts[3] === abbrev;
      })
      .filter((g) => g.homeScore != null && g.awayScore != null)
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));

    for (const g of recentScoredGames) {
      const parts = g.gameKey.split("_");
      const isAway = parts[2] === abbrev;
      const gf = isAway ? g.awayScore : g.homeScore;
      const ga = isAway ? g.homeScore : g.awayScore;
      goalsForSum += gf;
      goalsAgainstSum += ga;
      scoredGames++;
      gameTotals.push(g.homeScore + g.awayScore);
    }

    if (scoredGames < 3 && recentScoredGames.length > 0) {
      const partialGames = recentScoredGames.slice(0, Math.min(3, recentScoredGames.length));
      goalsForSum = 0;
      goalsAgainstSum = 0;
      scoredGames = 0;
      gameTotals.length = 0;

      for (const g of partialGames) {
        const parts = g.gameKey.split("_");
        const isAway = parts[2] === abbrev;
        const gf = isAway ? g.awayScore : g.homeScore;
        const ga = isAway ? g.homeScore : g.awayScore;
        goalsForSum += gf;
        goalsAgainstSum += ga;
        scoredGames++;
        gameTotals.push(g.homeScore + g.awayScore);
      }
    }

    // ATS record
    const spreadPicks = teamPicks.filter((p) => p.market === "spread");
    for (const p of spreadPicks) {
      const parts = p.gameKey.split("_");
      const isHome = parts[3] === abbrev;
      const isAway = parts[2] === abbrev;
      if (isHome && p.pick === "home") {
        homeATSTotal++;
        if (p.result === "win") homeATSWins++;
      } else if (isAway && p.pick === "away") {
        roadATSTotal++;
        if (p.result === "win") roadATSWins++;
      }
    }

    // Over/under rate
    const totalPicks = teamPicks.filter((p) => p.market === "total");
    for (const p of totalPicks) {
      overTotal++;
      if (p.pick === "over" && p.result === "win") overWins++;
      if (p.pick === "under" && p.result === "loss") overWins++;
    }
  } catch {
    // fallback to neutral
  }

  const MIN_SAMPLE = 3;
  const homeATS = homeATSTotal >= MIN_SAMPLE ? homeATSWins / homeATSTotal : 0.5;
  const roadATS = roadATSTotal >= MIN_SAMPLE ? roadATSWins / roadATSTotal : 0.5;
  const overRate = overTotal >= MIN_SAMPLE ? overWins / overTotal : 0.5;
  const sampleSize = Math.min(homeATSTotal, roadATSTotal, overTotal);
  const fallbackGoalsFor = 2.8;
  const fallbackGoalsAgainst = 2.8;
  const fallbackTotal = 5.8;

  const goalsForAvg = scoredGames > 0 ? goalsForSum / scoredGames : fallbackGoalsFor;
  const goalsAgainstAvg = scoredGames > 0 ? goalsAgainstSum / scoredGames : fallbackGoalsAgainst;
  const last5TotalAvg = gameTotals.length > 0
    ? gameTotals.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, gameTotals.length)
    : fallbackTotal;
  const last10TotalAvg = gameTotals.length > 0
    ? gameTotals.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, gameTotals.length)
    : fallbackTotal;

  return {
    restDays,
    isB2B,
    homeATS,
    roadATS,
    overRate,
    sampleSize,
    goalsForAvg,
    goalsAgainstAvg,
    last5TotalAvg,
    last10TotalAvg,
  };
}

/**
 * Compute features for all games in the batch.
 * Returns a Map from gameKey → GameFeatures.
 */
export async function computeAllFeatures(
  games: GameMarketInput[]
): Promise<Map<string, GameFeatures>> {
  const result = new Map<string, GameFeatures>();

  for (const game of games) {
    try {
      const homeAbbrev = getAbbrev(game.homeTeam, game.league);
      const awayAbbrev = getAbbrev(game.awayTeam, game.league);

      const [homeData, awayData] = await Promise.all([
        computeTeamFeatures(homeAbbrev, game.league, game.snapshotDate),
        computeTeamFeatures(awayAbbrev, game.league, game.snapshotDate),
      ]);

      const restAdvantage = Math.max(-3, Math.min(3, homeData.restDays - awayData.restDays));

      result.set(game.gameKey, {
        homeTeamAbbrev: homeAbbrev,
        awayTeamAbbrev: awayAbbrev,
        homeTeamRestDays: homeData.restDays,
        awayTeamRestDays: awayData.restDays,
        homeTeamB2B: homeData.isB2B,
        awayTeamB2B: awayData.isB2B,
        homeTeamHomeATS: homeData.homeATS,
        awayTeamRoadATS: awayData.roadATS,
        homeTeamOverRate: homeData.overRate,
        awayTeamOverRate: awayData.overRate,
        restAdvantage,
        atsSampleSize: Math.max(homeData.sampleSize, awayData.sampleSize),
        homeGoalsForAvg: homeData.goalsForAvg,
        awayGoalsForAvg: awayData.goalsForAvg,
        homeGoalsAgainstAvg: homeData.goalsAgainstAvg,
        awayGoalsAgainstAvg: awayData.goalsAgainstAvg,
        homeLast5TotalAvg: homeData.last5TotalAvg,
        awayLast5TotalAvg: awayData.last5TotalAvg,
        homeLast10TotalAvg: homeData.last10TotalAvg,
        awayLast10TotalAvg: awayData.last10TotalAvg,
      });
    } catch {
      // If feature computation fails for a game, leave it out of the map;
      // models will fall back to neutral/market-based estimates.
    }
  }

  return result;
}
