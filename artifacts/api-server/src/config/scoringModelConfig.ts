export const MODEL_VERSION = "v1";
export const SCORING_VERSION = "v2";
export const CALIBRATION_VERSION = "v2";

// Daily pick caps — controls how many picks are surfaced per league per day.
// Picks are selected by descending rankScore, then re-sorted chronologically.
export const MAX_PICKS_PER_LEAGUE_PER_DAY = 5;
// Max picks per individual game (avoids piling multiple markets on one game).
export const MAX_PICKS_PER_GAME = 2;

export const RANK_WEIGHTS = {
  ev: 0.50,
  edge: 0.25,
  calibrationConfidence: 0.15,
  marketLiquidityConfidence: 0.10,
} as const;

export const TIER_THRESHOLDS = {
  A: 0.65,
  B: 0.50,
  C: 0.35,
} as const;

export const TIER_A_THRESHOLD_OVERRIDE: Partial<Record<string, number>> = {
  nhl_total: 0.94,
};

export const MIN_EDGE_TO_CANDIDATE = 0.025;
export const MIN_EV_TO_CANDIDATE = 0.008;
export const MAX_EV_CAP = 0.12;
// Absolute edge ceiling used by rankBets to scale edge into [0,1] regardless
// of the batch. Picks with edge >= this value saturate at 1.0.
export const MAX_EDGE_CAP = 0.20;
export const MIN_MARKET_QUALITY = 0.3;

export const CALIBRATION_CONFIG: Record<string, Record<string, "sigmoid" | "isotonic" | "none">> = {
  nba: {
    moneyline: "sigmoid",
    spread: "sigmoid",
    total: "isotonic",
  },
  ncaam: {
    moneyline: "sigmoid",
    spread: "sigmoid",
    total: "isotonic",
  },
  nhl: {
    moneyline: "sigmoid",
    spread: "isotonic",
    total: "isotonic",
  },
};

export const HOME_ADVANTAGE = {
  nba: 0.035,
  ncaam: 0.045,
  nhl: 0.025,
} as const;

export const LEAGUE_MARKET_QUALITY = {
  nba: { moneyline: 1.0, spread: 0.95, total: 0.90 },
  ncaam: { moneyline: 0.85, spread: 0.80, total: 0.75 },
  // NHL spread (puck line ±1.5) has demonstrated 72%+ win rate — highest confidence market.
  // NHL moneyline and total show 37–50% win rates with no edge — penalized heavily.
  nhl: { moneyline: 0.25, spread: 0.90, total: 0.15 },
} as const;

// Per-market minimum edge overrides — stricter than the global floor.
// Values at or above 0.50 effectively disable a market (edge is capped below that).
export const MARKET_MIN_EDGE: Partial<Record<string, number>> = {
  // NHL spread: keep generating, demonstrated real edge (72%+ win rate)
  nhl_spread: 0.06,
  // NHL totals: 37.5% win rate at Tier A — disabled
  nhl_total: 0.04,
  // NHL moneyline: 50% across all tiers — disabled
  nhl_moneyline: 0.04,
  // NBA totals: Tier B has 50.5% win rate (94 picks) — raise threshold to Tier A quality only
  nba_total: 0.10,
};

export type League = "nba" | "ncaam" | "nhl";
export type MarketType = "moneyline" | "spread" | "total";
export type Side = "home" | "away" | "over" | "under";
export type Tier = "A" | "B" | "C" | "PASS";
export type CalibrationMethod = "sigmoid" | "isotonic" | "none";
