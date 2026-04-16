# Task 3 — Odds sanity / alt-line guardrail: 14-day before/after report

## Change
- New config: `DEFAULT_ODDS_RANGE = [-350, +350]`.
- Per-market overrides: `nba_moneyline = [-2000, +600]`, `nhl_moneyline = [-800, +600]`
  (heavy favorites on main ML are real; alt-line tails are not).
- `applyRiskControls` emits exact `selection_reason = 'odds_out_of_range'` when
  `enableOddsRangeGuardrail` is on AND `publishOdds` is out-of-band. Fires
  BEFORE edge/EV gates so contaminated picks are clearly labeled.
- Opted in: NBA + NHL via `/picks/score`, cron, and the odds ingest route.
  Simulation, historical ingest, and NCAAM paths are unaffected (flag off).
- Offending `odds` and `line` are preserved on the rejected row in the
  existing `candidate_bets.publish_odds` / `publish_line` columns — no schema
  change needed.

## 14-day impact — global (NBA + NHL, tiered picks only)

| metric                | before   | after    | delta                 |
|-----------------------|---------:|---------:|-----------------------|
| surfaced picks        |      162 |      126 | -36 (-22.2%)          |
| wins                  |       51 |       47 | -4                    |
| losses                |       85 |       53 | **-32**               |
| win rate (settled)    |   37.50% |   47.00% | **+9.50 pts**         |

## 14-day impact — tier-before-filter × league

| league | tier | surfaced_before | surfaced_after | rejected |
|--------|------|----------------:|---------------:|---------:|
| nba    | A    |              47 |             47 |        0 |
| nba    | B    |              18 |             10 |        8 |
| nba    | C    |               1 |              1 |        0 |
| nhl    | A    |              49 |             23 |       26 |
| nhl    | B    |              46 |             44 |        2 |
| nhl    | C    |               1 |              1 |        0 |

Key read: NBA Tier A is untouched (0 rejected), confirming main-line NBA
premium picks are not clipped. NHL Tier A is where contamination lives —
53% of current NHL Tier A surfaces would be rejected. The guardrail
concentrates its effect precisely where the historical win rate was
worst, not on the main-line spreads / totals we want to preserve.

## 14-day impact — by league × market

| league | market    | total | would_reject | pct    | wins | losses | wins_after | losses_after |
|--------|-----------|------:|-------------:|-------:|-----:|-------:|-----------:|-------------:|
| nba    | moneyline |    15 |            8 | 53.33% |    4 |      8 |          4 |            0 |
| nba    | spread    |    50 |            0 |  0.00% |   22 |     22 |         22 |           22 |
| nba    | total     |     1 |            0 |  0.00% |    0 |      1 |          0 |            1 |
| nhl    | moneyline |     9 |            4 | 44.44% |    1 |      6 |          1 |            2 |
| nhl    | spread    |    23 |           14 | 60.87% |    7 |     15 |          3 |            5 |
| nhl    | total     |    64 |           10 | 15.63% |   17 |     33 |         17 |           23 |

Per-market read:
- **NBA moneyline**: kills all 8 losses, preserves all 4 wins (the
  `nba_moneyline` override [-2000, +600] eliminates only the alt-line dog
  tail without touching legitimate favorites).
- **NHL moneyline**: trims to 3 picks; kills 4 losses, 0 wins.
- **NHL spread**: 32% → 38% win rate after filter.
- **NHL total**: 34% → 43% win rate on filtered subset; kills 10 losses, 0 wins.
- **NBA spread / NBA total**: 0% rejected — main lines untouched, confirming
  the bounds don't clip legitimate production picks.

## Selection_reason contract
Exact string only: `'odds_out_of_range'`. Offending odds live on the row's
`publish_odds`, offending line on `publish_line` — already persisted by the
existing candidate_bets insert. No reason-string concatenation, no
unstructured metadata.

## Tests
`src/scoring/__tests__/assignTier.test.ts` — 13/13 green. Covers:
- guardrail off by default (simulation reproducibility)
- exact reason string under the guardrail (too-high and too-low odds)
- per-market overrides (NBA ML -1500 allowed, NHL ML -1200 rejected)
- ordering: `odds_out_of_range` wins over `insufficient_edge`
- scoring-pipeline integration via `applyTieringToCandidates`: per-league
  gating — NHL/NBA rejected with exact reason, NCAAM sails through
- persistence-shape mirror: rejected row round-trips through the
  `candidate_bets` insert mapping with reason + odds + line intact

## Typecheck
API-server tsc errors: **8** (baseline on main: 26; task cap: ≤23).

## Follow-up monitoring
Post-deploy, track weekly rejection counts and win-rate deltas per
`(league, market, selection_reason)` to tune bounds if the NHL total
rejection rate (currently 16%) drops below observed contamination.
