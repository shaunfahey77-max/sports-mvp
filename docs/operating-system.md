# How SportsMVP Learns and Improves Over Time

Operating plan for the recommendation engine. Effective 2026-05-05 through 2026-08-01.

---

## 1. Data Collected After Every Surfaced Pick

Every candidate the scoring pipeline evaluates is persisted in `candidate_bets`.
Candidates that clear the tier gates (A/B/C) are promoted into `scored_picks`.
After game settlement, the nightly validation cron writes results and CLV back
into `scored_picks` and `validation_metrics`.

### Per-candidate (candidate_bets — written at scoring time)

| Field | Source |
|---|---|
| game_key | Odds API ingest (ET-bucketed) |
| league | nba, nhl, mlb |
| market_type | moneyline, spread, total |
| side | home/away/over/under |
| model_prob_raw | League model output |
| model_prob_calibrated | After sigmoid or isotonic calibration |
| market_prob_fair | No-vig market consensus |
| edge | model_prob_calibrated − market_prob_fair |
| ev | Expected value at publish odds |
| rank_score | Composite: 0.50×norm_ev + 0.25×norm_edge + 0.15×calib_conf + 0.10×mkt_quality |
| tier | A / B / C / PASS |
| selection_reason | null (Official), model_watch_only, market_disabled, odds_out_of_range, insufficient_edge, negative_ev |
| calibration_method | sigmoid / isotonic / none |
| calibration_version | v1–v4 |
| market_quality | Per-league-market confidence weight (0–1) |
| publish_odds | American odds at time of scoring |
| publish_line | Point spread or total line |
| snapshot_date | ET calendar date of the scoring run |
| event_start | Game commence time (UTC) |

### Per-official-pick (scored_picks — written at scoring time, updated at settlement)

All candidate_bets fields above, plus:

| Field | Written when |
|---|---|
| result | Settlement: win / loss / push / pending |
| close_odds | CLV writeback (nightly validation cron) |
| close_line | CLV writeback |
| clv_implied_delta | publish_implied − close_implied (positive = got a better price) |
| clv_line_delta | close_line − publish_line (spread/total only; positive = line moved in our direction) |

### Per-market-watch candidate (model_watch_results — written at scoring time)

Same shape as scored_picks but populated for MARKET_MODEL_WATCH_ONLY markets
(currently: nhl_spread, nhl_total, nba_spread, mlb_moneyline). These rows feed
the Model Watch admin scoreboard and the nightly promotion-alert check.

### Derived metrics (validation_metrics — written at settlement)

Per-pick settlement writes a row capturing the graded outcome plus all the
fields needed for the Performance page aggregation. These rows carry a
`data_quality` label when they fall before the public track-record cutoff
(pre_fix_contaminated) or came from a bad ingest (contaminated_ingest).

### What "rendered" means

Three rendering surfaces exist, each with its own selection criteria:

| Surface | Selection gate | Counts toward Official record? |
|---|---|---|
| Official pick card | Tier A/B/C, non-disabled, non-watch-only | Yes |
| Model Watch board (MVP) | Top 3–5 PASS candidates with selection_reason = model_watch_only, 80% quality rule | No |
| Free fallback card | Single highest model_watch_only candidate | No |

---

## 2. What Gets Reviewed Daily

The nightly cron (`cronService.ts`) runs automatically and produces:

### Automated daily outputs

1. **Score today's slate** — fetches Odds API snapshots for each production
   league (nba, nhl) plus watch-only pairs (mlb_moneyline), runs models,
   calibrates, ranks, tiers, writes candidate_bets and scored_picks.

2. **Settle yesterday's games** — matches scored_picks to final scores,
   computes win/loss/push, writes validation_metrics rows.

3. **CLV writeback** — for every settled pick, pulls the closing snapshot,
   computes close_odds, close_line, clv_implied_delta, clv_line_delta,
   and writes them back to scored_picks.

4. **Model Watch grading** — settles model_watch_results for watch-only
   markets using the same grading logic.

5. **Model Watch alert check** — evaluates each watch-only (league, market)
   bucket against the promotion thresholds. If ALL three gates clear, writes
   an idempotent alert to `model_watch_alerts` and logs a promotion-ready
   notification.

