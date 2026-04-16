/**
 * NCAAM Total (Over/Under) Prediction Model.
 *
 * EXPERIMENTAL — NOT PRODUCTION-READY.
 * Expected total is just the published line plus a deterministic hash-derived
 * offset — no real features. NCAAM is gated off from production-facing endpoints
 * and cron by default; opt in explicitly via ?league=ncaam.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";

const LEAGUE = "ncaam";
const TOTAL_STD_DEV = 14.0;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  if (!game.publishTotal) return {};

  const baseTotal = game.publishTotal;
  const noise = modelNoise(game.gameKey, "total");
  const expectedTotal = baseTotal + noise * 5;

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
  const y = 1.0 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign * y;
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
  return ((hash % 1000) / 1000 - 0.5);
}
