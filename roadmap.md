# Sports MVP Roadmap (LOCKED BASELINE)

This roadmap defines the execution order and constraints for all model, scoring, and league expansion work.

No phase may begin until the previous phase is marked as PASSED.

Phase 0.5 is the rollback point for all subsequent phases.

---

## Phase 0.5 — Baseline Lock / Internal Review
Goal: freeze the current trusted baseline before reopening any new market work.

Checks:
- deterministic runtime with cron disabled
- persistence idempotence passes
- NHL totals shows corrected A/B split
- NBA sanity passes
- no shared-file regressions

Acceptance:
- baseline is stable and trustworthy
- output is credible for internal review
- this phase becomes the rollback point for all future phases

---

## Phase 1 — NHL Spread Reintroduction
Goal: re-enable NHL spread without affecting NHL totals.

Checks:
- deterministic ingest only
- candidate/published audit
- candidate-to-published conversion rate
- repeat-ingest idempotence
- regression check on NHL totals + NBA

Acceptance:
- no duplicates
- stable candidate counts
- not all Tier A
- output is selective and credible

---

## Phase 2 — NHL Moneyline Reintroduction
Goal: safely re-enable NHL moneyline.

Checks:
- deterministic ingest
- raw vs calibrated audit
- edge concentration
- favorite/dog mix sanity
- repeat-ingest idempotence
- regression checks

Acceptance:
- no flooding
- believable edges
- balanced output
- credible presentation

---

## Phase 3 — MLB Foundation + Moneyline
Goal: add MLB foundation and first market.

Acceptance:
- end-to-end ingest works
- no cross-league regressions
- output is selective and credible

---

## Phase 4 — MLB Totals
## Phase 5 — MLB Run Line

---

## Phase 6 — NFL Foundation + Spread
## Phase 7 — NFL Totals
## Phase 8 — NFL Moneyline

---

## Phase 9 — NCAAF Foundation + Market 1

---

## Shared Non-Negotiables

- deterministic runtime only
- persistence idempotence required
- one market at a time
- no shared-file changes without regression checks
- audit before threshold changes
- no commit until phase passes

---

## Execution Order

0.5 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

