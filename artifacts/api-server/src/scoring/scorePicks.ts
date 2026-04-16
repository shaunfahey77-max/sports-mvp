/**
 * Scoring pipeline orchestrator.
 * Connects prediction models → calibration → market pricing → EV → ranking → tiering.
 */

import type { League, MarketType } from "../config/scoringModelConfig";
import { MAX_EV_CAP } from "../config/scoringModelConfig";
import { computeMarketProbFair, computeMarketQuality } from "./marketProb";
import { calibrateProb, getCalibrationParams, getCalibrationConfidence } from "./calibration";
import { computeEdge, computeEV } from "./expectedValue";
import { rankBets } from "./rankBets";
import { assignTier } from "./assignTiers";
import { computeAllFeatures } from "../prediction/featureEngine";

export interface GameFeatures {
  homeTeamAbbrev: string;
  awayTeamAbbrev: string;
  homeTeamRestDays: number;
  awayTeamRestDays: number;
  homeTeamB2B: boolean;
  awayTeamB2B: boolean;
  homeTeamHomeATS: number;
  awayTeamRoadATS: number;
  homeTeamOverRate: number;
  awayTeamOverRate: number;
  restAdvantage: number;
  atsSampleSize: number;
  homeGoalsForAvg: number;
  awayGoalsForAvg: number;
  homeGoalsAgainstAvg: number;
  awayGoalsAgainstAvg: number;
  homeLast5TotalAvg: number;
  awayLast5TotalAvg: number;
  homeLast10TotalAvg: number;
  awayLast10TotalAvg: number;
}

export interface GameMarketInput {
  gameKey: string;
  league: League;
  eventStart: Date;
  homeTeam: string;
  awayTeam: string;
  homePublishMl: number;
  awayPublishMl: number;
  publishSpread?: number | null;
  publishSpreadLine?: number | null;
  publishAwaySpreadLine?: number | null;
  publishTotal?: number | null;
  publishOverLine?: number | null;
  publishUnderLine?: number | null;
  snapshotDate: string;
  features?: GameFeatures;
}

export interface CandidateOutput {
  gameKey: string;
  league: League;
  marketType: MarketType;
  side: "home" | "away" | "over" | "under";
  eventStart: Date;
  publishOdds: number;
  publishLine: number | null;
  modelProbRaw: number;
  modelProbCalibrated: number;
  marketProbFair: number;
  edge: number;
  ev: number;
  rankScore: number;
  tier: "A" | "B" | "C" | "PASS";
  calibrationMethod: "sigmoid" | "isotonic" | "none";
  calibrationVersion: string;
  marketQuality: number;
  selectionReason: string | null;
  snapshotDate: string;
  modelVersion: string;
}

export interface ModelOutput {
  rawProbHome?: number;
  rawProbAway?: number;
  rawProbOver?: number;
  rawProbUnder?: number;
  expectedMargin?: number;
  marginStdDev?: number;
  expectedTotal?: number;
  totalStdDev?: number;
}

type ModelFn = (game: GameMarketInput) => Promise<ModelOutput>;

/**
 * Import prediction models lazily to avoid circular dependency issues.
 */
async function getModel(league: League, marketType: MarketType): Promise<ModelFn> {
  switch (`${league}_${marketType}`) {
    case "nba_moneyline":
      return (await import("../prediction/nbaMoneylineModel")).predict;
    case "nba_spread":
      return (await import("../prediction/nbaSpreadModel")).predict;
    case "nba_total":
      return (await import("../prediction/nbaTotalModel")).predict;
    case "ncaam_moneyline":
      return (await import("../prediction/ncaamMoneylineModel")).predict;
    case "ncaam_spread":
      return (await import("../prediction/ncaamSpreadModel")).predict;
    case "ncaam_total":
      return (await import("../prediction/ncaamTotalModel")).predict;
    case "nhl_moneyline":
      return (await import("../prediction/nhlMoneylineModel")).predict;
    case "nhl_spread":
      return (await import("../prediction/nhlSpreadModel")).predict;
    case "nhl_total":
      return (await import("../prediction/nhlTotalModel")).predict;
    default:
      throw new Error(`No model for ${league}_${marketType}`);
  }
}

