# SportsMVP Internal Doctrine

How the recommendation engine learns and improves over time.

This document is the durable operating policy for the system. It defines
terminology, data flows, review cadences, decision rules, and evidence
standards. Appendices at the end capture time-sensitive snapshots of
current state and are updated independently of the doctrine itself.

---

## 0. Core Principle: No Output Is Better Than Wrong Output

The system exists to surface trustworthy sports picks. A day with zero
Official picks and a clearly disclosed empty state is a better product
outcome than a day with picks the model cannot support.

This principle governs every decision in this document:

- Markets that have not earned Official status produce zero Official picks,
  regardless of how much candidate-level activity the pipeline generates.
- When evidence triggers a demotion, the market is silenced BEFORE a root
  cause is identified — not after.
- Empty-state copy on every user surface must be truthful and must never
  imply that picks exist when they do not.
- No threshold, calibration parameter, or market-status change may be
  justified solely by "we need to show users something."

---

## 1. Lifecycle of a Pick: Five Distinct States

Every prediction the system generates passes through a defined lifecycle.
These five terms are canonical — all code, UI copy, and operating
decisions must use them consistently.

```
CANDIDATE ──► BOARD-ELIGIBLE ──► RENDERED ──► OFFICIAL ──► SETTLED
    │              │                  │            │            │
    │              │                  │            │            └─ result, CLV
    │              │                  │            └─ scored_picks row
    │              │                  └─ visible on a user surface
    │              └─ passed quality / selection gates for a surface
    └─ model scored; candidate_bets row written
```

### 1a. Candidate

The model scores every (game, league, market, side) tuple. A row is
written to `candidate_bets` for EVERY evaluation — including those that
are immediately force-PASSED by market-disabled, model-watch-only, or
risk controls. Candidates are the raw exhaust of the pipeline. They are
never shown to users.

### 1b. Board-Eligible

A candidate that clears the risk controls (MIN_EDGE, MIN_EV, odds range,
market quality floor, market not disabled, market not watch-only) and
receives a tier of A, B, or C. Board-eligible candidates enter the
`capAndSort` pool, where per-league (5/day) and per-game (2) caps select
the day's Official slate.

For watch-only markets, the analogous state is "watch-eligible": the
candidate passes all risk controls except the watch-only gate, receives
a tier, and enters the `selectModelWatchBoardCandidates` pool for the
Model Watch board (3–5 cards, 80% quality ratio, non-negative EV).

### 1c. Rendered

A board-eligible or watch-eligible candidate that survived capping and is
actually displayed on a user surface. Three rendering surfaces exist:

| Surface | Who sees it | Source pool | Counts toward record? |
|---|---|---|---|
| Official pick card | All users | Board-eligible, after capAndSort | Yes |
| Model Watch board | MVP members only | Watch-eligible, after selectModelWatchBoardCandidates | No |
| Free fallback card | Free / signed-out users | Single highest-ranked watch-eligible candidate | No |

A candidate can be board-eligible but NOT rendered if it is capped out
(e.g., the 6th pick for that league that day). A candidate that is
rendered on the Model Watch board is NOT Official.

### 1d. Official

A rendered pick that was surfaced through the Official path (tier A/B/C,
non-disabled, non-watch-only, survived capAndSort). Official picks are
written to `scored_picks` and are the ONLY picks that count toward
Performance, History, and the public track record.

### 1e. Settled

An Official pick whose game has finished and received a result (win,
loss, push). Settlement triggers CLV writeback and validation_metrics
persistence.

---

## 2. Data Collected at Each Lifecycle Stage

### At scoring time (every candidate)

| Field | Source |
|---|---|
| game_key | Odds API ingest (ET-bucketed) |
| league | nba, nhl, mlb (future: nfl, ncaaf) |
| market_type | moneyline, spread, total |
| side | home / away / over / under |
| model_prob_raw | League model output |
| model_prob_calibrated | After sigmoid or isotonic calibration |
| calibration_method | sigmoid / isotonic / none |
| calibration_version | v1–v4 (bumped on every calibration change) |
| market_prob_fair | No-vig market consensus |
| edge | model_prob_calibrated − market_prob_fair |
| ev | Expected value at publish odds |
| rank_score | 0.50 × norm_ev + 0.25 × norm_edge + 0.15 × calib_conf + 0.10 × mkt_quality |
| tier | A / B / C / PASS |
| selection_reason | null (Official), model_watch_only, market_disabled, odds_out_of_range, insufficient_edge, negative_ev |
| market_quality | Per-league-market confidence weight (0–1) |
| publish_odds | American odds at time of scoring |
| publish_line | Point spread or total line |
| snapshot_date | ET calendar date of the scoring run |
| event_start | Game commence time (UTC) |