### Manual daily review (operator)

- **Check the Today's Picks page** — confirm the visible cards are plausible
  games on today's ET slate, not phantom rows or tomorrow's games.
- **Scan cron logs** — confirm no scoring or settlement errors.
- **Glance at the Performance page** — confirm effective-window disclosure
  renders correctly and metrics update after settlement.

---

## 3. What Gets Reviewed Weekly

### Monday review (recommended)

1. **Cohort analysis report** — run the internal calibration-review endpoint
   (`/api/internal/calibration-review`) which produces:
   - PRE vs POST cohort splits by (league, market)
   - Per-cohort: win rate, ROI, Brier score (model vs market), Brier skill
   - Edge→winRate monotonicity report (equal-frequency bucketed)
   - CLV summary per cohort

2. **Model Watch scoreboard** — review `/admin/model-watch/performance`:
   - Per-market total resolved, win rate, ROI, avg CLV
   - Per-tier breakdown within each market
   - Recent picks list with individual CLV deltas

3. **Board composition audit** — confirm the Today's Picks fallback board
   shows the correct cards and that no market_disabled rows leak through.

4. **Pass rate trend** — check Performance page pass rate. If it's climbing
   toward 100% for a market, the model is losing confidence across the board
   (calibration drift or market efficiency shift).

### Monthly review (1st of each month)

5. **Full parameter review** — compare current calibration params, edge
   thresholds, and tier overrides against the trailing evidence. Document
   any discrepancies between the config and the latest cohort data.

6. **Market status review** — for each market, confirm its current status
   (Official, Watch-Only, Disabled) still matches the evidence.

---

## 4. Thresholds That Trigger Action

### 4a. Recalibration review trigger

A recalibration review is warranted when ANY of these hold for a POST-cohort
clean bucket with ≥50 resolved picks:

| Signal | Threshold | What it means |
|---|---|---|
| Brier skill score < 0 | model worse than market price as a forecaster | Calibrated probs are less accurate than just trusting the closing line |
| Edge→winRate correlation < 0 | monotonicity inverted | Higher-edge picks win LESS often — the displayed edge is misleading |
| Win rate < 45% on spread/total | sustained underperformance | Model is not beating the vig |
| Win rate < 40% on moneyline | sustained underperformance | Model is not beating the vig on the wider-vig market |
| Avg CLV < −2% | systematically getting worse prices than close | Either the model is slow or calibration is pulling prices the wrong way |

**Action**: do NOT auto-recalibrate. Open a calibration investigation with the
full cohort report. Adjust sigmoid parameters or isotonic buckets only after
the investigation identifies the root cause and the fix is validated on a
holdout or replay.

### 4b. Market promotion review trigger (Watch-Only → Official)

The nightly alert system fires when a watch-only bucket clears ALL THREE:

| Gate | Current threshold |
|---|---|
| Resolved sample ≥ | 50 picks |
| Mean ROI ≥ | +4% per pick |
| Mean CLV (implied delta) ≥ | +0.5% |

**Additional requirements before promoting**:
- The resolved sample must be entirely from the POST-cutoff window
  (date ≥ PUBLIC_TRACK_RECORD_CUTOFFS[league]).
- Edge→winRate monotonicity must not be inverted (correlation ≥ 0).
- Brier skill score must be non-negative (model ≥ market as forecaster).
- Operator must review the cohort report and explicitly approve.

**Action**: if all gates and requirements pass, move the market from
MARKET_MODEL_WATCH_ONLY to Official by removing its entry. This is a
config change, not a model change.

### 4c. Market demotion / disable trigger (Official → Watch-Only or Disabled)

| Signal | Threshold | Action |
|---|---|---|
| ROI < −15% on ≥30 resolved POST-clean picks | Sustained loss | Demote to Watch-Only |
| Win rate < 40% on ≥30 resolved POST-clean picks | Model broken for this market | Demote to Watch-Only |
| Edge→winRate monotonicity inverted AND Brier skill < 0 | Calibration fundamentally wrong | Demote to Watch-Only and open recalibration |
| Win rate < 30% on ≥20 resolved picks | Catastrophic failure | Disable immediately |
| CLV avg < −5% on ≥20 resolved picks | Systematically getting crushed on price | Disable immediately |

