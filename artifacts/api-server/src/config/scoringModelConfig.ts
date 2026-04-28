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
// a selective minority (~40-50% of surfaced), matching NHL behavior.
//
// Phase 0.75C tuning (post-fix evidence):
//   - nhl_spread: NEW 0.85. Default 0.65 was too loose — NHL Tier A
//     posted 22.2% wr while Tier B posted 43.8%, i.e. Tier A was worse
//     than Tier B by win rate. Profit was driven by dog-cover variance,
//     not by selection quality.
//   - nba_spread stays at 0.95. The wider post-line-shopping-fix sample
//     (date >= 2026-04-12) shows OLD Tier A NBA spread at 11-9 / 55% wr —
//     Tier A WAS working, the issue was displayed edge inflation. The
//     sigmoidA shrinkage (1.02 → 0.85) and MIN_EDGE bump (0.025 → 0.05)
//     already prune the inflated displayed edges and naturally drop rank
//     scores; pushing Tier A to 0.97 on top over-pruned to 0/2.
//   - nhl_total override remains at 0.94 but is moot once nhl_total is
//     gated via MARKET_DISABLED below.
export const TIER_A_THRESHOLD_OVERRIDE: Partial<Record<string, number>> = {
  nhl_total: 0.94,
  nhl_spread: 0.85,
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
  // MLB main moneylines run from heavy favorites (~ -300, ace vs. weak SP)
  // to underdogs around +250. Anything outside this band is alt-line / first-5
  // / prop leak and should be dropped before tier assignment.
  mlb_moneyline: { min: -400, max: 350 },
};

/**
 * Production leagues that opt in to the odds-range guardrail. NCAAM is
 * intentionally excluded (still default-gated elsewhere) and all simulation
 * / historical code paths leave the guardrail off entirely so their bit-
 * for-bit reproducibility is preserved.
 */
export const ODDS_RANGE_GUARDRAIL_LEAGUES = ["nba", "nhl", "mlb"] as const;

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
  // NFL Phase 0.75E: main spread runs from pick'em to ~±14, occasionally
  // ±17. Cap at ±21 (3 TDs) to reject alt-line / first-half / team-total
  // leakage while admitting every realistic main spread including the
  // rare blowout favorites.
  nfl: 21,
  // NCAAF Phase 0.75F: main spread runs much wider than NFL — top-25 vs
  // FBS minnows routinely posts -35 to -45. Cap at ±50 to admit every
  // realistic main spread while still rejecting alt-line / first-half /
  // team-total leakage.
  ncaaf: 50,
};
export const TOTAL_LINE_RANGE: Partial<Record<string, { min: number; max: number }>> = {
  nba: { min: 180, max: 280 },
  ncaam: { min: 100, max: 180 },
  nhl: { min: 5.0, max: 7.0 },
};

/**
 * Per-league plausibility range for moneyline (h2h) quotes (American odds).
 * Any single book whose home OR away ML falls outside this range has its
 * entire h2h pair dropped from the moneyline shopping pool. Generous on
 * purpose — the goal is rejecting obvious stale/error data, not second-
 * guessing legitimate book pricing.
 *
 * Calibration basis: live cross-book quote ranges observed for each
 * league across normal regular-season games, widened by ~2x for headroom.
 *
 * NHL: parity sport, regular-season ML rarely outside ±400. Cap ±500.
 * NBA: wide variance, blowout favorites can hit -2000. Cap ±3500.
 * MLB: pitching-driven, occasional -350/+300. Cap ±500.
 * NFL: most ML in ±800; max ~−2500/+1200. Cap -3000/+2000 (asymmetric —
 *      favorite ML extends further than dog ML for big spreads).
 * NCAAF: massive variance (Power 5 vs FCS); requires its own range
 *      calibration before adding — leave undefined for now (no model
 *      live in cron yet anyway).
 *
 * Filter is per-pair (drops both sides if either is out of range) because
 * picking one good side from a book whose other side is broken is itself
 * a consistency hazard.
 */
