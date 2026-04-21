/**
 * NCAAF Spread Prediction Model — v1 (Phase 0.75F build).
 *
 * Branch only, internal only, NO DEPLOY. The market remains gated via
 * `MARKET_DISABLED.ncaaf_spread = true` until a historical backtest
 * justifies flipping the flag. NCAAF is also still excluded from the
 * cron `LEAGUES` list, so this model only runs when explicitly invoked
 * (e.g. by an internal backtest harness).
 *
 * Approach mirrors `nflSpreadModel`:
 *   1. Vig-free moneyline → home win probability.
 *   2. Inverse normal CDF → expected margin, scaled by the NCAAF margin
 *      standard deviation (wider than NFL: college games have larger
 *      talent gaps and a much longer tail of blowouts).
 *   3. Add a points-form HFA (`HOME_ADVANTAGE.ncaaf * MARGIN_STD_DEV`).
 *   4. Adjust for rest advantage. College football has rare short weeks
 *      (Fri-after-Sat or Sat-after-Wed) and bye weeks; bye-week and
 *      conference-specific features are deferred until `GameFeatures`
 *      is extended.
 *   5. Normal CDF → cover probability around the published spread.
 *
 * Constants:
 *   - MARGIN_STD_DEV = 16.5  (historical college football final-margin σ;
 *     larger than NFL's 13.45 due to wider talent disparity. Top-25 vs
 *     unranked routinely produce 30-50 point margins; very few NFL
 *     games end with a margin >30.)
 *   - REST_ADV_POINTS_PER_DAY = 0.20  (mirrors NFL until backtest tunes.
 *     College rest patterns are mostly week-to-week so this rarely fires
 *     non-trivially.)
 *
 * Future enhancements (deferred to post-backtest, will require extending
 * `GameFeatures`): bye-week boost, ranked-vs-unranked indicator,
 * conference-strength adjustment, neutral-site flag, weather, primetime.
 *
 * Probability clamps: [0.05, 0.95]. The clamp is intentionally generous;
 * NCAAF spreads of ±35+ legitimately produce cover probabilities near
 * the boundary, and the calibration layer compresses further.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "ncaaf";
export const MARGIN_STD_DEV = 16.5;
export const REST_ADV_POINTS_PER_DAY = 0.20;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (game.publishSpread == null) return {};

  const { fairA: fairHome } = removeTwoSidedVig(
    game.homePublishMl,
    game.awayPublishMl
  );

  const hfaPoints = HOME_ADVANTAGE[LEAGUE] * MARGIN_STD_DEV;
  let expectedMargin = probToMargin(fairHome, MARGIN_STD_DEV) + hfaPoints;

  const f = game.features;
  if (f) {
    expectedMargin += f.restAdvantage * REST_ADV_POINTS_PER_DAY;
  }

  // `publishSpread` is the home team's spread (negative if home favored).
  const homeLineToBeat = -(game.publishSpread ?? 0);
  const probHomeCovers = normalCdf(
    (expectedMargin - homeLineToBeat) / MARGIN_STD_DEV
  );
  const probAwayCovers = 1 - probHomeCovers;

  return {
    rawProbHome: clamp(probHomeCovers, 0.05, 0.95),
    rawProbAway: clamp(probAwayCovers, 0.05, 0.95),
    expectedMargin,
    marginStdDev: MARGIN_STD_DEV,
  };
}

// --- math helpers (kept module-local; identical algebra to nflSpreadModel) ---

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
  const pC = Math.max(pLow, Math.min(pHigh, p));
  if (pC < pLow) {
    const q = Math.sqrt(-2 * Math.log(pC));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (pC <= pHigh) {
    const q = pC - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - pC));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
