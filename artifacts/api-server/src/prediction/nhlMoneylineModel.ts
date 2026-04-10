/**
 * NHL Moneyline Prediction Model — v2
 *
 * Hockey is lower-scoring and tighter — market signals are strong.
 * Adjusts for back-to-back and rest advantage. Hash noise removed.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "nhl";

// NHL B2B penalty is smaller than NBA (less physical)
const B2B_WIN_PROB_PENALTY = 0.03;
const REST_ADV_PROB_PER_DAY = 0.005;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  const { fairA: marketFairHome } = removeTwoSidedVig(
    game.homePublishMl,
    game.awayPublishMl
  );

  const homeAdvantage = HOME_ADVANTAGE[LEAGUE];
  let adjustedHome = clamp(marketFairHome + homeAdvantage * (1 - marketFairHome), 0.05, 0.95);

  const f = game.features;
  if (f) {
    if (f.homeTeamB2B) adjustedHome -= B2B_WIN_PROB_PENALTY;
    if (f.awayTeamB2B) adjustedHome += B2B_WIN_PROB_PENALTY;
    adjustedHome += f.restAdvantage * REST_ADV_PROB_PER_DAY;
    adjustedHome = clamp(adjustedHome, 0.05, 0.95);
  }

  return {
    rawProbHome: adjustedHome,
    rawProbAway: 1 - adjustedHome,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