### At settlement (Official and watch picks)

| Field | Written when |
|---|---|
| result | win / loss / push / pending |
| close_odds | CLV writeback (nightly validation cron) |
| close_line | CLV writeback (spread/total only) |
| clv_implied_delta | publish_implied − close_implied (positive = got a better price) |
| clv_line_delta | close_line − publish_line (positive = line moved in our direction) |

### Derived validation metrics (per settlement batch)

win_rate, roi, units_won, max_drawdown, avg_ev, avg_edge, clv_hit_rate,
avg_clv, clv_sample_size, brier_score, log_loss, pass_rate, picks_per_day,
tier_breakdown, league_breakdown, market_breakdown.

### Data quality labels

Rows carry a `data_quality` label when they fall before the public
track-record cutoff (`pre_fix_contaminated`) or were generated from a
known-bad ingest (`contaminated_ingest`). Any non-null label excludes
the row from public read surfaces. Raw rows are NEVER deleted.

---

## 3. Surface Integrity Gates

### Gate 1: Today's Picks truth

The Today's Picks page must satisfy ALL of these invariants every day:

- **Slate-day alignment**: the frontend and backend agree on "today" via
  the ET-bucket slate day (`getSlateDayET`). The page must ONLY show games
  whose `snapshot_date` matches today's ET slate day. Games from
  yesterday's or tomorrow's slate are a surface-integrity violation.
- **No phantom rows**: every rendered card must correspond to a real
  `candidate_bets` row whose `event_start` falls within today's ET
  calendar date. Cards without backing data must not appear.
- **Selection-reason fidelity**: Official cards must have null
  `selection_reason`. Model Watch cards must have `model_watch_only`.
  Cards with `market_disabled`, `insufficient_edge`, `negative_ev`, or
  `odds_out_of_range` must NEVER render on any user surface.
- **Disabled-market exclusion**: no candidate from a MARKET_DISABLED
  league_market may appear on ANY rendering surface, including the
  Model Watch board and free fallback card. The
  `MEMBER_BOARD_ALLOWED_SELECTION_REASONS` set enforces this.
- **Empty-state truth**: when zero Official picks and zero watch-eligible
  candidates exist for today, the page must render the explicit empty
  state ("No Official Picks Today") — never a stale card from a
  prior day.

### Gate 2: Performance page truth

- Only `scored_picks` rows (Official path) feed Performance and History.
- The effective-window disclosure must show the actual date range of data
  displayed, not a fixed "last N days" label.
- When the window contains zero scored picks, the empty state must render
  with the legacy-results disclosure if any data exists outside the window.

### Gate 3: Model Watch board truth

- Board cards are watch-eligible candidates only (selection_reason =
  'model_watch_only').
- Board disclaimer must always render: "These are ranked leans, not
  Official picks. They do not count toward performance, CLV reporting,
  or History."
- Board sizing: 3 default, expand to 5 only if candidates 4/5 clear
  the 80% quality ratio AND non-negative EV gates.

---

## 4. Review Cadences

### Daily (automated)

1. **Score today's slate** — fetch Odds API snapshots, run models,
   calibrate, rank, tier, write candidate_bets and scored_picks.
2. **Settle yesterday's games** — match scored_picks to final scores,
   grade outcomes, write validation_metrics.
3. **CLV writeback** — compute close_odds, close_line, clv_implied_delta,
   clv_line_delta for every settled pick.
4. **Model Watch grading** — settle model_watch_results for watch-only
   markets.
5. **Model Watch alert check** — evaluate promotion thresholds; write
   idempotent alert if all gates clear.

### Daily (operator)

- Confirm Today's Picks renders today's ET-slate games only.
- Confirm no disabled-market cards leaked onto any surface.
- Scan cron logs for errors.
- Confirm Performance page disclosure and empty state render correctly
  after settlement.

### Weekly (Monday recommended)

1. **Cohort analysis** — run `/api/internal/calibration-review`:
   - PRE vs POST cohort splits by (league, market)
   - Per-cohort: win rate, ROI, Brier score, Brier skill
   - Edge→winRate monotonicity (equal-frequency bucketed)
   - CLV summary
