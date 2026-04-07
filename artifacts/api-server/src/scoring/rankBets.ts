/**
 * Bet ranking engine.
 * Applies the unified ranking formula across all leagues and markets.
 */

import { RANK_WEIGHTS } from "../config/scoringModelConfig";

export interface RankInput {
  ev: number;
  edge: number;
  calibrationConfidence: number;
  marketQuality: number;
}

/**
 * Normalize an array of values to [0, 1] using min-max normalization.
 */
function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

/**
 * Compute rank scores for a batch of candidates.
 * rank_score = 0.50 * norm_ev + 0.25 * norm_edge + 0.15 * calibration_confidence + 0.10 * market_quality
 */
export function rankBets(candidates: RankInput[]): number[] {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    const c = candidates[0];
    return [
      RANK_WEIGHTS.ev * 0.5 +
        RANK_WEIGHTS.edge * 0.5 +
        RANK_WEIGHTS.calibrationConfidence * c.calibrationConfidence +
        RANK_WEIGHTS.marketLiquidityConfidence * c.marketQuality,
    ];
  }

  const evValues = candidates.map((c) => c.ev);
  const edgeValues = candidates.map((c) => c.edge);

  const normEv = minMaxNormalize(evValues);
  const normEdge = minMaxNormalize(edgeValues);

  return candidates.map((c, i) => {
    return (
      RANK_WEIGHTS.ev * normEv[i] +
      RANK_WEIGHTS.edge * normEdge[i] +
      RANK_WEIGHTS.calibrationConfidence * c.calibrationConfidence +
      RANK_WEIGHTS.marketLiquidityConfidence * c.marketQuality
    );
  });
}

/**
 * Rank a single bet against a known population distribution.
 * Uses pre-computed population stats to place the bet.
 */
export function rankSingleBet(
  input: RankInput,
  populationStats: { evMin: number; evMax: number; edgeMin: number; edgeMax: number }
): number {
  const { evMin, evMax, edgeMin, edgeMax } = populationStats;

  const normEv = evMax === evMin ? 0.5 : (input.ev - evMin) / (evMax - evMin);
  const normEdge =
    edgeMax === edgeMin ? 0.5 : (input.edge - edgeMin) / (edgeMax - edgeMin);

  return (
    RANK_WEIGHTS.ev * Math.max(0, Math.min(1, normEv)) +
    RANK_WEIGHTS.edge * Math.max(0, Math.min(1, normEdge)) +
    RANK_WEIGHTS.calibrationConfidence * input.calibrationConfidence +
    RANK_WEIGHTS.marketLiquidityConfidence * input.marketQuality
  );
}
