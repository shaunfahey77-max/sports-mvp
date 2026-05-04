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