2. **Model Watch scoreboard** — review per-market resolved, win rate,
   ROI, avg CLV, per-tier breakdown.
3. **Board composition audit** — confirm correct card types, correct
   copy, correct empty states.
4. **Pass rate trend** — rising pass rate toward 100% = model losing
   confidence (calibration drift or market efficiency shift).

### Monthly (1st of each month)

5. **Full parameter review** — compare calibration params, edge thresholds,
   tier overrides against trailing cohort evidence. Document discrepancies.
6. **Market status review** — confirm each market's status (Official /
   Watch-Only / Disabled) still matches the evidence.

---

## 5. Thresholds That Trigger Action

### 5a. Recalibration review

Triggered when ANY of these hold for a POST-cohort clean bucket with
≥50 resolved picks:

| Signal | Threshold | Meaning |
|---|---|---|
| Brier skill score < 0 | Model worse than market | Calibrated probs less accurate than the closing line |
| Edge→winRate correlation < 0 | Monotonicity inverted | Higher-edge picks win LESS often |
| Win rate < 45% (spread/total) | Sustained underperformance | Not beating the vig |
| Win rate < 40% (moneyline) | Sustained underperformance | Not beating wider-vig market |
| Avg CLV < −2% | Systematically worse prices | Model is slow or calibration pulls the wrong way |

**Action**: open a calibration investigation. Do NOT auto-recalibrate.
Adjust parameters only after root cause is identified and validated on
a holdout or replay. Log the decision (Section 7).

### 5b. Market promotion (Watch-Only → Official)

Nightly alert fires when a watch-only bucket clears ALL THREE:

| Gate | Threshold |
|---|---|
| Resolved sample | ≥ 50 picks |
| Mean ROI | ≥ +4% per pick |
| Mean CLV (implied delta) | ≥ +0.5% |

**Additional requirements before promoting**:
- Resolved sample must be entirely POST-cutoff.
- Edge→winRate monotonicity must not be inverted (correlation ≥ 0).
- Brier skill score must be non-negative.
- Operator reviews cohort report and explicitly approves.
- Decision logged (Section 7).

### 5c. Market demotion / disable (Official → Watch-Only or Disabled)

| Signal | Threshold (POST-clean) | Action |
|---|---|---|
| ROI < −15% on ≥30 resolved | Sustained loss | Demote to Watch-Only |
| Win rate < 40% on ≥30 resolved | Model broken | Demote to Watch-Only |
| Monotonicity inverted AND Brier skill < 0 | Calibration wrong | Demote + open recalibration |
| Win rate < 30% on ≥20 resolved | Catastrophic | Disable immediately |
| Avg CLV < −5% on ≥20 resolved | Getting crushed on price | Disable immediately |

**Demotion** = move to MARKET_MODEL_WATCH_ONLY. Market continues to
generate candidates and accumulate watch data; no Official picks produced.

**Disable** = move to MARKET_DISABLED. No candidates surface. Use only
when the model is actively harmful.

Catastrophic triggers are the ONE exception to the "never change
reactively" rule: the action is to STOP surfacing, not to change the
model. Decision logged same-day (Section 7).

### 5d. Ranking-policy review

| Signal | Threshold |
|---|---|
| Tier A saturation | >70% of surfaced picks in a league land in Tier A |
| Tier distribution collapse | <3 distinct tiers in a 7-day window |
| Cross-league rank inflation | One league's mean rank_score is >2× another's |

**Action**: adjust TIER_A_THRESHOLD_OVERRIDE or LEAGUE_MARKET_QUALITY.
Do NOT change RANK_WEIGHTS or MAX_EV_CAP / MAX_EDGE_CAP without a full
replay. Decision logged (Section 7).

---

## 6. What Must Never Be Changed Reactively

The following must NOT be changed in response to a single streak
(≤14 days or ≤20 resolved picks):

| Parameter | Why |
|---|---|
| RANK_WEIGHTS (ev, edge, calib_conf, mkt_quality) | Structural. A bad week does not invalidate the weighting. |
| MAX_EV_CAP / MAX_EDGE_CAP | Changing these rescales every rank_score retroactively. |
| HOME_ADVANTAGE constants | Long-run population parameters, not tunable knobs. |
| Calibration sigmoid A/B | Propagates to every candidate. Requires cohort + replay. |
| Isotonic bucket definitions | Same — structural calibration. |
| TIER_THRESHOLDS (global A=0.65, B=0.50, C=0.35) | Defines the product vocabulary. Changing what "Tier A" means is a product decision. |
| PUBLIC_TRACK_RECORD_CUTOFFS | Historical facts. They never move forward. |
| MIN_MARKET_QUALITY (0.3 global floor) | Data-hygiene gate, not a performance lever. |

