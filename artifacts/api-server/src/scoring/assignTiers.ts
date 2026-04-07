/**
 * Tier assignment engine.
 * Maps rank scores to tiers using explicit score bands — no scattered hard-coded gates.
 */

import { TIER_THRESHOLDS, MIN_EDGE_TO_CANDIDATE, MIN_EV_TO_CANDIDATE } from "../config/scoringModelConfig";
import type { Tier } from "../config/scoringModelConfig";

export interface TierInput {
  rankScore: number;
  edge: number;
  ev: number;
  marketQuality: number;
}

/**
 * Risk controls — all in one place, explicit.
 * Returns a reason string if the bet should be forced to PASS, or null if clean.
 */
export function applyRiskControls(input: TierInput): string | null {
  if (input.marketQuality < 0.3) {
    return "market_quality_too_low";
  }
  if (input.edge < MIN_EDGE_TO_CANDIDATE) {
    return "insufficient_edge";
  }
  if (input.ev < MIN_EV_TO_CANDIDATE) {
    return "negative_ev";
  }
  return null;
}

/**
 * Assign a tier based on rank score bands.
 * Score bands are derived from TIER_THRESHOLDS config — not hard-coded here.
 */
export function assignTier(input: TierInput): { tier: Tier; selectionReason: string | null } {
  const riskBlock = applyRiskControls(input);
  if (riskBlock) {
    return { tier: "PASS", selectionReason: riskBlock };
  }

  const { rankScore } = input;

  if (rankScore >= TIER_THRESHOLDS.A) {
    return { tier: "A", selectionReason: "high_rank_score" };
  }
  if (rankScore >= TIER_THRESHOLDS.B) {
    return { tier: "B", selectionReason: "medium_rank_score" };
  }
  if (rankScore >= TIER_THRESHOLDS.C) {
    return { tier: "C", selectionReason: "low_rank_score" };
  }

  return { tier: "PASS", selectionReason: "rank_score_below_threshold" };
}
