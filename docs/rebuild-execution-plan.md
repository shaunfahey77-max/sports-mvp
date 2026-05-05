# SportsMVP Rebuild Execution Plan

Date: 2026-05-05

This document turns the approved Phase 1 rebuild work into a practical build
order against the real repo. It is intentionally implementation-focused:
which files change first, what each phase proves, and what we do not touch
until the engine is trustworthy.

## 0. What The Codebase Actually Is Today

After direct inspection of the repo, the current engine is not a clean modeling
system. It is a market-anchored scoring pipeline with heavy hand-tuned gates.

Key observations from the live code:

- [`scorePicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/scorePicks.ts)
  hard-codes model selection by `(league, market)` through a large switch.
- [`calibration.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/calibration.ts)
  contains hard-coded sigmoid and isotonic parameters rather than a
  reproducible fit pipeline.
- [`featureEngine.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/prediction/featureEngine.ts)
  neutralizes ATS / over-rate features to `0.5`, meaning several current
  “features” are intentionally uninformative.
- League models such as
  [`nbaMoneylineModel.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/prediction/nbaMoneylineModel.ts)
  and
  [`nbaSpreadModel.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/prediction/nbaSpreadModel.ts)
  are mostly market-implied baselines plus hand-tuned adjustments, not strong
  learned models.
- [`scoringModelConfig.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/config/scoringModelConfig.ts)
  is full of per-market overrides, disables, and thresholds. This preserves
  history, but it is not a durable architecture.
- [`modelWatchGrader.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/modelWatchGrader.ts)
  is structurally reasonable, but the surrounding pipeline/orchestration has
  not produced reliable persisted evaluation output.

Conclusion:

We should not keep patching the current engine into shape. We should reuse only
the mathematically sound helpers and rebuild the rest around:

- reliable close capture
- unified evaluation persistence
- calibration provenance
- registry-driven market status
- model architectures that can be benchmarked honestly

## 1. Rebuild Rules

These are operational rules for the rebuild:

1. No launch work during the rebuild.
2. No landing-page or pricing work during the rebuild.
3. No more market-specific threshold patching unless it is required to keep a
   live truth bug from harming users.
4. Every major phase must end in an artifact:
   - schema / migration
   - reproducible script
   - benchmark report
   - gate-evidence file
5. We only keep code that improves:
   - data integrity
   - evaluation integrity
   - model comparability

## 2. Reuse vs Replace

### Reuse

These are worth keeping:

- [`marketProb.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/marketProb.ts)
  for vig removal / price math
- [`expectedValue.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/expectedValue.ts)
  for EV transforms
- [`validatePicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/validatePicks.ts)
  specifically `computeOutcomeResult`
- [`clvWriteback.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/clvWriteback.ts)
  specifically `computeClvWritebackValues`
- pieces of [`modelWatchAggregator.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/modelWatchAggregator.ts)
  as aggregation helpers once the data source is corrected

### Replace

These should not survive as the core rebuild architecture:

- hard-coded model dispatch in
  [`scorePicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/scorePicks.ts)
- hard-coded calibration registry in
  [`calibration.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/calibration.ts)
- current split evaluation persistence:
  [`scoredPicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema/scoredPicks.ts)
  +
  [`modelWatchResults.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema/modelWatchResults.ts)
- current “Official vs Watch” branching as the primary persistence boundary
- current rank/tier-overrides-first config posture in
  [`scoringModelConfig.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/config/scoringModelConfig.ts)

## 3. Phase Order

## Phase A — Data Integrity First

Goal:
make evaluation trustworthy before touching model quality.

### A1. Add close-capture provenance to snapshots

Files:

- [`lib/db/src/schema/gameSnapshots.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema/gameSnapshots.ts)
- db migration files
- [`artifacts/api-server/src/services/cronService.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/services/cronService.ts)

Changes:

- add `closeCapturedAt`
- add `closeSource`
- formally distinguish “daily snapshot” from “actual close snapshot”
- keep existing daily ingest, but make close capture its own explicit duty

Done when:

- close rows can be proven to be inside the close window
- coverage can be measured per `(league, market, day)`

### A2. Create unified evaluation table

Files:

- new schema file under
  [`lib/db/src/schema/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema)
- [`lib/db/src/schema/index.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema/index.ts)
- db migration files

Changes:

- create `evaluation_results`
- keep `scored_picks` and `model_watch_results` read-only for historical
  compatibility
- write all future evaluated rows into one table with `surfaceStatus`

Done when:

- one row source exists for shadow, model watch, and official evaluation output

### A3. Create market registry

Files:

- new schema file under
  [`lib/db/src/schema/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema)
- db migration files

Changes:

- create `market_registry`
- move market status into data, not giant config branches

Done when:

- a `(league, market)` can move between `shadow`, `model_watch`, `official`,
  and `suppressed` without introducing a new scoring code path

## Phase B — Grading And Orchestration Repair

Goal:
make the pipeline always produce evaluable rows.

### B1. Replace split grading writes with unified evaluator

Files:

- [`artifacts/api-server/src/scoring/modelWatchGrader.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/modelWatchGrader.ts)
- [`artifacts/api-server/src/services/validationCronService.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/services/validationCronService.ts)
- [`artifacts/api-server/src/services/cronService.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/services/cronService.ts)
- possibly new evaluator module under
  [`artifacts/api-server/src/scoring/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring)

Changes:

- grade every candidate row for a settled game into `evaluation_results`
- remove tier/write coupling as a reason rows disappear
- make re-grading idempotent

Done when:

- any settled game can be replayed and all candidate rows receive an
  evaluation record

### B2. Add calibration provenance to candidate outputs

Files:

- [`lib/db/src/schema/candidateBets.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/lib/db/src/schema/candidateBets.ts)
- possibly `evaluation_results` schema
- [`artifacts/api-server/src/scoring/scorePicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/scorePicks.ts)

Changes:

- ensure every scored row records `modelVersion`, `calibrationVersion`,
  and later `scoringVersion` consistently

Done when:

- any evaluation row can be traced back to exact model + calibration artifacts

## Phase C — Registry-Driven Scoring Path

Goal:
stop adding league/market support by giant switch statements and special cases.

### C1. Introduce model registry abstraction

Files:

- [`artifacts/api-server/src/scoring/scorePicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/scorePicks.ts)
- new registry module under
  [`artifacts/api-server/src/scoring/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring)
- possibly prediction module index under
  [`artifacts/api-server/src/prediction/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/prediction)

Changes:

- replace the large hard-coded `getModel()` / `hasModel()` switch with registry
  lookup
- separate “supported by code” from “eligible to surface”

Done when:

- adding a new `(league, market)` is a registry/data decision, not another
  ad hoc control path in `scorePicks.ts`

### C2. Reduce config special-casing

Files:

- [`artifacts/api-server/src/config/scoringModelConfig.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/config/scoringModelConfig.ts)

Changes:

- keep guardrails and safety rails
- stop using this file as the primary source of market lifecycle truth

Done when:

- safety bounds remain
- but market status and research progression come from `market_registry`

## Phase D — Calibration Rebuild

Goal:
replace hard-coded calibration with reproducible fit artifacts.

### D1. Create calibration artifact format

Files:

- [`artifacts/api-server/src/scoring/calibration.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/calibration.ts)
- new calibration artifact directory under repo, likely `artifacts/api-server/calibration/`
- scripts for fitting under
  [`scripts/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/scripts)

Changes:

- move from hard-coded params/buckets to file-backed calibration artifacts
- store holdout ranges and fit metadata

Done when:

- calibration is reproducible
- raw vs calibrated Brier can be audited

### D2. Add calibration confidence

Files:

- [`artifacts/api-server/src/scoring/calibration.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/calibration.ts)
- [`artifacts/api-server/src/scoring/scorePicks.ts`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/scoring/scorePicks.ts)
- evaluation schema

Changes:

- make calibration confidence explicit and persisted
- use it downstream in rank score

Done when:

- extreme low-support probabilities are visibly down-weighted

## Phase E — Model Rebuild

Goal:
rebuild the models around comparable, benchmarkable architectures.

### E1. Moneyline baseline models

Files:

- prediction files under
  [`artifacts/api-server/src/prediction/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/artifacts/api-server/src/prediction)
- likely new offline training scripts under
  [`scripts/src/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/scripts/src)

Changes:

- treat current models as temporary placeholders
- implement GBM-first or equivalent reproducible moneyline models per league

### E2. Spread and total distribution models

Files:

- same prediction directory
- new shared distribution math helpers

Changes:

- move spread to expected-margin + residual-distribution architecture
- move total to expected-total + residual-distribution architecture

Done when:

- spread/total probabilities are derived from one coherent shape, not
  hand-tuned market nudges

## Phase F — Evaluation And Research Artifacts

Goal:
make promotion/suppression decisions evidence-driven and reproducible.

### F1. Research dataset and benchmark scripts

Files:

- `.local/research/*` for outputs
- new stable scripts under
  [`scripts/src/`](/Users/shaunfahey/Documents/New%20project/Sportsmvpnet/scripts/src)

Changes:

- formalize the re-grade-on-read dataset builder
- formalize benchmark report generation

### F2. Gate evidence artifacts

Files:

- likely `docs/gate-evidence/` or `.local/reports/`

Changes:

- per `(league, market)` gate files with
  - train/calibration/holdout ranges
  - test statistics
  - p-values
  - promotion verdict

## 4. Recommended First Four Implementation Tasks

These are the first four code tasks I recommend we do ourselves.

### Task 1 — Close capture schema + service contract

Scope:

- add `closeCapturedAt`, `closeSource`
- refactor close capture path in `cronService.ts`
- no model changes yet

Reason:

Without trustworthy close capture, the rebuild cannot answer the only question
that matters: does the engine beat the close?

### Task 2 — Unified evaluation schema + writer

Scope:

- add `evaluation_results`
- add `market_registry`
- wire a new unified evaluator for settled rows

Reason:

Without a single evaluation surface, we will keep reliving the
`scored_picks` vs `model_watch_results` drift that got us here.

### Task 3 — Candidate/evaluation provenance

Scope:

- make sure all candidate/evaluation rows carry calibration and model provenance
- no prediction changes yet

Reason:

We need reproducibility before retraining anything.

### Task 4 — Registry-driven scoring path

Scope:

- replace the giant model switch with registry-based dispatch
- preserve current behavior while making the architecture extensible

Reason:

This is the minimum structural change needed before adding all required leagues
and markets without another patchwork explosion.

## 5. What We Should Not Do Yet

Do not do these before Tasks 1–4:

- redesign the landing page
- redesign Today’s Picks again
- reshape Performance again
- tune tier thresholds
- tune rank weights
- add more market disables/overrides
- declare any market launch-ready

Those are downstream of a trustworthy evaluation layer.

## 6. My Direct Assessment

The codebase is not hopeless. It is also not one tweak away.

The current system has reusable math helpers and a decent amount of product
scaffolding, but the model/evaluation core is too heuristic and too
operationally inconsistent to support your stated company goals.

The right path is:

1. repair close capture
2. unify evaluation persistence
3. make market status registry-driven
4. rebuild calibration provenance
5. then rebuild models

That sequence gives us the best chance of making this the last rebuild instead
of the fifth partial rewrite.