---

## 7. Decision Log Requirement

Every change to calibration, thresholds, market status, or ranking policy
must be recorded in a decision log before the code change is committed.
The log captures the reasoning chain so future operators can understand
WHY the system is in its current state.

### Required fields per entry

| Field | Content |
|---|---|
| Date | YYYY-MM-DD of the decision |
| Parameter changed | Exact config key (e.g., MARKET_MODEL_WATCH_ONLY.nba_spread) |
| Previous value | What it was |
| New value | What it is now |
| Direction | e.g., Disabled → Watch-Only, sigmoid A 0.85 → 0.92 |
| Evidence summary | Resolved sample size, win rate, ROI, CLV, Brier skill, monotonicity correlation — whichever are relevant |
| Cohort window | Date range of the evidence (e.g., 2026-04-12 → 2026-05-01, POST-clean only) |
| Root cause (if recalibration) | Diagnosed explanation, not just "win rate was low" |
| Replay result (if threshold/calibration) | Before-and-after metrics on the same candidate set |
| Operator | Who approved |

### Where to log

Append entries to `docs/decision-log.md`. Each entry is a dated section
with the fields above. The log is append-only — entries are never edited
or deleted after the fact. If a decision is later reversed, the reversal
gets its own entry referencing the original.

### Existing decisions that predate this requirement

The code comments in `scoringModelConfig.ts` already contain the
reasoning for every market-status change to date (R1, R2, Phase 0.75B/C
evidence). These are grandfathered. All future changes use the log.

---

## 8. Evidence Standards for Changes

### 8a. Thresholds (MIN_EDGE, MIN_EV, TIER_A_THRESHOLD_OVERRIDE, MARKET_MIN_EDGE)

| Requirement | Detail |
|---|---|
| Sample size | ≥50 resolved POST-clean picks in affected (league, market) |
| Cohort report | Full analysis showing current threshold is too loose or tight |
| Monotonicity | Edge→winRate correlation computed; if inverted, threshold alone won't fix it |
| Replay | Proposed threshold on trailing 45-day candidate_bets; confirm improvement on ROI, CLV, or Brier |
| Decision log | Entry per Section 7 |

### 8b. Calibration (sigmoid A/B, isotonic buckets, calibration_version)

| Requirement | Detail |
|---|---|
| Sample size | ≥75 resolved POST-clean picks in affected (league, market) |
| Root cause | Diagnosed explanation for WHY calibration is off |
| Brier analysis | Before-and-after Brier score + Brier skill on same holdout |
| Monotonicity | Before-and-after edge→winRate report |
| Version bump | New calibration_version (v5, v6, …) so candidates are distinguishable |
| No retroactive rewrite | Old candidates keep original calibration. New applies forward only. |
| Decision log | Entry per Section 7 |

### 8c. Market status

| Direction | Evidence required |
|---|---|
| Disabled → Watch-Only | 45-day read-only replay showing ≥5 surfaced candidates AND mean CLV ≥ −2% |
| Watch-Only → Official | Promotion alert fires (≥50 resolved, ROI ≥4%, CLV ≥0.5%) AND Brier skill ≥ 0 AND monotonicity not inverted AND operator approval |
| Official → Watch-Only | Demotion trigger (Section 5c): ≥30 resolved POST-clean picks |
| Official → Disabled | Catastrophic trigger (Section 5c): ≥20 resolved picks. Same-day action. |
| Watch-Only → Disabled | Same catastrophic triggers |

All evidence for promotion must be POST-cutoff only. Decision log
entry required for every direction.

### 8d. Board ranking policy

| Requirement | Detail |
|---|---|
| User impact | Any change to board targets, quality ratio, per-league caps, or per-game caps changes the subscriber experience |
| Evidence | ≥14 days of board composition showing the policy produces visibly wrong results |
| Decision log | Entry per Section 7. These are product decisions, not model decisions. |

---

## 9. Operating Cadence: Current Planning Horizon

This section is intentionally less prescriptive than the rest of the
doctrine. The phases below describe the current environment and likely
decision points — not commitments. If evidence arrives faster or slower
than expected, the cadence adjusts; the evidence standards in Sections
5–8 do not.

