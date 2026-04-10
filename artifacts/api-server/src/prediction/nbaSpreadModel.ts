/**
 * NBA Spread Prediction Model — v2
 *
 * Uses normal-distribution margin model over market-implied win probability,
 * adjusted by real game-day features: rest, back-to-back, and recent ATS form.
 * Hash noise removed; all signal is data-derived.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "nba";
const MARGIN_STD_DEV = 12.0;

// Back-to-back teams lose ~3.5 pts of margin on average
const B2B_PENALTY_PTS = 3.5;
// Each extra rest day advantage worth ~0.5 pts (capped via restAdvantage ±3)
const REST_ADV_PTS_PER_DAY = 0.5;
// ATS form: teams covering >60% or <40% recently get an adjustment (in pts)
const ATS_FORM_MAX_ADJ = 2.5;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (!game.publishSpread) {
    return {};
  }

  const { fairA: fairHome } = removeTwoSidedVig(game.homePublishMl, game.awayPublishMl);
  const homeAdvPts = HOME_ADVANTAGE[LEAGUE] * 5;

  // Base expected margin from market-implied probability
  let expectedMargin = probToMargin(fairHome, MARGIN_STD_DEV) + homeAdvPts;

  // --- Feature-based adjustments ---
  const f = game.features;
  if (f) {
    // Back-to-back penalty
    if (f.homeTeamB2B) expectedMargin -= B2B_PENALTY_PTS;
    if (f.awayTeamB2B) expectedMargin += B2B_PENALTY_PTS;

    // Rest advantage (positive = home rested more)
    expectedMargin += f.restAdvantage * REST_ADV_PTS_PER_DAY;

    // ATS form adjustment (only apply when sample is meaningful)
    if (f.atsSampleSize >= 10) {
      const homeATSAdj = (f.homeTeamHomeATS - 0.5) * ATS_FORM_MAX_ADJ * 2;
      const awayATSAdj = (f.awayTeamRoadATS - 0.5) * ATS_FORM_MAX_ADJ * 2;
      // Home covering more → margin higher; away covering more → margin lower
      expectedMargin += Math.max(-ATS_FORM_MAX_ADJ, Math.min(ATS_FORM_MAX_ADJ, homeATSAdj - awayATSAdj));
    }
  }

  const spread = -(game.publishSpread ?? 0);
  const probHomeCovers = normalCdf((expectedMargin - spread) / MARGIN_STD_DEV);
  const probAwayCovers = 1 - probHomeCovers;

  return {
    rawProbHome: clamp(probHomeCovers, 0.05, 0.95),
    rawProbAway: clamp(probAwayCovers, 0.05, 0.95),
    expectedMargin,
    marginStdDev: MARGIN_STD_DEV,
  };
}

function probToMargin(prob: number, std: number): number {
  return normalInvCdf(prob) * std;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalInvCdf(prob: number): number {
  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00
  ];
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00
  ];
  const d = [
    7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00
  ];
  const pLow = 0.02425, pHigh = 1 - pLow;
  const pClamped = Math.max(pLow, Math.min(pHigh, prob));
  if (pClamped < pLow) {
    const q = Math.sqrt(-2 * Math.log(pClamped));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (pClamped <= pHigh) {
    const q = pClamped - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - pClamped));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
