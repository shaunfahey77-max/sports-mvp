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

// Per-market Tier A threshold overrides (keyed by `${league}_${marketType}`).
// The global Tier A floor (TIER_THRESHOLDS.A = 0.65) is too loose for markets
// where rank_score systematically runs hot — typically because one or more
// components (EV normalized against MAX_EV_CAP, market_quality, calibration
// confidence) saturate even on modest picks. These overrides tighten the
// band so Tier A remains a selective subset of surfaced picks, without
// changing the shared rank mechanism or affecting other leagues.
//
// NBA calibration: measured over a 14-day sample, surfaced NBA picks landed
// at avg rank_score 0.84 (moneyline) and 0.93 (spread), pushing ~96% of
// surfaced NBA picks into Tier A. Thresholds below shift NBA Tier A back to
// a selective minority (~40-50% of surfaced), matching NHL behavior. NHL
// thresholds are unchanged.
export const TIER_A_THRESHOLD_OVERRIDE: Partial<Record<string, number>> = {
  nhl_total: 0.94,
  nba_moneyline: 0.88,
  nba_spread: 0.95,
  nba_total: 0.80,
};

// Odds-range guardrail. When enabled for a given league, candidates whose
// American publish_odds fall outside these bounds are forced to PASS with
// selection_reason 'odds_out_of_range' before tier assignment. This blocks
// alt-line and exotic-prop contamination (e.g. NHL spread at +2800, NBA
// moneyline at +10000) from being surfaced as A/B/C to subscribers.
//
// Calibrated against the 14-day NBA/NHL main-line distribution on the
// pipeline-fixes-nhl-nba branch: spread and total main lines live in
// [-125, +135]; moneylines span a much wider legitimate range because
// heavy favorites and dogs on main ML are real. Per-market moneyline
// overrides preserve those while pruning the +3000 → +10000 alt-line tail.
//
// This range is intentionally only enforced against NHL/NBA production
// paths — NCAAM and historical simulation do not opt in and are unaffected.
export const DEFAULT_ODDS_RANGE = { min: -350, max: 350 } as const;
export const ODDS_RANGE_OVERRIDE: Partial<Record<string, { min: number; max: number }>> = {
  nba_moneyline: { min: -2000, max: 600 },
  nhl_moneyline: { min: -800, max: 600 },
};

/**
 * Production leagues that opt in to the odds-range guardrail. NCAAM is
 * intentionally excluded (still default-gated elsewhere) and all simulation
 * / historical code paths leave the guardrail off entirely so their bit-
 * for-bit reproducibility is preserved.
 */
export const ODDS_RANGE_GUARDRAIL_LEAGUES = ["nba", "nhl"] as const;

/**
 * Per-league plausibility ranges for the line POINT (not price). Any
 * book-published spread or total whose point falls outside these bounds is
 * treated as an alt-line / team-total / period-total leak and dropped
 * during `pickBestLines`. This prevents values like NHL total 3.5 or 9.5
 * (main NHL total is ~6) and NHL spread ±2.5 (main puck line is ±1.5)
 * from ever being paired with a main-line model probability, which is the
 * root cause of the NHL spread/total edge-inflation issue investigated in
 * Task #4. These ranges are generous enough to accept every realistic
 * main-line value but strict enough to reject out-of-market outcomes.
 */
export const SPREAD_LINE_ABS_MAX: Partial<Record<string, number>> = {
  nba: 25,
  ncaam: 35,
  nhl: 2.0,
};
export const TOTAL_LINE_RANGE: Partial<Record<string, { min: number; max: number }>> = {
  nba: { min: 180, max: 280 },
  ncaam: { min: 100, max: 180 },
  nhl: { min: 5.0, max: 7.0 },
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

/**
 * Hard market gate. When `true`, every candidate for that league_market
 * is force-PASSED with selection_reason="market_disabled" before any other
 * risk control runs. Use this (not a contrived MARKET_MIN_EDGE) when the
 * intent is "do not surface this market to users at all".
 *
 * Set during Phase 0.75B based on KPI report findings:
 *   - nhl_moneyline: 0/6 resolved post-fix (-100% ROI)
 *   - nba_moneyline: 22% wr, -47% ROI on 9 resolved post-fix
 * Re-evaluate after the next 7-day post-fix settlement window.
 */
export const MARKET_DISABLED: Partial<Record<string, boolean>> = {
  nhl_moneyline: true,
  nba_moneyline: true,
};

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

/**
 * Per-league cutoff for the PUBLIC track-record surface. Any pick or
 * validation_metrics row whose date is STRICTLY BEFORE this cutoff (for
 * the corresponding league) is treated as "pre-fix contaminated" and
 * excluded from public-facing performance/history endpoints.
 *
 * Raw rows are NEVER deleted or rewritten — they remain intact in the
 * database for internal audit and analytics. Only the public read surface
 * is filtered. The cutoff is the single deterministic source of truth and
 * is also what the backfill script uses to set the `data_quality` label
 * on existing validation_metrics rows.
 *
 * NHL pre-fix contamination: the line-shopping bug in `pickBestLines`
 * (Task #4) over-stated NHL spread/total edges through 2026-04-11 (the
 * 04-11 NHL day posted +21.56u / 134.8% ROI on inflated lines). Cutoff is
 * therefore 2026-04-12 — the first clean NHL day under the matched-pair
 * line shopping fix.
 */
export const PUBLIC_TRACK_RECORD_CUTOFFS: Partial<Record<string, string>> = {
  nhl: "2026-04-12",
};

/** Label written into `validation_metrics.data_quality` for rows excluded by the cutoff. */
export const DATA_QUALITY_PRE_FIX = "pre_fix_contaminated" as const;

export type League = "nba" | "ncaam" | "nhl";
export type MarketType = "moneyline" | "spread" | "total";
export type Side = "home" | "away" | "over" | "under";
export type Tier = "A" | "B" | "C" | "PASS";
export type CalibrationMethod = "sigmoid" | "isotonic" | "none";