async function scoreMarket(
  game: GameMarketInput,
  marketType: MarketType,
  modelVersion: string
): Promise<CandidateOutput[]> {
  const model = await getModel(game.league, marketType);
  const output = await model(game);
  const calibParams = getCalibrationParams(game.league, marketType);

  const results: CandidateOutput[] = [];

  const hasSpread = game.publishSpread != null;
  const hasTotal = game.publishTotal != null;

  if (marketType === "moneyline") {
    const sides: Array<["home" | "away", number, number | undefined]> = [
      ["home", game.homePublishMl, output.rawProbHome],
      ["away", game.awayPublishMl, output.rawProbAway],
    ];
    for (const [side, publishOdds, rawProb] of sides) {
      if (rawProb == null) continue;
      const calibrated = calibrateProb(rawProb, calibParams);
      const marketProbFair = computeMarketProbFair({
        marketType,
        side,
        homePublishMl: game.homePublishMl,
        awayPublishMl: game.awayPublishMl,
      });
      const edge = computeEdge(calibrated, marketProbFair);
      const ev = Math.min(MAX_EV_CAP, computeEV(calibrated, publishOdds));
      const calibConf = getCalibrationConfidence(game.league, marketType, rawProb);
      const mq = computeMarketQuality({
        league: game.league,
        marketType,
        publishOdds,
        hasSpread,
        hasTotal,
      });
      results.push({
        gameKey: game.gameKey,
        league: game.league,
        marketType,
        side,
        eventStart: game.eventStart,
        publishOdds,
        publishLine: null,
        modelProbRaw: rawProb,
        modelProbCalibrated: calibrated,
        marketProbFair,
        edge,
        ev,
        rankScore: 0,
        tier: "PASS",
        calibrationMethod: calibParams.method,
        calibrationVersion: calibParams.version,
        marketQuality: mq,
        selectionReason: null,
        snapshotDate: game.snapshotDate,
        modelVersion,
      });
    }
  } else if (marketType === "spread") {
    if (!hasSpread) return [];
    const spreadLine = game.publishSpreadLine ?? -110;
    // Use the actual away spread line from the API if available.
    // Fall back to assuming the same juice as home (symmetric market).
    const awaySpreadLine = game.publishAwaySpreadLine ?? spreadLine;
    const sides: Array<["home" | "away", number, number | undefined]> = [
      ["home", spreadLine, output.rawProbHome],
      ["away", awaySpreadLine, output.rawProbAway],
    ];
    for (const [side, publishOdds, rawProb] of sides) {
      if (rawProb == null) continue;
      const calibrated = calibrateProb(rawProb, calibParams);
      const marketProbFair = computeMarketProbFair({
        marketType,
        side,
        homePublishMl: game.homePublishMl,
        awayPublishMl: game.awayPublishMl,
        publishSpreadLine: game.publishSpreadLine,
        publishAwaySpreadLine: game.publishAwaySpreadLine,
      });
      const edge = computeEdge(calibrated, marketProbFair);
      const ev = Math.min(MAX_EV_CAP, computeEV(calibrated, publishOdds));
      const calibConf = getCalibrationConfidence(game.league, marketType, rawProb);
      const mq = computeMarketQuality({
        league: game.league,
        marketType,
        publishOdds,
        hasSpread,
        hasTotal,
      });
      // publishSpread is the HOME team's spread (e.g. -19 for Detroit).
      // When our pick is the AWAY team we negate it so the bettor sees the
      // correct number (+19 for Milwaukee).
      const pickPublishLine =
        side === "home"
          ? (game.publishSpread ?? null)
          : game.publishSpread != null
          ? -game.publishSpread
          : null;

      results.push({
        gameKey: game.gameKey,
        league: game.league,
        marketType,
        side,
        eventStart: game.eventStart,
        publishOdds,
        publishLine: pickPublishLine,
        modelProbRaw: rawProb,
        modelProbCalibrated: calibrated,
        marketProbFair,
        edge,
        ev,
        rankScore: 0,
        tier: "PASS",
        calibrationMethod: calibParams.method,
        calibrationVersion: calibParams.version,
        marketQuality: mq,
        selectionReason: null,
        snapshotDate: game.snapshotDate,
        modelVersion,
      });
    }
  } else if (marketType === "total") {
    if (!hasTotal) return [];
    const overLine = game.publishOverLine ?? -110;
    const underLine = game.publishUnderLine ?? -110;
    const sides: Array<["over" | "under", number, number | undefined]> = [
      ["over", overLine, output.rawProbOver],
      ["under", underLine, output.rawProbUnder],
    ];
    for (const [side, publishOdds, rawProb] of sides) {
      if (rawProb == null) continue;
      const calibrated = calibrateProb(rawProb, calibParams);
      const marketProbFair = computeMarketProbFair({
        marketType,
        side,
        homePublishMl: game.homePublishMl,
        awayPublishMl: game.awayPublishMl,
        publishOverLine: game.publishOverLine,
        publishUnderLine: game.publishUnderLine,
      });
      const edge = computeEdge(calibrated, marketProbFair);
      const ev = Math.min(MAX_EV_CAP, computeEV(calibrated, publishOdds));
      const calibConf = getCalibrationConfidence(game.league, marketType, rawProb);
      const mq = computeMarketQuality({
        league: game.league,
        marketType,
        publishOdds,
        hasSpread,
        hasTotal,
      });
      results.push({
        gameKey: game.gameKey,
        league: game.league,
        marketType,
        side,
        eventStart: game.eventStart,
        publishOdds,
        publishLine: game.publishTotal ?? null,
        modelProbRaw: rawProb,
        modelProbCalibrated: calibrated,
        marketProbFair,
        edge,
        ev,
        rankScore: 0,
        tier: "PASS",
        calibrationMethod: calibParams.method,
        calibrationVersion: calibParams.version,
        marketQuality: mq,
        selectionReason: null,
        snapshotDate: game.snapshotDate,
        modelVersion,
      });
    }
  }

  return results;
}

export async function scorePicks(
  games: GameMarketInput[],
  markets: MarketType[],
  modelVersion: string
): Promise<CandidateOutput[]> {
  const allCandidates: CandidateOutput[] = [];

  // Pre-compute features for all games (rest days, ATS records, etc.)
  const featuresMap = await computeAllFeatures(games);
  const gamesWithFeatures = games.map((g) => ({
    ...g,
    features: featuresMap.get(g.gameKey) ?? g.features,
  }));

  for (const game of gamesWithFeatures) {
    for (const market of markets) {
      const candidates = await scoreMarket(game, market, modelVersion);
      allCandidates.push(...candidates);
    }
  }

  if (allCandidates.length === 0) return [];

  const rankInputs = allCandidates.map((c) => ({
    ev: c.ev,
    edge: c.edge,
    calibrationConfidence: getCalibrationConfidence(c.league, c.marketType, c.modelProbRaw),
    marketQuality: c.marketQuality,
  }));

  const rankScores = rankBets(rankInputs);

  return allCandidates.map((c, i) => {
    const rankScore = rankScores[i];
    const { tier, selectionReason } = assignTier({
      rankScore,
      edge: c.edge,
      ev: c.ev,
      marketQuality: c.marketQuality,
      league: c.league,
      marketType: c.marketType,
    });
    return { ...c, rankScore, tier, selectionReason };
  });
}
