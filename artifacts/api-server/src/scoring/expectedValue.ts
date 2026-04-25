/**
 * Expected Value and Edge calculations.
 */

import { americanToDecimal } from "./marketProb";

/**
 * edge = model_prob_calibrated - market_prob_fair
 */
export function computeEdge(modelProbCalibrated: number, marketProbFair: number): number {
  return modelProbCalibrated - marketProbFair;
}

/**
 * EV = p * (d - 1) - (1 - p)
 * where d is decimal odds and p is calibrated model probability.
 */
export function computeEV(modelProbCalibrated: number, publishOdds: number): number {
  const decimal = americanToDecimal(publishOdds);
  return modelProbCalibrated * (decimal - 1) - (1 - modelProbCalibrated);
}

/**
 * CLV line delta: difference between publish line and close line.
 * Positive CLV means you got a better line than closing.
 */
export function computeClvLineDelta(
  publishLine: number | null,
  closeLine: number | null,
  side: "home" | "away" | "over" | "under"
): number | null {
  if (publishLine == null || closeLine == null) return null;
  const sign = side === "away" || side === "under" ? -1 : 1;
  return sign * (closeLine - publishLine);
}

/**
 * CLV implied delta: closeImplied - publishImplied.
 * Positive means the market moved in your favor (close odds shorter than publish odds
 * → sharps drove the line toward your side → you bought the better price).
 *
 * NOTE: Pre-Plan-1 the implementation returned `publish - close`, which silently
 * inverted the sign relative to this docstring and to the `clvHitRate` convention
 * in validatePicks.ts (which counts `delta > 0` as a hit). The cron-service inline
 * writeback was using the correct `close - publish` formula directly; this helper
 * is now aligned with that convention so it can replace the inline math.
 */
export function computeClvImpliedDelta(
  publishOdds: number,
  closeOdds: number | null,
): number | null {
  if (closeOdds == null) return null;
  const publishImplied = americanToImplied(publishOdds);
  const closeImplied = americanToImplied(closeOdds);
  return closeImplied - publishImplied;
}

function americanToImplied(odds: number): number {
  if (odds >= 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}
