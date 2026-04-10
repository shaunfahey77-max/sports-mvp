/**
 * NBA Moneyline Prediction Model — v2
 *
 * Starts from market-implied fair probability, applies home advantage,
 * then adjusts for real game-day factors: back-to-back and rest advantage.
 * Hash noise removed.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "nba";

// Back-to-back reduces win probability by ~4%
const B2B_WIN_PROB_PENALTY = 0.04;
// Each extra rest day worth ~0.6% win probability (capped via restAdvantage ±3)
const REST_ADV_PROB_PER_DAY = 0.006;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  const { fairA: marketFairHome, fairB: marketFairAway } = removeTwoSidedVig(
    game.homePublishMl,
    game.awayPublishMl
  );

  const homeAdvantage = HOME_ADVANTAGE[LEAGUE];
  let adjustedHome = clamp(marketFairHome + homeAdvantage * (1 - marketFairHome), 0.05, 0.95);

  // --- Feature-based adjustments ---
  const f = game.features;
  if (f) {
    if (f.homeTeamB2B) adjustedHome -= B2B_WIN_PROB_PENALTY;
    if (f.awayTeamB2B) adjustedHome += B2B_WIN_PROB_PENALTY;
    adjustedHome += f.restAdvantage * REST_ADV_PROB_PER_DAY;
    adjustedHome = clamp(adjustedHome, 0.05, 0.95);
  }

  const adjustedAway = 1 - adjustedHome;

  return {
    rawProbHome: adjustedHome,
    rawProbAway: adjustedAway,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