**Demotion** means moving from Official to MARKET_MODEL_WATCH_ONLY.
The market continues to generate candidates and accumulate watch data,
but no Official picks are produced.

**Disable** means moving to MARKET_DISABLED. No candidates are generated
for public surfaces. Use only when the model is actively harmful.

### 4d. Ranking-policy review trigger

The rank_score formula (weights, normalization caps) should be reviewed when:

| Signal | Threshold |
|---|---|
| Tier A saturation | >70% of surfaced picks in a league land in Tier A |
| Tier distribution collapse | <3 distinct tiers represented in a 7-day window |
| Cross-league rank inflation | One league's mean rank_score is >2× another's |

**Action**: adjust TIER_A_THRESHOLD_OVERRIDE for the affected league/market,
or adjust LEAGUE_MARKET_QUALITY weights. Do NOT change RANK_WEIGHTS or
MAX_EV_CAP / MAX_EDGE_CAP without a full replay analysis.

---

## 5. What Should NEVER Be Changed Reactively

The following must NOT be changed in response to a single hot or cold streak
(defined as ≤14 days or ≤20 resolved picks):

| Parameter | Why |
|---|---|
| RANK_WEIGHTS (ev, edge, calib_conf, mkt_quality proportions) | These are structural. A bad week doesn't mean the weighting is wrong. |
| MAX_EV_CAP / MAX_EDGE_CAP (normalization ceilings) | Changing these rescales every rank_score in the system retroactively. |
| HOME_ADVANTAGE constants | These are long-run population parameters, not tunable knobs. |
| Calibration sigmoid A/B parameters | Calibration changes propagate to every candidate. Requires cohort analysis + replay. |
| Isotonic bucket definitions | Same as above — structural calibration, not a tuning knob. |
| TIER_THRESHOLDS (global B=0.50, C=0.35) | These define the product vocabulary. Changing them changes what "Tier A" means to subscribers. |
| PUBLIC_TRACK_RECORD_CUTOFFS | These are historical facts about when contamination ended. They never move forward. |
| MIN_MARKET_QUALITY (0.3 global floor) | This is a data-hygiene gate, not a performance lever. |

**The one exception**: MARKET_DISABLED and MARKET_MODEL_WATCH_ONLY can be
changed quickly (within a day) if a catastrophic demotion trigger fires,
because the action is to STOP surfacing, not to change the model.

---

## 6. Evidence Standard Required Before Changing Each Parameter Class

### 6a. Thresholds (MIN_EDGE, MIN_EV, TIER_A_THRESHOLD_OVERRIDE, MARKET_MIN_EDGE)

| Requirement | Detail |
|---|---|
| Sample size | ≥50 resolved POST-clean picks in the affected (league, market) |
| Cohort report | Full cohort analysis showing the current threshold is too loose or too tight |
| Monotonicity check | Edge→winRate correlation must be computed; if inverted, the threshold change alone won't fix it |
| Replay validation | Run the proposed threshold on the trailing 45-day candidate_bets set and confirm the surfaced subset improves on ROI, CLV, or Brier vs the current threshold |
| Approval | Explicit operator sign-off with the replay results documented |

### 6b. Calibration (sigmoid A/B, isotonic buckets, calibration_version)

| Requirement | Detail |
|---|---|
| Sample size | ≥75 resolved POST-clean picks in the affected (league, market) |
| Root cause | A diagnosed explanation for WHY calibration is off (not just "win rate is low") |
| Brier analysis | Before-and-after Brier score and Brier skill score on the same holdout set |
| Monotonicity | Before-and-after edge→winRate monotonicity report |
| Version bump | New calibration_version string (v5, v6, …) so old and new candidates are distinguishable |
| No retroactive rewrite | Old candidates keep their original calibration. New calibration applies forward only. |

### 6c. Market status (MARKET_DISABLED ↔ MARKET_MODEL_WATCH_ONLY ↔ Official)

