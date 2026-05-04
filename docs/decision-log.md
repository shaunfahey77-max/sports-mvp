# SportsMVP Decision Log

Append-only record of calibration, threshold, market-status, and
ranking-policy changes. Each entry is a dated section. Entries are
never edited or deleted — reversals get their own entry referencing
the original.

See `docs/operating-system.md` Section 7 for the required fields.

---

## Grandfathered Decisions (pre-doctrine)

The following decisions predate the formal decision-log requirement.
Their reasoning is preserved in code comments in
`artifacts/api-server/src/config/scoringModelConfig.ts` and
`artifacts/api-server/src/scoring/calibration.ts`. They are listed
here for completeness but are not rewritten into the new format.

- **Phase 0.75B**: nhl_moneyline disabled (0/6 resolved, −100% ROI).
  nba_moneyline disabled (22% wr, −47% ROI on 9 resolved post-fix).
- **Phase 0.75C**: nhl_total disabled (PRE 37.5% wr / −21.3% ROI,
  POST 30.8% wr / −21.5% ROI; Brier 0.240). nhl_spread Tier A
  override raised to 0.85. nba_spread MIN_EDGE raised to 0.05,
  sigmoid A shrunk 1.02 → 0.85 (v3).
- **2026-04-26**: nba_spread demoted from Official to Disabled.
  PRE clean 175 resolved: 39.0% wr, −21.46% ROI, Brier skill −3.97%.
  Monotonicity inverted (corr −0.933).
- **R1 recovery (2026-04-27)**: nhl_total lifted Disabled → Watch-Only.
  45-day replay: 132 candidates, 57.3% wr on 82 decided, +2.07% CLV.
- **R2 recovery (2026-04-28)**: nba_spread lifted Disabled → Watch-Only.
  Calibration relaxed sigmoid A 0.85 → 0.92 (v3 → v4). Replay:
  25 candidates, 56.0% wr, +0.24% CLV.
- **nba_total disabled**: model-edge ceiling below 10% per-market floor
  (max edge 6.8% on 214 candidates over 14-day window).

---

*New entries below this line follow the Section 7 format.*

## 2026-05-04 — Candidates endpoint: fresh-snapshot dedup + renderable-only cap

**Category:** ranking-policy / bug-fix  
**Change:** Two fixes in `/picks/candidates` (picks.ts):
1. Dedup now prefers the latest `snapshotDate` per (gameKey, marketType, side),
   breaking ties with highest EV. Previously kept highest EV across all scoring
   runs, allowing 3–4 day old stale candidates (with inflated rank scores from
   outdated odds) to dominate the Model Watch board.
2. Non-renderable `selectionReason` values (`market_disabled`, `insufficient_edge`,
   `negative_ev`, `odds_out_of_range`) are filtered out before `capAndSort`. Previously
   these dead-weight candidates consumed per-game (MAX_PICKS_PER_GAME=2) and
   per-league (5/day) cap slots, blocking `model_watch_only` candidates from
   reaching the dashboard.

**Evidence (pre-fix board, 2026-05-04):**
- Board showed 3 NHL total cards: phi_car under (rank 0.94, snap 2026-05-01),
  min_col under (rank 0.84, snap 2026-05-01), ana_vgk over (rank 0.76, snap 2026-05-02).
  All from 3–4 day old scoring runs with stale odds.
- NBA spread and NHL spread candidates were blocked by disabled moneyline/total
  candidates eating per-game cap slots.
- Expansion locked at 3 because stale top rank (0.94) created an 80% threshold
  (0.75) unreachable by any fresh candidate.

**Post-fix board (same data):** NHL total under (phi_car, fresh snap), NHL total
under (min_col, only snap), MLB moneyline home (lad_hou, fresh snap). NBA spread
now reaches the eligible pool (rank 0.246) but falls below the quality threshold.
Board remains 3 cards by the expansion rule, not by bugs.

**Risk:** Low. Only affects the `/picks/candidates` public read path. No change
to scoring, `scored_picks`, or `/performance`.
