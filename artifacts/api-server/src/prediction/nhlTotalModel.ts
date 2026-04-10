/**
 * NHL Total (Over/Under) Prediction Model — v3
 *
 * Uses real team scoring features instead of pick-history proxies.
 * Goal: produce differentiated expected totals across games.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";

const TOTAL_STD_DEV = 1.55;
const LEAGUE_AVG_TOTAL = 6.0;

const OFFENSE_WEIGHT = 0.45;
const DEFENSE_WEIGHT = 0.35;
const RECENT_FORM_WEIGHT = 0.30;
const GOALIE_PROXY_WEIGHT = 0.0;
const B2B_TOTAL_PENALTY = 0.12;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (!game.publishTotal) return {};

  const f = game.features;
  let expectedTotal = game.publishTotal;

  if (f) {
    const offenseAdj =
      (((f.homeGoalsForAvg + f.awayGoalsForAvg) / 2) - (LEAGUE_AVG_TOTAL / 2)) * OFFENSE_WEIGHT * 2;

    const defenseAdj =
      (((f.homeGoalsAgainstAvg + f.awayGoalsAgainstAvg) / 2) - (LEAGUE_AVG_TOTAL / 2)) * DEFENSE_WEIGHT * 2;

    const recent5Avg = (f.homeLast5TotalAvg + f.awayLast5TotalAvg) / 2;
    const recent10Avg = (f.homeLast10TotalAvg + f.awayLast10TotalAvg) / 2;
    const recentFormAdj =
      (((recent5Avg * 0.6 + recent10Avg * 0.4) - game.publishTotal)) * RECENT_FORM_WEIGHT;

    const situationalAdj =
      (f.homeTeamB2B ? -B2B_TOTAL_PENALTY : 0) +
      (f.awayTeamB2B ? -B2B_TOTAL_PENALTY : 0);

    expectedTotal =
      game.publishTotal +
      offenseAdj +
      defenseAdj +
      recentFormAdj +
      GOALIE_PROXY_WEIGHT * 0 +
      situationalAdj;
  }

  const z = (expectedTotal - game.publishTotal) / TOTAL_STD_DEV;
  const probOver = normalCdf(z);
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
