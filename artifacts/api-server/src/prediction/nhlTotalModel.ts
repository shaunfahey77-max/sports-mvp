/**
 * NHL Total (Over/Under) Prediction Model — v2
 *
 * NHL totals are lower-scoring (~5.5–6.5 goals, std dev ~1.5).
 * Adjusts for B2B fatigue and recent over/under tendencies.
 * Hash noise removed.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";

const TOTAL_STD_DEV = 1.55;

// NHL B2B: ~0.4 fewer goals per tired team
const B2B_GOAL_REDUCTION = 0.4;
const MAX_OVER_RATE_ADJ = 0.3;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (!game.publishTotal) return {};

  let expectedTotal = game.publishTotal;

  const f = game.features;
  if (f) {
    if (f.homeTeamB2B) expectedTotal -= B2B_GOAL_REDUCTION;
    if (f.awayTeamB2B) expectedTotal -= B2B_GOAL_REDUCTION;

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
