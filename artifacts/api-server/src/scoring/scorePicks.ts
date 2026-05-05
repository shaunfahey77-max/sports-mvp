/**
 * Scoring pipeline orchestrator.
 * Connects prediction models → calibration → market pricing → EV → ranking → tiering.
 */

import type { League, MarketType } from "../config/scoringModelConfig";
import { MAX_EV_CAP, MARKET_DISABLED, MARKET_MODEL_WATCH_ONLY } from "../config/scoringModelConfig";
import { computeMarketProbFair, computeMarketQuality } from "./marketProb";
import { calibrateProb, getCalibrationParams, getCalibrationConfidence } from "./calibration";
import { computeEdge, computeEV } from "./expectedValue";
import { rankBets } from "./rankBets";
import { assignTier } from "./assignTiers";
import type { ResolvedSurfaceStatus } from "./marketRegistryResolver";

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
  /**
   * Count of recent games (per team, max-of-home/away) for which we have
   * actual final scores in our snapshot store. Distinct from `atsSampleSize`,
   * which is currently a stubbed-zero placeholder pending a real ATS data
   * feed (see `featureEngine.ts`). Use this gate for points-derived features
   * (PPG-for, PPG-against, totals averages) — those values come from real
   * historical scores and are non-stubbed.
   */
  scoredGamesSampleSize: number;
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
    case "mlb_moneyline":
      return (await import("../prediction/mlbMoneylineModel")).predict;
    case "nfl_spread":
      // NFL Phase 0.75E: model is built but the market remains gated via
      // MARKET_DISABLED.nfl_spread = true and NFL is not in cron LEAGUES.
      // This case exists so internal backtest harnesses can invoke the
      // model directly without flipping the production gates.
      return (await import("../prediction/nflSpreadModel")).predict;
    case "ncaaf_spread":
      // NCAAF Phase 0.75F: same posture as nfl_spread — model is built
      // for backtest invocation only. MARKET_DISABLED.ncaaf_spread = true
      // and ncaaf is not in cron LEAGUES.
      return (await import("../prediction/ncaafSpreadModel")).predict;
    default:
      throw new Error(`No model for ${league}_${marketType}`);
  }
}

/**
 * Returns true when a prediction model is registered for the given
 * league/market combination. Used by scorePicks to silently skip
 * markets a league does not model (e.g. mlb_spread, mlb_total) so
 * historical ingest and live scoring don't crash on otherwise-valid
 * snapshots. Keep this list in sync with getModel above.
 */
