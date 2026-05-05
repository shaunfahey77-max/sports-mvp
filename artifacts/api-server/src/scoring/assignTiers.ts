/**
 * Tier assignment engine.
 * Maps rank scores to tiers using explicit score bands — no scattered hard-coded gates.
 */

import {
  TIER_THRESHOLDS,
  TIER_A_THRESHOLD_OVERRIDE,
  MIN_EDGE_TO_CANDIDATE,
  MIN_EV_TO_CANDIDATE,
  MARKET_MIN_EDGE,
  MARKET_DISABLED,
  DEFAULT_ODDS_RANGE,
  ODDS_RANGE_OVERRIDE,
} from "../config/scoringModelConfig";
import type { Tier, League, MarketType } from "../config/scoringModelConfig";
import type { ResolvedSurfaceStatus } from "./marketRegistryResolver";

export interface TierInput {
  rankScore: number;
  edge: number;
  ev: number;
  marketQuality: number;
  league?: League;
  marketType?: MarketType;
  // Optional inputs for the odds-range guardrail. The guardrail only fires
  // when `enableOddsRangeGuardrail` is explicitly true AND `publishOdds` is
  // provided — callers on simulation / NCAAM paths leave the flag off so
  // their behavior is unchanged.
  publishOdds?: number;
  publishLine?: number | null;
  enableOddsRangeGuardrail?: boolean;
  /**
   * Transitional rebuild hook. When provided, scorer-level registry state is
   * the source of truth for whether the market is suppressed. When omitted,
   * applyRiskControls falls back to the legacy MARKET_DISABLED map so existing
   * direct callers and unit tests remain stable during migration.
   */
  surfaceStatus?: ResolvedSurfaceStatus;
}

/**
 * Risk controls — all in one place, explicit.
 * Returns a reason string if the bet should be forced to PASS, or null if clean.
 *
 * Selection reasons are exact, stable strings (for downstream analytics
 * joins). When a pick is rejected via the odds-range guardrail, the
 * offending odds and line values are preserved on the candidate row itself
 * via `publish_odds` / `publish_line`, which persistence already writes.
 */
export function applyRiskControls(input: TierInput): string | null {
  // Odds-range guardrail — opt-in per-league via enableOddsRangeGuardrail.
  // Range is config-driven (DEFAULT_ODDS_RANGE + per-`${league}_${marketType}`
  // overrides); no magic numbers here. Evaluated FIRST so the exact
  // `odds_out_of_range` reason is never masked by other risk checks
  // (keeps selection_reason taxonomy stable for downstream analytics).
  if (input.enableOddsRangeGuardrail && input.publishOdds != null) {
    const marketKey =
      input.league && input.marketType ? `${input.league}_${input.marketType}` : null;
    const range =
      (marketKey != null ? ODDS_RANGE_OVERRIDE[marketKey] : undefined) ?? DEFAULT_ODDS_RANGE;
    if (input.publishOdds < range.min || input.publishOdds > range.max) {
      return "odds_out_of_range";
    }
  }

  // Hard market gate — evaluated after odds-range so the existing
  // 'odds_out_of_range' reason is preserved for downstream analytics, but
  // before edge / EV / market-quality so disabled markets never compete on
  // those metrics. Re-evaluate gating in scoringModelConfig.MARKET_DISABLED.
  const disabledKey =
    input.league && input.marketType ? `${input.league}_${input.marketType}` : null;
  const isSuppressedBySurfaceStatus = input.surfaceStatus === "suppressed";
  const isSuppressedByLegacyConfig =
    input.surfaceStatus == null &&
    disabledKey != null &&
    MARKET_DISABLED[disabledKey];
  if (isSuppressedBySurfaceStatus || isSuppressedByLegacyConfig) {
    return "market_disabled";
  }

  if (input.marketQuality < 0.3) {
    return "market_quality_too_low";
  }

  // Per-market minimum edge override takes precedence over global floor.
  const marketKey =
    input.league && input.marketType ? `${input.league}_${input.marketType}` : null;
  const minEdge =
    (marketKey != null ? MARKET_MIN_EDGE[marketKey] : undefined) ?? MIN_EDGE_TO_CANDIDATE;
  if (input.edge < minEdge) {
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

  const marketKey =
    input.league && input.marketType ? `${input.league}_${input.marketType}` : null;
  const tierAThreshold =
    (marketKey != null ? TIER_A_THRESHOLD_OVERRIDE[marketKey] : undefined) ?? TIER_THRESHOLDS.A;

  if (rankScore >= tierAThreshold) {
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
