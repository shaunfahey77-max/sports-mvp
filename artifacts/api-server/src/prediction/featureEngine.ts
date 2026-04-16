/**
 * Feature Engine
 *
 * Computes real, data-driven features for each game before prediction models run.
 * Replaces the hash-based noise that was the previous "signal."
 *
 * Features computed:
 *  - Rest days for each team (days since last game)
 *  - Back-to-back flag (0 rest days)
 *  - Rest advantage (home rest - away rest, capped ±3)
 *
 * Previously this engine also computed home/road ATS win rate and team over
 * rate by reading back from scored_picks.result. That was a feedback loop —
 * the model training on its own previous predictions — so those fields are
 * now neutralized to 0.5 with sampleSize=0 until a true external ATS/total
 * result source is wired in.
 */

import { db } from "@workspace/db";
import { gameSnapshotsTable } from "@workspace/db";
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

  // Scoring-history-derived features (goalsFor/Against/totals) from the game
  // snapshots we already fetched. We intentionally do NOT consult
  // `scored_picks.result` here — doing so made features a function of the model's
  // own prior outputs, creating a self-reinforcing feedback loop that inflated
  // historical win rates without predictive value.
  let goalsForSum = 0, goalsAgainstSum = 0, scoredGames = 0;
  const gameTotals: number[] = [];

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
    const gf = (isAway ? g.awayScore : g.homeScore) ?? 0;
    const ga = (isAway ? g.homeScore : g.awayScore) ?? 0;
    goalsForSum += gf;
    goalsAgainstSum += ga;
    scoredGames++;
    gameTotals.push((g.homeScore ?? 0) + (g.awayScore ?? 0));
  }

  // ATS / over rates are neutralized until we have a non-self-referential
  // source (e.g. independent team-stat feed). Keeping these at 0.5 means the
  // prediction models treat them as uninformative priors rather than signal
  // laundered from our own prior predictions.
  const homeATS = 0.5;
  const roadATS = 0.5;
  const overRate = 0.5;
  const sampleSize = 0;
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
