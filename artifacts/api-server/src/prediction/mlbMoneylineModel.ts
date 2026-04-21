/**
 * MLB Moneyline Prediction Model — v1 (Phase 0.75D foundation)
 *
 * Baseball is the lowest-edge of the four majors: ~54% home win rate,
 * heavy dependence on starting pitcher, and tightly priced moneylines.
 * This v1 model is a market-anchored baseline — it shrinks the
 * vig-removed market probability with a small home-field nudge and
 * applies a modest rest-advantage adjustment when feature data is
 * available. No back-to-back penalty (MLB plays daily; B2B is the norm).
 *
 * Run line (±1.5) and totals are intentionally not modeled in this phase
 * (gated via MARKET_DISABLED in scoringModelConfig). Adding them
 * requires starting-pitcher data, which is not yet wired in.
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "mlb";

// Smaller than NBA/NHL — baseball rest matters less because the league
// plays daily. A 1-day rest advantage is barely a signal; cap influence.
const REST_ADV_PROB_PER_DAY = 0.003;

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  const { fairA: marketFairHome } = removeTwoSidedVig(
    game.homePublishMl,
    game.awayPublishMl
  );

  const homeAdvantage = HOME_ADVANTAGE[LEAGUE];
  let adjustedHome = clamp(
    marketFairHome + homeAdvantage * (1 - marketFairHome),
    0.05,
    0.95
  );

  const f = game.features;
  if (f) {
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
