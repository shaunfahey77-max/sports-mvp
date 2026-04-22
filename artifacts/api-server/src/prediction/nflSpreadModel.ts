/**
 * NFL Spread Prediction Model — v2 (2026-04-21 redesign pass)
 *
 * Branch only, internal only, NO DEPLOY. The market itself remains gated
 * via `MARKET_DISABLED.nfl_spread = true` until a historical backtest
 * justifies flipping the flag. NFL is also still excluded from the cron
 * `LEAGUES` list, so this model only runs when explicitly invoked
 * (e.g. by an internal backtest harness).
 *
 * --- Why v2: ---
 *   The 2025 v1 backtest (.local/backtest-reports/nfl-2025.txt) returned
 *   ROI -6.2% with average model edge ~ 0. Diagnosis: v1's "model" was
 *   essentially a near-arbitrage between two sides of the same market —
 *   it derived expected margin from the vig-free moneyline, then added
 *   a constant home-field advantage on top (which was already priced
 *   into the moneyline = double-counted), then applied a tiny rest term
 *   (0.2 pts/day, max ~±1.4 pts shift). With no independent feature
 *   signal, the model could not deviate meaningfully from the market.
 *
 *   Full plan: `.local/football-redesign-plan.md`.
 *
 * --- v2 changes vs v1: ---
 *   1. REMOVED the additive HFA after probToMargin(fairHome). The vig-
 *      free moneyline already prices in the market's full home-side
 *      premium. The previous `+ hfaPoints` line was a double-count.
 *   2. ADDED home/road ATS form adjustment (mirrors nbaSpreadModel.ts):
 *      ±2.5 pts max when atsSampleSize >= 10.
 *   3. ADDED recent points-for / points-against differential adjustment:
 *      `(homeNet - awayNet) * 0.30`, capped ±5 pts, gated on
 *      `scoredGamesSampleSize >= 3` so Week-1 / preseason games (where no
 *      team-strength signal exists) don't get a spurious adjustment.
 *      We deliberately do NOT gate this on `atsSampleSize` — that field
 *      is currently a stubbed-zero placeholder in `featureEngine.ts`
 *      pending a real ATS data feed, and using it would dormancy-gate
 *      the PPG feature in the live pipeline. PPG averages themselves
 *      come from real historical scores and are non-stubbed.
 *   4. KEPT real rest at 0.20 pts/day (preserved v1 weight; no retune
 *      without backtest evidence).
 *
 *   Combined feature stack can now shift expected margin by up to
 *   roughly ±9 pts (vs v1's ~±0.6 pts), giving the model ~15× more
 *   independent expressiveness. The market-derived prior is preserved
 *   in full but no longer dominates — features can now express real
 *   directional signal.
 *
 * --- Constants: ---
 *   - MARGIN_STD_DEV = 13.45  (historical NFL final-margin σ; matches
 *     the value commonly cited in academic football analytics.)
 *   - REST_ADV_POINTS_PER_DAY = 0.20  (small, conservative — preserved
 *     from v1 since we have no backtest data justifying a retune yet.)
 *   - ATS_FORM_MAX_ADJ = 2.5   (mirrors NBA spread model.)
 *   - ATS_MIN_SAMPLE = 10      (threshold for ATS ratio to be meaningful.)
 *   - PPG_DIFF_WEIGHT = 0.30   (points of margin per net-PPG-differential
 *     pt. A typical strong-vs-weak NFL matchup has a ~10 net-PPG gap →
 *     +3.0 pts margin shift, which is meaningful but not extreme.)
 *   - PPG_DIFF_MAX_ADJ = 5.0   (cap to prevent extreme early-season
 *     blowout-skewed averages from dominating.)
 *   - PPG_MIN_SAMPLE = 3       (need at least 3 games of data before
 *     PPG averages carry signal; lower than the ATS threshold because
 *     PPG has better signal-to-noise than win-rate ratios.)
 *
 * Future enhancements (deferred to v3, will require extending
 * `GameFeatures`): bye-week boost beyond rest-day proxy, divisional
 * adjustment, primetime/Thursday-night flag, indoor/outdoor + weather,
 * injury-report adjustment.
 *
 * Probability clamps preserve symmetric numerical safety with the NHL
 * spread model (0.05 / 0.95). The clamp is intentionally generous: NFL
 * spreads of ±14+ legitimately produce cover probabilities approaching
 * the boundary, and we let the calibration layer compress further.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";

export const MARGIN_STD_DEV = 13.45;
export const REST_ADV_POINTS_PER_DAY = 0.20;
// v2.1 calibration shrink (2026-04-22): the v2 backtest showed Tier A
// losing at -11.3% ROI (n=134) and Brier/log-loss regressing vs v1
// because the additive feature stack was too aggressively scaled —
// model produced 0.65–0.72 probs that realized at 44–56%. v2.1 halves
// the ATS form cap and the PPG-differential coefficient (and its cap
// proportionally) to compress probs back toward [0.40, 0.60] while
// preserving directional signal. Architecture, gates, and pipeline are
// unchanged. See `.local/backtest-reports/nfl-2025-v2-VERDICT.md`.
export const ATS_FORM_MAX_ADJ = 1.25; // v2: 2.5 → v2.1: 1.25 (halved)
export const ATS_MIN_SAMPLE = 10;
export const PPG_DIFF_WEIGHT = 0.15;  // v2: 0.30 → v2.1: 0.15 (halved)
export const PPG_DIFF_MAX_ADJ = 2.5;  // v2: 5.0  → v2.1: 2.5  (proportional)
export const PPG_MIN_SAMPLE = 3;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (game.publishSpread == null) return {};

  const { fairA: fairHome } = removeTwoSidedVig(
    game.homePublishMl,
    game.awayPublishMl
  );

  // v2: market-derived prior, used as-is. The vig-free moneyline already
  // contains the market's full home-side premium; do NOT add an extra
  // HOME_ADVANTAGE term on top (that was the v1 double-count).
  let expectedMargin = probToMargin(fairHome, MARGIN_STD_DEV);

  // --- v2 feature stack: independent signals layered on the prior. ---
  const f = game.features;
  if (f) {
    // Real rest. NFL has no true back-to-back, but has short weeks
    // (Thursday after Sunday) and bye-week recoveries that the market
    // does not always fully price.
    expectedMargin += f.restAdvantage * REST_ADV_POINTS_PER_DAY;

    // ATS form. Recent home/road ATS records are independent of the
    // pricing on this game (they reflect prior games' results) and
    // represent a real coverage edge when meaningful sample exists.
    // Mirrors the NBA spread model exactly so behavior is consistent
    // across leagues.
    if (f.atsSampleSize >= ATS_MIN_SAMPLE) {
      const homeATSAdj = (f.homeTeamHomeATS - 0.5) * ATS_FORM_MAX_ADJ * 2;
      const awayATSAdj = (f.awayTeamRoadATS - 0.5) * ATS_FORM_MAX_ADJ * 2;
      expectedMargin += clamp(
        homeATSAdj - awayATSAdj,
        -ATS_FORM_MAX_ADJ,
        ATS_FORM_MAX_ADJ
      );
    }

    // Recent points-for / points-against differential. The single
    // strongest predictor in football beyond the market price itself.
    // Gated on `scoredGamesSampleSize` — the count of recent games for
    // which we have actual final scores in our snapshot store. This is
    // intentionally distinct from `atsSampleSize` (currently a stubbed
    // placeholder, which would dormancy-gate this feature in the live
    // pipeline if used). Capped to prevent extreme early-season
    // blowout-skewed averages from dominating.
    if (f.scoredGamesSampleSize >= PPG_MIN_SAMPLE) {
      const homeNet = f.homeGoalsForAvg - f.homeGoalsAgainstAvg;
      const awayNet = f.awayGoalsForAvg - f.awayGoalsAgainstAvg;
      const ppgAdj = (homeNet - awayNet) * PPG_DIFF_WEIGHT;
      expectedMargin += clamp(ppgAdj, -PPG_DIFF_MAX_ADJ, PPG_DIFF_MAX_ADJ);
    }
  }

  // `publishSpread` is the home team's spread (negative if home favored).
  // To compute "home covers", express the spread as the line the home team
  // must beat: spread of -3.5 means home covers iff homeMargin > 3.5.
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

// --- math helpers (kept module-local; identical algebra to nhlSpreadModel) ---

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
