/**
 * NCAAM Spread Prediction Model.
 * College basketball has higher variance (~14 points std dev vs NBA's ~12).
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "ncaam";
const MARGIN_STD_DEV = 14.0;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (!game.publishSpread) return {};

  const { fairA: fairHome } = removeTwoSidedVig(game.homePublishMl, game.awayPublishMl);
  const expectedMargin = probToMargin(fairHome, MARGIN_STD_DEV) + HOME_ADVANTAGE[LEAGUE] * 6;

  const spread = game.publishSpread;
  const probHomeCovers = normalCdf((expectedMargin - spread) / MARGIN_STD_DEV);
  const probAwayCovers = 1 - probHomeCovers;
  const noise = modelNoise(game.gameKey, "spread");

  return {
    rawProbHome: clamp(probHomeCovers + noise, 0.05, 0.95),
    rawProbAway: clamp(probAwayCovers - noise, 0.05, 0.95),
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

function normalInvCdf(p: number): number {
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function modelNoise(gameKey: string, suffix: string): number {
  let hash = 0;
  const str = gameKey + suffix + LEAGUE;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return ((hash % 1000) / 1000 - 0.5) * 0.03;
}