export const MONEYLINE_RANGE: Partial<Record<string, { min: number; max: number }>> = {
  nhl: { min: -500, max: 500 },
  nba: { min: -3500, max: 3500 },
  mlb: { min: -500, max: 500 },
  nfl: { min: -3000, max: 2000 },
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
  // MLB has the smallest home-field advantage of the four majors
  // (historical home win rate ~54%). The market mostly prices it in;
  // we apply only a tiny additional nudge.
  mlb: 0.020,
  // NFL Phase 0.75E foundation placeholder. Historical NFL HFA is ~2.5
  // points (~0.05 in win prob terms) but has been compressing toward
  // 2.0 in recent seasons. Spread model will translate this into a
  // points-based shift; total / moneyline will use the prob form. Final
  // value pending the first NFL spread model build + backtest.
  nfl: 0.045,
  // NCAAF Phase 0.75F foundation placeholder. College football HFA runs
  // larger than NFL — historically ~3.0 points (~0.06 in win prob terms),
  // and notably stronger at top-tier home stadiums. Final value pending
  // first ncaaf_spread model build + backtest.
  ncaaf: 0.060,
} as const;

export const LEAGUE_MARKET_QUALITY = {
  nba: { moneyline: 1.0, spread: 0.95, total: 0.90 },
  ncaam: { moneyline: 0.85, spread: 0.80, total: 0.75 },
  // NHL spread (puck line ±1.5) has demonstrated 72%+ win rate — highest confidence market.
  // NHL moneyline and total show 37–50% win rates with no edge — penalized heavily.
  nhl: { moneyline: 0.25, spread: 0.90, total: 0.15 },
  // MLB Phase 0.75D foundation — only moneyline is wired. Run line and
  // totals are stubbed via MARKET_DISABLED below; their quality scores
  // here are inert (no model) but kept low to mark them as not-ready.
  mlb: { moneyline: 0.85, spread: 0.10, total: 0.10 },
  // NFL Phase 0.75E foundation — no models built yet. Spread will be the
  // first market to ship; moneyline + total deferred. All three are
  // gated via MARKET_DISABLED below; quality scores are inert until the
  // nfl_spread model lands and posts settled-result evidence.
  nfl: { moneyline: 0.10, spread: 0.10, total: 0.10 },
  // NCAAF Phase 0.75F foundation — no models built yet. Same shape as
  // NFL: spread will be the first market wired; moneyline + total
  // deferred. All three are gated via MARKET_DISABLED below; quality
  // scores are inert until the ncaaf_spread model lands.
  ncaaf: { moneyline: 0.10, spread: 0.10, total: 0.10 },
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
 *
 * Phase 0.75C addition (post-fix evidence, both cohorts agree):
 *   - nhl_total: PRE 37.5% wr / -21.3% ROI on 25 resolved;
 *                POST 30.8% wr / -21.5% ROI on 26 resolved.
 *                Brier 0.240 (worse than naive 0.27 threshold) and
 *                26.6% of picks carry edge >0.20 — clear calibration
 *                drift, not bad luck. Per-market MIN_EDGE of 0.04 is
 *                not enough; gate it.
 *
 * 2026-04-26 calibration-review addition (NBA spread demote from Official):
 *   - nba_spread: PRE clean 175 resolved (67-105-3) → 39.0% wr,
 *                 -21.46% ROI, Brier skill -3.97% vs market_prob_fair.
 *                 Edge→winRate monotonicity inverted on the large-n
 *                 cohort (corr -0.933): the top-edge bucket posted
 *                 30.0% wr / -38.41% ROI, the lowest-edge bucket
 *                 42.6% wr. POST clean is only 12 resolved (well below
 *                 minResolved=50) and POST monotonicity also inverts
 *                 on n=1-3 buckets. CLV sample size is 0 across all
 *                 NBA spread rows (separate telemetry investigation),
 *                 so the standard CLV half of the promotion gate is
 *                 inapplicable. Disabling per the calibration-review
 *                 conclusion and explicit user direction. Re-evaluate
 *                 only after a model recalibration is performed AND a
 *                 fresh post-recalibration sample of resolved>=50
 *                 clears the promotion bar.
 *
 * Re-evaluate after the next 7-day post-fix settlement window.
 */
export const MARKET_DISABLED: Partial<Record<string, boolean>> = {
  nhl_moneyline: true,
  nba_moneyline: true,
  // nba_spread: lifted out of MARKET_DISABLED on 2026-04-28 (R2 recovery)
  // and routed into MARKET_MODEL_WATCH_ONLY below alongside the calibration
  // relaxation in calibration.ts (sigmoidA 0.85 → 0.92, version v3 → v4).
  // No Official picks are produced from this market.
  // NBA total: model-edge ceiling sits well below the per-market 10% floor
  // (max edge across 214 candidates over a 14d window: 6.8%). Bucket has
  // been functionally dead — formal disable makes the state explicit and
  // prevents false-positive activity if MARKET_MIN_EDGE.nba_total is ever
  // tuned downward without a corresponding model review. Re-enable only
  // after a model review establishes whether real edge is reachable.
  nba_total: true,
  // MLB Phase 0.75D foundation: moneyline only. Run line (mlb_spread) and
  // totals (mlb_total) are explicitly disabled here as a defensive marker
  // — the cron path also skips them via per-league markets list. No models
  // exist for these markets yet; do not enable without wiring SP data.
  mlb_spread: true,
  mlb_total: true,
  // NFL Phase 0.75E foundation: no models built yet. All three markets
  // are disabled. Spread will be the first market enabled (per project
  // direction) once nflSpreadModel.ts is built and backtested. Moneyline
  // and total stay disabled until they too have models + evidence. The
  // cron path additionally does NOT include "nfl" in LEAGUES, so no
  // candidates can be generated even if these flags were lifted.
  nfl_spread: true,
  nfl_moneyline: true,
  nfl_total: true,
  // NCAAF Phase 0.75F foundation: no models built yet. Same gating
  // posture as NFL — all three markets disabled, cron LEAGUES excludes
  // "ncaaf", spread is the planned first-market build.
  ncaaf_spread: true,
  ncaaf_moneyline: true,
  ncaaf_total: true,
};

/**
 * Markets that produce candidates but are NOT presented as Official picks.
 * Every candidate whose `${league}_${marketType}` key is true here is force-
 * PASSED with selection_reason='model_watch_only' AFTER the MARKET_DISABLED
 * branch. Disabled markets keep their `market_disabled` reason; everything
 * else in this set surfaces only via the dashboard's existing Model Watch
 * (FallbackCandidateCard) treatment.
 *
 * Effect on the public surface:
 *   - candidate_bets: rows still written (so the dashboard can pick the
 *     highest-rank PASS candidate to render as Model Watch).
 *   - scored_picks:   rows are NEVER written for these markets (PASS is
 *     filtered out before persistence in /picks/score and the cron).
 *   - Performance / History: untouched — they read from scored_picks, so
 *     Model-Watch-only markets cannot enter Official metrics.
 *
 * Criteria for removing an entry (i.e. promoting back to Official):
 *   - nhl_spread: closure of Task #4 (NHL edge inflation) PLUS a sustained
 *     post-cutoff Tier-A win-rate sample comparable to NBA spread.
 *   - mlb_moneyline: a longer post-launch calibration window (still in the
 *     first weeks of Phase 0.75D MLB foundation) PLUS Tier-A evidence on a
 *     non-trivial settled sample.
 *
 * This is a registry / surface change, not a model change. Toggling an
 * entry off restores the prior Official behavior with no schema migration.
 */
export const MARKET_MODEL_WATCH_ONLY: Partial<Record<string, boolean>> = {
  nhl_spread: true,
  mlb_moneyline: true,
  // R1 recovery (2026-04-27): lifted from MARKET_DISABLED into watch-only
  // after a 45-day read-only replay (validateGateChange.ts --proposal=R1)
  // showed 132 candidates would surface, with 57.3% realized win rate on
  // 82 decided games (Tier A 60.9%, Tier B 55.9%) and mean CLV +2.07%.
  // Both watch-promotion bars were cleared (>=5 surfaced; mean CLV >= -2%).
  // No Official picks are produced from this market — promotion to Official
  // requires a fresh post-watch-window analysis on the post-2026-04-12
  // line-shopping-fix sample only.
  nhl_total: true,
  // R2 recovery (2026-04-28): lifted from MARKET_DISABLED into watch-only
  // alongside the calibration relaxation in calibration.ts (sigmoidA
  // 0.85 → 0.92, version v3 → v4). Read-only replay (validateGateChange.ts
  // --proposal=R2 over 2026-03-12 → 2026-04-27) surfaced 25 candidates with
  // 56.0% realized win rate (Tier-A 10W-5L = 66.7% n=15, Tier-B 4W-6L =
  // 40.0% n=10) and mean CLV +0.24pp (n=19). Both watch-promotion bars
  // cleared (>=5 surfaced; mean CLV >= -2pp). No Official picks are
  // produced from this market — promotion to Official requires the
  // universal Tier-A floor (n>=75 graded picks) AND a fresh post-R2-window
  // analysis on the post-2026-04-28 sample only.
  nba_spread: true,
};

/**
 * Promotion-alert thresholds for the nightly Model-Watch alert check
 * (see scoring/modelWatchAlerts.ts and the cron job that calls it).
 *
 * When a (league, market) bucket in `model_watch_results` clears ALL
 * three thresholds on its OVERALL totals, the cron emits a notification
 * (log line + idempotent row in `model_watch_alerts`) so an admin can
 * decide whether to promote the market back to Official picks.
 *
 *   - minResolved: resolved sample (wins + losses + pushes) must be at
 *     least this large. Tracks the same denominator the aggregator uses
 *     for ROI and prevents firing on a handful of lucky picks.
 *   - minRoi:      mean profit per resolved pick (units), measured the
 *     same way validation_metrics measures it. 4% is a conservative bar
 *     above the spread-market vig.
 *   - minAvgClv:   mean of `clv_implied_delta` over the bucket's clean
 *     CLV sample (the aggregator already strips |delta|>0.20 outliers).
 *     Positive CLV is the leading indicator we care about — without it
 *     the ROI is suspect.
 *
 * Tune these in one place. Lifting them after an alert has already
 * fired will NOT clear the existing alert row — delete the row in
 * `model_watch_alerts` if you want it to fire again under a stricter
 * bar.
 */
export interface ModelWatchAlertThresholds {
  minResolved: number;
  minRoi: number;
  minAvgClv: number;
}

export const MODEL_WATCH_ALERT_THRESHOLDS: ModelWatchAlertThresholds = {
  minResolved: 50,
  minRoi: 0.04,
  minAvgClv: 0.005,
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
  // NBA spread (Phase 0.75C): mean edge ran at 0.247 with 43.8% wr / -17.3% ROI.
  // Lifting from the global 0.025 floor to 0.05 prunes the lowest-information
  // candidates without disabling the market.
  nba_spread: 0.05,
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
  // The same line-shopping fix in `pickBestLines` landed for NBA on the
  // same commit as NHL. Pre-2026-04-12 NBA spread picks carry inflated
  // displayed edges (sigmoidA shrinkage 1.02 → 0.85 + MIN_EDGE bump
  // 0.025 → 0.05 were the post-fix corrections — see comments above on
  // TIER_A_THRESHOLD_OVERRIDE.nba_spread). Filtering NBA at the same
  // cutoff keeps the public Performance / History surfaces honest
  // about what the current model is actually producing.
  nba: "2026-04-12",
};

/** Label written into `validation_metrics.data_quality` for rows excluded by the cutoff. */
export const DATA_QUALITY_PRE_FIX = "pre_fix_contaminated" as const;

/**
 * Label written into `scored_picks.data_quality` and
 * `candidate_bets.data_quality` for rows generated from a known-bad ingest
 * (e.g. the 2026-04-13/14/15 NHL contamination caused by stale or
 * directionally-inconsistent bookmaker quotes that landed before the
 * ingest plausibility filter + ML/spread consistency rail were in place).
 *
 * Unlike DATA_QUALITY_PRE_FIX (which is date+league-keyed via
 * PUBLIC_TRACK_RECORD_CUTOFFS and excludes ALL rows in a league before a
 * cutoff date), this label is applied surgically to specific rows by
 * one-off backfill scripts. The two labels coexist: a row may carry
 * either, and any non-NULL data_quality excludes the row from public
 * read surfaces.
 */
export const DATA_QUALITY_CONTAMINATED_INGEST = "contaminated_ingest" as const;

export type League = "nba" | "ncaam" | "nhl" | "mlb" | "nfl" | "ncaaf";
export type MarketType = "moneyline" | "spread" | "total";
export type Side = "home" | "away" | "over" | "under";
export type Tier = "A" | "B" | "C" | "PASS";
export type CalibrationMethod = "sigmoid" | "isotonic" | "none";