| Direction | Evidence required |
|---|---|
| Disable → Watch-Only | 45-day read-only replay (validateGateChange.ts) showing ≥5 surfaced candidates AND mean CLV ≥ −2%. Both existing recoveries (R1 nhl_total, R2 nba_spread) cleared this bar. |
| Watch-Only → Official | Promotion alert fires (≥50 resolved, ROI ≥4%, CLV ≥0.5%) AND Brier skill ≥ 0 AND monotonicity not inverted AND operator approval. All evidence must be POST-cutoff only. |
| Official → Watch-Only | Demotion trigger fires (Section 4c). Requires ≥30 resolved POST-clean picks showing the signal. |
| Official → Disabled | Catastrophic trigger fires (Section 4c). Requires ≥20 resolved picks. Can be acted on same-day. |
| Watch-Only → Disabled | Same catastrophic triggers. Should be rare — watch-only markets don't affect subscribers. |

### 6d. Board ranking (selectModelWatchBoardCandidates sizing, 80% quality rule, capAndSort caps)

| Requirement | Detail |
|---|---|
| User-facing impact | Any change to MODEL_WATCH_BOARD_DEFAULT_TARGET, MODEL_WATCH_BOARD_MAX, MODEL_WATCH_BOARD_QUALITY_RATIO, MAX_PICKS_PER_LEAGUE_PER_DAY, or MAX_PICKS_PER_GAME changes what subscribers see daily |
| Evidence | ≥14 days of board composition data showing the current policy is producing visibly wrong results (e.g., #4/#5 cards are consistently stronger than #1–#3, or one league monopolizes the board) |
| Approval | Explicit operator sign-off. These are product decisions, not model decisions. |

---

## 7. Recommended Operating Cadence Through August 1

### Phase 1: NBA/NHL Playoff Runout (May 5 – June 6)

**Context**: All NBA and NHL markets are currently Watch-Only or Disabled.
Zero Official picks are being produced. The 14-day Performance window goes
blank May 6; the 30-day window goes blank May 22; the 45-day window goes
blank June 6. MLB moneyline is Watch-Only.

**Weekly actions**:
- Run the cohort analysis report every Monday.
- Review Model Watch scoreboard for nhl_spread, nhl_total, nba_spread,
  mlb_moneyline — are any approaching the promotion alert thresholds?
- Monitor the empty-state and legacy-disclosure copy on the Performance
  page — confirm it renders correctly as windows go blank.

**Do NOT**:
- Promote any market back to Official during this phase. There is
  not enough post-cutoff evidence yet.
- Revive nba_moneyline or nhl_moneyline — both had catastrophic
  results and need a model rebuild, not a threshold tweak.

**Milestones**:
- By May 19: nhl_spread should have ~35 resolved watch picks.
  Review monotonicity and CLV. If both are positive, it's on track
  for promotion in Phase 2.
- By June 1: mlb_moneyline should have ~25–30 resolved watch picks.
  First meaningful cohort snapshot.

### Phase 2: MLB Regular Season + Watch Accumulation (June 7 – July 15)

**Context**: NBA and NHL regular seasons are over. MLB is the only active
league with candidates being generated. The Performance page shows the
empty state for all windows.

**Weekly actions**:
- Continue Monday cohort reports.
- Watch for mlb_moneyline promotion alert. If it fires:
  - Verify all evidence is from POST-cutoff dates.
  - Run the full promotion checklist (Section 6c).
  - If approved: promote mlb_moneyline to Official. This restores
    live Official picks to the product and re-populates the
    Performance page.

**Monthly action (July 1)**:
- Full parameter review per Section 3.
- Decide whether nba_spread and nhl_spread have accumulated
  enough watch evidence for a recalibration attempt before
  their next seasons begin.

**Do NOT**:
- Enable nfl_spread, nfl_moneyline, nfl_total, or any ncaaf market.
  These have no models built. Phase 0.75E/F are foundation stubs.
- Change calibration parameters for NBA/NHL markets while those
  leagues are out of season — there are no new picks to validate
  changes against.

### Phase 3: Pre-Season Prep (July 16 – August 1)

**Context**: NFL preseason begins August 7. If an NFL spread model is
being built, this is the window to finalize and backtest it.

**Actions**:
- If mlb_moneyline was promoted to Official in Phase 2, review its
  first 30–45 days of Official results. Confirm ROI, CLV, and
  monotonicity are tracking.
- For any NBA/NHL recalibration work: finalize parameter changes,
  run replays against the full POST-cutoff dataset, document
  results, and stage the config change for the start of next season.
- If NFL spread model is ready: wire it through the scoring pipeline,
  run a historical backtest, and add it to MARKET_MODEL_WATCH_ONLY
  (not Official) for at least 50 resolved picks of watch evidence.

**Deliverable by August 1**: a written status report for each
(league, market) pair documenting:
- Current status (Disabled / Watch-Only / Official)
- Evidence summary (resolved count, win rate, ROI, CLV, Brier skill)
- Recommended action for the upcoming season
- Any pending calibration changes staged for deployment

---

## Appendix: Current Market Status (as of 2026-05-05)

| League | Market | Status | Selection Reason | Evidence Summary |
|---|---|---|---|---|
| NBA | moneyline | **Disabled** | market_disabled | 22% wr, −47% ROI on 9 resolved post-fix |
| NBA | spread | **Watch-Only** | model_watch_only | R2 recovery: 56% wr, +0.24% CLV on 25 candidates (replay) |
| NBA | total | **Disabled** | market_disabled | Max edge 6.8% on 214 candidates — below 10% floor |
| NHL | moneyline | **Disabled** | market_disabled | 0/6 resolved post-fix (−100% ROI) |
| NHL | spread | **Watch-Only** | model_watch_only | 72%+ wr demonstrated; edge inflation fixed but tier calibration needed |
| NHL | total | **Watch-Only** | model_watch_only | R1 recovery: 57.3% wr, +2.07% CLV on 82 decided (replay) |
| MLB | moneyline | **Watch-Only** | model_watch_only | Phase 0.75D foundation; early watch period |
| MLB | spread | **Disabled** | market_disabled | No model exists |
| MLB | total | **Disabled** | market_disabled | No model exists |
| NFL | all | **Disabled** | market_disabled | Phase 0.75E foundation; no models built |
| NCAAF | all | **Disabled** | market_disabled | Phase 0.75F foundation; no models built |

## Appendix: Current Calibration Parameters

| League | Market | Method | Version | Sigmoid A | Sigmoid B |
|---|---|---|---|---|---|
| NBA | moneyline | sigmoid | v2 | 1.05 | 0.0 |
| NBA | spread | sigmoid | v4 | 0.92 | 0.0 |
| NBA | total | isotonic | v2 | — | — |
| NHL | moneyline | sigmoid | v2 | 1.03 | 0.0 |
| NHL | spread | isotonic | v2 | — | — |
| NHL | total | isotonic | v2 | — | — |
| MLB | moneyline | sigmoid | v1 | 1.00 | 0.0 |

## Appendix: Current Scoring Thresholds

| Parameter | Value |
|---|---|
| MIN_EDGE_TO_CANDIDATE (global) | 0.025 |
| MIN_EV_TO_CANDIDATE | 0.008 |
| MAX_EV_CAP | 0.12 |
| MAX_EDGE_CAP | 0.20 |
| MIN_MARKET_QUALITY | 0.30 |
| MARKET_MIN_EDGE nhl_spread | 0.06 |
| MARKET_MIN_EDGE nhl_total | 0.04 |
| MARKET_MIN_EDGE nhl_moneyline | 0.04 |
| MARKET_MIN_EDGE nba_total | 0.10 |
| MARKET_MIN_EDGE nba_spread | 0.05 |
| TIER_THRESHOLDS A / B / C | 0.65 / 0.50 / 0.35 |
| MAX_PICKS_PER_LEAGUE_PER_DAY | 5 |
| MAX_PICKS_PER_GAME | 2 |
| Promotion alert: minResolved | 50 |
| Promotion alert: minRoi | 4% |
| Promotion alert: minAvgClv | 0.5% |
