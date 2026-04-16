/**
 * Bet ranking engine.
 * Applies the unified ranking formula across all leagues and markets.
 */

import { RANK_WEIGHTS, MAX_EV_CAP, MAX_EDGE_CAP } from "../config/scoringModelConfig";

export interface RankInput {
  ev: number;
  edge: number;
  calibrationConfidence: number;
  marketQuality: number;
}

/**
 * Scale an EV / edge value against an absolute cap into [0, 1].
 * This replaces within-batch min-max normalization, which inflated ranks on
 * weak days (the worst candidate was always 0 and the best always 1, so even
 * mediocre absolute EV/edge was promoted). With absolute caps, a pick with
 * ev=0.04 on a weak day and ev=0.04 on a strong day scores identically.
 */
function absoluteNormalize(value: number, cap: number): number {
  if (cap <= 0) return 0;
  if (value <= 0) return 0;
  return Math.min(1, value / cap);
}

/**
 * Compute rank scores for a batch of candidates.
 * rank_score = 0.50 * norm_ev + 0.25 * norm_edge + 0.15 * calibration_confidence + 0.10 * market_quality
 *
 * norm_ev and norm_edge are scaled against the absolute MAX_EV_CAP and
 * MAX_EDGE_CAP constants, not the batch's own min/max. This prevents "rank
 * inflation" where a Tier-A score could be earned with a weak +3% edge on a
 * slow slate.
 */
export function rankBets(candidates: RankInput[]): number[] {
  if (candidates.length === 0) return [];

  return candidates.map((c) => {
    const normEv = absoluteNormalize(c.ev, MAX_EV_CAP);
    const normEdge = absoluteNormalize(c.edge, MAX_EDGE_CAP);
    return (
      RANK_WEIGHTS.ev * normEv +
      RANK_WEIGHTS.edge * normEdge +
      RANK_WEIGHTS.calibrationConfidence * c.calibrationConfidence +
      RANK_WEIGHTS.marketLiquidityConfidence * c.marketQuality
    );
  });
}

/**
 * Rank a single bet on the same absolute scale used by rankBets.
 * The `populationStats` arg is accepted for backwards compatibility but is
 * ignored — absolute caps give stable, comparable scores across batches.
 */
export function rankSingleBet(
  input: RankInput,
  _populationStats?: { evMin: number; evMax: number; edgeMin: number; edgeMax: number }
): number {
  const normEv = absoluteNormalize(input.ev, MAX_EV_CAP);
  const normEdge = absoluteNormalize(input.edge, MAX_EDGE_CAP);
  return (
    RANK_WEIGHTS.ev * normEv +
    RANK_WEIGHTS.edge * normEdge +
    RANK_WEIGHTS.calibrationConfidence * input.calibrationConfidence +
    RANK_WEIGHTS.marketLiquidityConfidence * input.marketQuality
  );
}