### Phase 1: NBA/NHL Runout (now through end of NBA/NHL postseason)

**Context**: zero Official picks are being produced. All active
NBA/NHL markets are Watch-Only or Disabled. MLB moneyline is Watch-Only.
Performance page windows go progressively blank as the last Official
pick ages out.

**Focus**:
- Weekly cohort reports. Monitor nhl_spread, nhl_total, nba_spread,
  mlb_moneyline watch accumulation.
- Confirm empty-state and legacy-disclosure copy render correctly as
  Performance windows go blank.
- Do NOT promote any market without clearing the full evidence standard.
- Do NOT revive nba_moneyline or nhl_moneyline — both need model
  rebuilds, not threshold tweaks.

### Phase 2: MLB-Only Window (after NBA/NHL seasons end)

**Context**: MLB moneyline is the only active candidate pipeline.
Performance page shows the empty state for all windows.

**Focus**:
- Continue weekly cohort reports.
- mlb_moneyline is the most likely first market to reach the promotion
  threshold. If the alert fires, run the full promotion checklist
  (Section 8c).
- Monthly parameter review on the 1st. Decide whether NBA/NHL markets
  have enough accumulated watch evidence for off-season recalibration
  work.
- Do NOT enable NFL or NCAAF markets — no models exist.
- Do NOT change NBA/NHL calibration while those leagues are out of
  season. There are no new picks to validate against.

### Phase 3: Pre-Season Prep (approximately 3 weeks before NFL Week 1)

**Focus**:
- If mlb_moneyline was promoted, review its first 30–45 days of Official
  results.
- If NBA/NHL recalibration was performed, run replays against the full
  POST-cutoff dataset, document results, stage for next-season deployment.
- If an NFL spread model is ready: wire through the pipeline, backtest,
  add to MARKET_MODEL_WATCH_ONLY. It must accumulate ≥50 resolved watch
  picks before Official promotion is considered.

**Deliverable at the end of this phase**: a written status report for
every (league, market) pair:
- Current status (Disabled / Watch-Only / Official)
- Evidence summary (resolved count, win rate, ROI, CLV, Brier skill)
- Recommended action for the upcoming season
- Any pending calibration changes staged for deployment

---

## Appendix A: Current Market Status

*Last updated: 2026-05-05. Update this appendix whenever a market
status changes. The doctrine sections above are independent of these
values.*

| League | Market | Status | Evidence Summary |
|---|---|---|---|
| NBA | moneyline | Disabled | 22% wr, −47% ROI on 9 resolved post-fix |
| NBA | spread | Watch-Only | R2 recovery: 56% wr, +0.24% CLV on 25 candidates (replay) |
| NBA | total | Disabled | Max edge 6.8% on 214 candidates — below 10% floor |
| NHL | moneyline | Disabled | 0/6 resolved post-fix (−100% ROI) |
| NHL | spread | Watch-Only | 72%+ wr demonstrated; tier calibration pending |
| NHL | total | Watch-Only | R1 recovery: 57.3% wr, +2.07% CLV on 82 decided (replay) |
| MLB | moneyline | Watch-Only | Phase 0.75D foundation; early watch period |
| MLB | spread | Disabled | No model exists |
| MLB | total | Disabled | No model exists |
| NFL | all | Disabled | Phase 0.75E foundation; no models built |
| NCAAF | all | Disabled | Phase 0.75F foundation; no models built |

## Appendix B: Current Calibration Parameters

*Last updated: 2026-05-05.*

| League | Market | Method | Version | Sigmoid A | Sigmoid B |
|---|---|---|---|---|---|
| NBA | moneyline | sigmoid | v2 | 1.05 | 0.0 |
| NBA | spread | sigmoid | v4 | 0.92 | 0.0 |
| NBA | total | isotonic | v2 | — | — |
| NHL | moneyline | sigmoid | v2 | 1.03 | 0.0 |
| NHL | spread | isotonic | v2 | — | — |
| NHL | total | isotonic | v2 | — | — |
| MLB | moneyline | sigmoid | v1 | 1.00 | 0.0 |

## Appendix C: Current Scoring Thresholds

*Last updated: 2026-05-05.*

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

## Appendix D: Decision Log

*See `docs/decision-log.md` for the append-only record of all
calibration, threshold, market-status, and ranking-policy changes.*
