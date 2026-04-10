/**
 * NBA Total (Over/Under) Prediction Model — v2
 *
 * Starts from the posted total (the market's best consensus estimate),
 * then adjusts for real factors: back-to-back fatigue (reduces scoring)
 * and each team's recent over/under tendency.
 * Hash noise removed.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";

const TOTAL_STD_DEV = 11.5;

// Back-to-back teams score ~3 fewer points on average (tired legs)
const B2B_SCORING_REDUCTION = 3.0;
// Over/under rate: teams on an over/under streak can nudge the expected total
const MAX_OVER_RATE_ADJ = 2.5;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (!game.publishTotal) {
    return {};
  }

  let expectedTotal = game.publishTotal;

  // --- Feature-based adjustments ---
  const f = game.features;
  if (f) {
    // Fatigue: B2B teams score less
    if (f.homeTeamB2B) expectedTotal -= B2B_SCORING_REDUCTION;
    if (f.awayTeamB2B) expectedTotal -= B2B_SCORING_REDUCTION;

    // Recent over/under tendency (only apply when sample is meaningful)
    if (f.atsSampleSize >= 10) {
      const homeAdj = (f.homeTeamOverRate - 0.5) * MAX_OVER_RATE_ADJ * 2;
      const awayAdj = (f.awayTeamOverRate - 0.5) * MAX_OVER_RATE_ADJ * 2;
      const combined = Math.max(-MAX_OVER_RATE_ADJ, Math.min(MAX_OVER_RATE_ADJ, (homeAdj + awayAdj) / 2));
      expectedTotal += combined;
    }
  }

  const baseTotal = game.publishTotal;
  const probOver = normalCdf((expectedTotal - baseTotal) / TOTAL_STD_DEV);
  const probUnder = 1 - probOver;

  return {
    rawProbOver: clamp(probOver, 0.05, 0.95),
    rawProbUnder: clamp(probUnder, 0.05, 0.95),
    expectedTotal,
    totalStdDev: TOTAL_STD_DEV,
  };
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
