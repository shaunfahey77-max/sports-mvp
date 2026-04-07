/**
 * NHL Moneyline Prediction Model.
 * Hockey is a lower-scoring, tighter game — market signals are strong.
 * Home advantage is lower than basketball (~2.5%).
 */

import type { GameMarketInput, ModelOutput } from "../scoring/scorePicks";
import { removeTwoSidedVig } from "../scoring/marketProb";
import { HOME_ADVANTAGE } from "../config/scoringModelConfig";

const LEAGUE = "nhl";

export async function predict(game: GameMarketInput): Promise<ModelOutput> {
  const { fairA: marketFairHome, fairB: marketFairAway } = removeTwoSidedVig(
    game.homePublishMl,
    game.awayPublishMl
  );

  const homeAdvantage = HOME_ADVANTAGE[LEAGUE];
  const adjustedHome = clamp(marketFairHome + homeAdvantage * (1 - marketFairHome), 0.05, 0.95);
  const adjustedAway = 1 - adjustedHome;

  const noise = modelNoise(game.gameKey, "ml");
  return {
    rawProbHome: clamp(adjustedHome + noise, 0.05, 0.95),
    rawProbAway: clamp(adjustedAway - noise, 0.05, 0.95),
  };
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
  return ((hash % 1000) / 1000 - 0.5) * 0.025;
}