function hasModel(league: League, marketType: MarketType): boolean {
  switch (`${league}_${marketType}`) {
    case "nba_moneyline":
    case "nba_spread":
    case "nba_total":
    case "ncaam_moneyline":
    case "ncaam_spread":
    case "ncaam_total":
    case "nhl_moneyline":
    case "nhl_spread":
    case "nhl_total":
    case "mlb_moneyline":
    case "nfl_spread":
    case "ncaaf_spread":
      return true;
    default:
      return false;
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

export interface ScorePicksOptions {
  /**
   * Leagues that opt in to the odds-range guardrail (see
   * DEFAULT_ODDS_RANGE / ODDS_RANGE_OVERRIDE in scoringModelConfig). Only
   * candidates whose `league` is in this list will have their `publishOdds`
   * range-checked before tier assignment.
   *
   * Left undefined by design: simulation and historical paths don't set
   * this, so their behavior is bit-for-bit unchanged.
   */
  oddsRangeGuardrailLeagues?: readonly League[];
  /**
   * Transitional injection point for tests / replay code that want to control
   * market surface status without touching the registry. When omitted, scorePicks
   * resolves statuses from market_registry with safe legacy fallback.
   */
  surfaceStatusByMarketKey?: Partial<Record<string, ResolvedSurfaceStatus>>;
}

export async function scorePicks(
  games: GameMarketInput[],
  markets: MarketType[],
  modelVersion: string,
  options: ScorePicksOptions = {}
): Promise<CandidateOutput[]> {
  const allCandidates: CandidateOutput[] = [];

  // Pre-compute features for all games (rest days, ATS records, etc.)
  const featuresMap = await (await import("../prediction/featureEngine")).computeAllFeatures(games);
  const gamesWithFeatures = games.map((g) => ({
    ...g,
    features: featuresMap.get(g.gameKey) ?? g.features,
  }));

  for (const game of gamesWithFeatures) {
    for (const market of markets) {
      // Skip markets that have no registered model for this league
      // (e.g. mlb_spread, mlb_total). Avoids "No model for X" crashes
      // during historical ingest of leagues that only model a subset of
      // markets. Live cron is unaffected because the market list passed
      // in already excludes disabled markets.
      if (!hasModel(game.league, market)) continue;
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

  const resolvedSurfaceStatuses =
    options.surfaceStatusByMarketKey ??
    (
      await (await import("./marketRegistryResolver")).resolveSurfaceStatusesForMarketKeys(
        Array.from(new Set(allCandidates.map((c) => `${c.league}_${c.marketType}`))),
      )
    ).byMarketKey;

  return applyTieringToCandidates(allCandidates, rankScores, {
    ...options,
    surfaceStatusByMarketKey: resolvedSurfaceStatuses,
  });
}

/**
 * Final stage of the scoring pipeline: attach rank_score and run per-league
 * tier assignment (including the opt-in odds-range guardrail). Extracted so
 * it can be tested in isolation without standing up the prediction / DB
 * layer, and so the per-league gating of `oddsRangeGuardrailLeagues` is a
 * real integration point rather than a mirror of routes/*.ts logic.
 */
export function applyTieringToCandidates(
  allCandidates: CandidateOutput[],
  rankScores: number[],
  options: ScorePicksOptions = {}
): CandidateOutput[] {
  const guardrailLeagues = options.oddsRangeGuardrailLeagues;
  const surfaceStatusByMarketKey = options.surfaceStatusByMarketKey;

  return allCandidates.map((c, i) => {
    const rankScore = rankScores[i];
    const marketKey = `${c.league}_${c.marketType}`;
    const resolvedSurfaceStatus =
      surfaceStatusByMarketKey?.[marketKey] ??
      (MARKET_DISABLED[marketKey]
        ? "suppressed"
        : MARKET_MODEL_WATCH_ONLY[marketKey]
        ? "model_watch"
        : undefined);
    const enableOddsRangeGuardrail =
      guardrailLeagues != null && guardrailLeagues.includes(c.league);
    const { tier, selectionReason } = assignTier({
      rankScore,
      edge: c.edge,
      ev: c.ev,
      marketQuality: c.marketQuality,
      league: c.league,
      marketType: c.marketType,
      publishOdds: c.publishOdds,
      publishLine: c.publishLine,
      enableOddsRangeGuardrail,
      surfaceStatus: resolvedSurfaceStatus,
    });

    // Registry-aware surface-status override. Runs AFTER assignTier so data
    // quality rejects (odds_out_of_range) always win.
    //
    // The rebuild contract is:
    // - model_watch => preserve candidate row but force PASS / model_watch_only
    // - suppressed  => force PASS / market_disabled
    // - official/shadow => keep assignTier outcome
    //
    // This is the first scorer-core step away from hard-coded config maps
    // toward registry-driven behavior, while still allowing sync tests to
    // inject a surface-status map directly.
    if (selectionReason !== "odds_out_of_range") {
      if (
        resolvedSurfaceStatus === "model_watch" &&
        selectionReason !== "market_disabled"
      ) {
        return {
          ...c,
          rankScore,
          tier: "PASS" as const,
          selectionReason: "model_watch_only",
        };
      }
    }

    return { ...c, rankScore, tier, selectionReason };
  });
}
