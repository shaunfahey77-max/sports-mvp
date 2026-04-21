# Workspace

## Overview

Premium sports prediction and scoring engine for **NBA and NHL** betting markets (NCAAM removed — out of season). Supports moneyline, spread, and total markets. Live game odds are pulled from **The Odds API** (ODDS_API_KEY secret). Built on a pnpm workspace monorepo.

**Brand**: SportsMVP — "Bet Like an MVP."
**Brand Guidelines**: See `.local/brand-guidelines.md` — must be followed for ALL frontend work.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Brand Quick Reference

**Fonts**: Montserrat (headings, bold) + Roboto (body) from Google Fonts
**Primary Colors**: MVP Blue `#0033A0` | Victory Red `#D32F2F`
**Secondary Colors**: Action Green `#388E3C` | Highlight Yellow `#FFC107`
**Neutral**: Slate Gray `#424242` | White `#FFFFFF`
**Dark Surfaces**: Page BG `#060D1F` | Card `#0D1B3E` | Elevated `#112454` | Border `#1A3066`

**Logos (copy to frontend public/ before use)**:
- Primary shield: `attached_assets/sports-mvp-logo_-_Edited_1775577729533.png`
- Horizontal lockup: `attached_assets/Sport-MVP-alternate-logo-transparent_1775577748977.png`

**Tier badges**: A=gold(`#FFC107`), B=MVP Blue(`#0033A0`), C=slate(`#424242`), PASS=dimmed
**Results**: Win=green(`#388E3C`), Loss=red(`#D32F2F`), Push=yellow(`#FFC107`)

Full brand details: `.local/brand-guidelines.md`

## Frontend — SportsMVP (`artifacts/sports-mvp`)

React + Vite subscriber-facing dashboard at preview path `/`.

**Pages:**
- `/` — Today's Action: candidate picks with tier badges, league/market labels, EV%, edge%, result
- `/picks` — Dashboard: today's scored picks grid with Top Pick callout
- `/parlay` — Parlay Builder (MVP+ subscriber feature): pick selection + parlay calculator + auto-build
- `/performance` — Model Performance: rolling analytics (win rate, ROI, units won, Brier score, CLV hit rate) with 14/30/45-day window toggle + tier/league/market breakdowns
- `/history` — Pick History: filterable grid of all historical picks

**Brand applied**: Dark navy theme (page BG `#060D1F`, card `#0D1B3E`), Montserrat + Roboto fonts, tier badges (A=gold, B=blue, C=slate), result indicators (win=green, loss=red)

**Logos copied to `public/`**: `logo-shield.png` (hero), `logo-nav.png` (navbar)

**API integration**: axios default baseURL set to `/api`, uses orval-generated hooks from `@workspace/api-client-react`

**Key components:**
- `src/components/PickCard.tsx` — Pick card with team logos, matchup display, tier/edge/EV tooltips, CLV delta
- `src/components/CandidateCard.tsx` — Candidate card with same logo + tooltip features
- `src/components/TopPickCallout.tsx` — Gold-accented TOP PICK OF THE DAY hero banner (highest rankScore among A/B tiers)
- `src/components/ui/InfoTooltip.tsx` — Inline ⓘ tooltip with explanatory copy for any metric label
- `src/lib/teamLogos.ts` — ESPN CDN team logo lookup by league (NBA/NHL/NCAAM) + gameKey matchup parser

**Features per page:**
- All pages: shield logo in header, collapsible "How to Read / How It Works" explainer section
- Dashboard: Top Pick callout + highlighted pick card for highest-ranked pick; team logos with picked-side highlighting
- Performance: 12 stat cards each with info tooltip; color-coded tier/league/market breakdowns; model pipeline explanation
- History: Picks count + Win/Loss/Push/Pending summary row; CLV delta shown on every graded pick

## Architecture

### Prediction Layer (`artifacts/api-server/src/prediction/`)

Nine model modules — one per league/market combination:

| League | Moneyline | Spread | Total |
|--------|-----------|--------|-------|
| NBA    | nbaMoneylineModel.ts | nbaSpreadModel.ts | nbaTotalModel.ts |
| NCAAM  | ncaamMoneylineModel.ts | ncaamSpreadModel.ts | ncaamTotalModel.ts |
| NHL    | nhlMoneylineModel.ts | nhlSpreadModel.ts | nhlTotalModel.ts |

Each model exports a `predict(game: GameMarketInput): Promise<ModelOutput>` function returning raw probabilities.

### Scoring Layer (`artifacts/api-server/src/scoring/`)

| File | Responsibility |
|------|----------------|
| `marketProb.ts` | American odds → implied probability → vig removal → fair probability |
| `calibration.ts` | Sigmoid/isotonic calibration on raw model probabilities |
| `expectedValue.ts` | EV = p*(d-1) - (1-p), edge = calibrated_prob - fair_market_prob, CLV |
| `rankBets.ts` | rank_score = 0.50*ev + 0.25*edge + 0.15*calib_conf + 0.10*mkt_quality |
| `assignTiers.ts` | Tier A/B/C/PASS assignment from score bands + risk controls |
| `scorePicks.ts` | Pipeline orchestrator connecting model → calibration → scoring → ranking |
| `validatePicks.ts` | Outcome scoring, ROI, Brier score, log loss, CLV metrics |

### Configuration (`artifacts/api-server/src/config/scoringModelConfig.ts`)

Central config for all scoring parameters: rank weights, tier thresholds, home advantage by league, calibration method selection.

### Simulation Engine (`artifacts/api-server/src/simulation/simulate45Days.ts`)

On-demand 45-day backtester. Inputs: startDate, days, leagues, markets, model/scoring/calibration versions. Outputs: ROI, win rate, CLV hit rate, Brier score, log loss, drawdown, per-day breakdown.

### Auth + Subscription System

### Clerk Authentication
- Provider: Clerk (VITE_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY set)
- Proxy middleware: `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`
- Routes: `/sign-in`, `/sign-up` — Clerk embedded components with custom localization
- Protected routes use `<Show when="signed-in">` + `<Redirect>` pattern
- API auth: `getAuth(req)` from `@clerk/express` returns `{ userId }` for session validation
- Auth pane (Replit toolbar) manages users, providers, and OAuth credentials

### Stripe Subscriptions
- Integration: Replit Stripe connector (reads credentials via REPL_IDENTITY token)
- Products: `prod_UIH0YSKeXgO2mf` (MVP) and `prod_UIH0B0pmsXpaAa` (MVP Pro) — both have `metadata.tier` set
- Tier system: `free` | `mvp` | `mvp_pro` (stored in `users.tier`)
- Webhook endpoint: `POST /api/stripe/webhook` — handles `customer.subscription.*` and `checkout.session.completed`
- Checkout: `POST /api/stripe/checkout` with `{ priceId }` → returns `{ url }` for redirect
- Portal: `POST /api/stripe/portal` → returns `{ url }` for Stripe billing portal
- Prices: `GET /api/stripe/prices` → returns products with prices filtered by `metadata.tier` field
- User endpoint: `GET /api/user/me` → upserts user on first call, syncs tier from Stripe, returns tier

### Pricing
| Plan | Monthly | Yearly |
|------|---------|--------|
| MVP | $19.99/mo | $149/yr (save 38%) |
| MVP Pro | $39.99/mo | $299/yr (save 38%) |

### Tier Gating
- Free: 1 top pick per day (Tier A only), basic stats, public performance history
- MVP: Unlimited picks (all tiers), full Edge/EV/CLV data, Parlay Builder, Bet Tracker
- MVP Pro: Everything in MVP + 5/6-leg parlays, priority updates, early access

## Database Schema (`lib/db/src/schema/`)

| Table | Purpose |
|-------|---------|
| `users` | Clerk user + Stripe customer/subscription ID + tier |
| `game_snapshots` | Raw game/market data with publish and close lines |
| `candidate_bets` | All evaluated bets with full scoring metadata |
| `scored_picks` | Final picks (non-PASS) with outcomes |
| `validation_metrics` | Rolling 14/30/45-day performance snapshots |
| `simulation_runs` | 45-day simulator runs with results |

### API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/snapshots` | List game snapshots |
| POST | `/api/snapshots/generate` | Ingest game data (publish lines) |
| POST | `/api/snapshots/finalize` | Mark closing lines |
| GET | `/api/picks` | List scored picks (filterable) |
| GET | `/api/picks/candidates` | List all candidates including PASS |
| POST | `/api/picks/score` | Run full prediction pipeline for a date |
| POST | `/api/picks/validate` | Score outcomes for finalized games |
| GET | `/api/performance` | Rolling performance metrics |
| GET | `/api/performance/history` | Historical metric records |
| POST | `/api/simulate` | Start a 45-day simulation run |
| GET | `/api/simulate/{runId}` | Get simulation results |
| GET | `/api/simulate/list` | List all simulation runs |

## Key Formulas

- **Edge**: `model_prob_calibrated - market_prob_fair`
- **EV**: `p * (decimal_odds - 1) - (1 - p)`
- **Rank Score**: `0.50 * norm_ev + 0.25 * norm_edge + 0.15 * calib_conf + 0.10 * mkt_quality`
- **Tier A**: rank_score ≥ 0.65 | **Tier B**: ≥ 0.50 | **Tier C**: ≥ 0.35 | **PASS**: < 0.35

## Operational Flow

1. **Generate Snapshots** — POST `/api/snapshots/generate` with game/market data
2. **Score** — POST `/api/picks/score` to run prediction models and persist candidates
3. **Finalize Closes** — POST `/api/snapshots/finalize` after games are over
4. **Validate** — POST `/api/picks/validate` to score outcomes and compute CLV

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Operations Runbook

### Settlement Pipeline
- **Nightly job** (`runNightlyValidation`, 3:30 AM ET daily): fetches completed
  scores from the Odds API for the last 3 days (max supported by the API),
  grades `scored_picks`, finalizes `game_snapshots`.
- **Self-healing ESPN backstop**: after each nightly run, sweeps the last 7 days
  via ESPN's free scoreboard API to recover any games that aged past the Odds
  API's 3-day `/scores` window (e.g. missed cron run, server restart through
  the 3:30 AM slot, Odds API 5xx). Idempotent — skips already-final games.
- **Manual recovery**: `POST /api/admin/backfill-settlement` with
  `{ startDate, endDate, leagues?, secret }` where `secret` is the
  `SESSION_SECRET` env var. Uses ESPN scoreboard; idempotent.
- **Known incident (2026-04-08 → 2026-04-15)**: 54 pending picks stranded
  because the 3-day Odds API window expired while the nightly job was not
  firing. Recovered via ESPN backfill; self-healing backstop now prevents
  recurrence.

### MLB Phase 0.75D — Foundation (branch only, hidden, NO DEPLOY)
- **Scope**: moneyline only. Run line (`mlb_spread`) and totals (`mlb_total`)
  are stubbed disabled in `MARKET_DISABLED` and the cron skips them via
  per-league `MARKETS_BY_LEAGUE` (no models exist yet).
- **Public visibility**: `DEFAULT_PRODUCTION_LEAGUES` in
  `routes/picks.ts` and `routes/performance.ts` remains `["nba", "nhl"]`.
  MLB only appears with explicit `?league=mlb`. Regression-guarded by
  `src/scoring/__tests__/mlbVisibility.test.ts`.
- **Wiring**: `SPORT_KEYS.mlb=baseball_mlb`, `ESPN_SPORT_PATH.mlb=baseball/mlb`,
  `MLB_TEAM_ABBREVS` (30 teams + Athletics alias), `mlbMoneylineModel.predict`
  (market-anchored + small home-field nudge + modest rest adjustment, no B2B).
- **Settlement safety**: `runNightlyValidation` snapshot match now requires
  both home AND away team match (mirrors ESPN backstop), preventing MLB
  doubleheader collisions. Benefits NBA/NHL too.

### MLB Shadow-Mode KPI Report (internal validation, NO DEPLOY)
- **Run**: `pnpm --filter @workspace/scripts exec tsx src/mlbShadowReport.ts`
  (or `pnpm --filter @workspace/scripts run mlb-shadow-report`).
- **Args**: `[--start YYYY-MM-DD] [--end YYYY-MM-DD] [--json-only]`.
- **What it covers**: daily candidate vs surfaced funnel; W-L-P, ROI, win
  rate, Brier on settled `scored_picks`; edge percentiles + histogram across
  all candidates; calibration buckets (model_prob → realized win rate); tier
  counts; selection-reason breakdown.
- **Read-only**: queries `candidate_bets` + `scored_picks` for `league='mlb'`
  only. Does not write the DB and never touches public route code.
- **Unit tests**: `scripts/src/__tests__/mlbShadowReport.test.ts`.

### NCAAF Phase 0.75F — Foundation prep (branch only, hidden, NO DEPLOY, no live ingest yet)
- **Scope**: planning + foundation scaffolding only. No models built yet.
  Spread will be the first market wired (mirrors NFL plan); moneyline
  and total deferred.
- **Public visibility**: `DEFAULT_PRODUCTION_LEAGUES` unchanged.
  NCAAF is also kept out of `cronService` `LEAGUES` to avoid burning
  Odds API credits on offseason endpoints (NCAAF Week 0 is ~late
  August 2026). Regression-guarded by
  `src/scoring/__tests__/ncaafVisibility.test.ts`.
- **Wiring**: `SPORT_KEYS.ncaaf=americanfootball_ncaaf`,
  `ESPN_SPORT_PATH.ncaaf=football/college-football`, `League` type,
  placeholder `HOME_ADVANTAGE.ncaaf=0.060` (~3.0pt HFA — larger than
  NFL, to be tuned against backtest).
- **Team abbreviations — DETERMINISTIC MAP NOW MAINTAINED**:
  `NCAAF_TEAM_ABBREVS` covers all 134 FBS schools with collision-free
  3-5 char codes; `NCAAF_TEAM_ALIASES` handles common short forms
  ("Ohio St" → "Ohio State Buckeyes", "FSU" → "Florida State Seminoles",
  etc.). The fuzzy fallback was unsafe for college football: it
  collapsed Ohio State / Oklahoma State / Oregon State all to "stat"
  and would have silently corrupted backtest per-team aggregations.
  `assertNoAbbrevCollisions('ncaaf', ...)` runs at module load to fail
  fast on any future regression; `assertAliasesResolve` ensures every
  alias points at a real canonical entry. Coverage tested in
  `scoring/__tests__/ncaafTeamAbbreviations.test.ts` (collision-free
  invariant, known historical collision pairs, common alias resolution,
  Odds API canonical name handling, whitespace tolerance).
- **Gating**: `MARKET_DISABLED` keeps `ncaaf_spread`, `ncaaf_moneyline`,
  `ncaaf_total` all `true`. `LEAGUE_MARKET_QUALITY.ncaaf` set to inert
  0.10 across the board until evidence justifies otherwise.
- **NCAAF spread model — v1 BUILT (still gated, no deploy)**:
  - `prediction/ncaafSpreadModel.ts`: vig-free moneyline → expected
    margin via inverse normal CDF, `MARGIN_STD_DEV = 16.5` (wider than
    NFL due to college talent gaps), HFA in points form
    (`HOME_ADVANTAGE.ncaaf * MARGIN_STD_DEV`), `restAdvantage`
    adjustment at `REST_ADV_POINTS_PER_DAY = 0.20`, normal CDF for
    cover prob, output clamped to [0.05, 0.95].
  - Wired into `scorePicks.getModel` switch as `ncaaf_spread`.
  - `SPREAD_LINE_ABS_MAX.ncaaf = 50` (top-25 vs FBS minnows routinely
    posts -35 to -45; cap at ±50 admits every realistic main spread
    while still rejecting alt-line / first-half / team-total leakage).
  - Calibration: identity sigmoid `(a=1, b=0)` until backtest tunes.
  - Coverage: 8 unit tests in `scoring/__tests__/ncaafSpreadModel.test.ts`
    pin prob sum-to-1, HFA in points form, rest adjustment direction +
    magnitude, clamp behavior, pick'em HFA, large-spread plausibility.
- **Still gated**: `MARKET_DISABLED.ncaaf_spread = true` and `ncaaf`
  not in cron `LEAGUES`. The new `ncaaf_spread` switch case exists so
  an internal backtest harness can invoke the model directly without
  flipping the production gates.
- **Backtest result (2025 season, 670 games, 1340 candidates) — KEEP GATED**:
  ROI -1.3%, win rate 50.5%, Brier 0.2514 (≈ baseline 0.250), tier signal
  inverted (Tier C +1.7% ROI > Tier A +0.3% ROI). Plus normalization gap:
  68 of 198 unique team strings (34%) fell through to fuzzy matching —
  mostly FCS opponents in week-1 FBS-vs-FCS games (Idaho State, Sam Houston,
  Lafayette, Delaware, etc.). Full report: `.local/backtest-reports/SUMMARY.md`
  + `ncaaf-2025.txt`. Reproduce: `pnpm --filter @workspace/scripts run football-backtest-report -- --league ncaaf --start 2025-08-23 --end 2026-01-13`.
- **Phase A normalization repair COMPLETE (2026-04-21)**:
  Football redesign plan: `.local/football-redesign-plan.md`. Phase A added
  6 feed-form aliases for FBS programs whose canonical key didn't match
  the upstream feed string ("UMass Minutemen" → "Massachusetts Minutemen",
  "UL Monroe Warhawks" → "Louisiana-Monroe Warhawks", "Florida International
  Panthers" → "FIU Panthers", "Southern Mississippi Golden Eagles" →
  "Southern Miss Golden Eagles", "Delaware Blue Hens" → "Delaware Fightin
  Blue Hens", "Sam Houston State Bearkats" → "Sam Houston Bearkats").
  New `resolveTeamAbbrev()` helper exposes resolution path
  ('canonical' | 'alias' | 'fuzzy'); `getTeamAbbrev()` is now a thin
  wrapper for back-compat. Four new invariants in
  `src/scoring/__tests__/ncaafTeamAbbreviations.test.ts` (now wired into
  the `api-tests` workflow): every canonical key resolves via 'canonical',
  every alias resolves via 'alias', the 2025-backtest fuzzy-fallback FBS
  fixture resolves non-fuzzy, and FCS strings are still reported as 'fuzzy'
  for back-compat. Per the redesign plan, FCS coverage is intentionally
  NOT expanded — FBS-vs-FCS games will be filtered out of future candidate
  sets at build time instead.
- **Remaining steps before any future re-evaluation**:
  1. Filter FBS-vs-FCS games out of the candidate-build path (Phase B).
  2. NFL feature redesign pass (next): drop double-counted HFA, add real
     independent features (rest, ATS form, recent points-differential).
  3. Investigate the inverted tier signal — likely a feature-engineering
     or calibration bug, not a tier-threshold bug.
  4. Re-run the report against two independent windows; only then revisit
     the gate.

### NFL Phase 0.75E — Foundation prep (branch only, hidden, NO DEPLOY, no live ingest yet)
- **Scope**: planning + foundation scaffolding only. No models built yet.
  Spread will be the first market wired (per project direction); moneyline
  and total deferred.
- **Public visibility**: `DEFAULT_PRODUCTION_LEAGUES` unchanged. NFL is
  also kept out of `cronService` `LEAGUES` to avoid burning Odds API
  credits on offseason endpoints (NFL preseason ~early August 2026).
  Regression-guarded by `src/scoring/__tests__/nflVisibility.test.ts`.
- **Wiring**: `SPORT_KEYS.nfl=americanfootball_nfl`,
  `ESPN_SPORT_PATH.nfl=football/nfl`, `NFL_TEAM_ABBREVS` (32 teams),
  `featureEngine` ABBREV_LOOKUP entry, `League` type, placeholder
  `HOME_ADVANTAGE.nfl=0.045` (~2.5pt HFA in prob terms — to be tuned
  against backtest).
- **Gating**: `MARKET_DISABLED` keeps `nfl_spread`, `nfl_moneyline`,
  `nfl_total` all `true`. `LEAGUE_MARKET_QUALITY.nfl` set to inert 0.10
  across the board until evidence justifies otherwise.
- **NFL spread model — v1 BUILT (still gated, no deploy)**:
  - `prediction/nflSpreadModel.ts`: vig-free moneyline → expected margin
    via inverse normal CDF, `MARGIN_STD_DEV = 13.45`, HFA in points form
    (`HOME_ADVANTAGE.nfl * MARGIN_STD_DEV`), `restAdvantage` adjustment
    at `REST_ADV_POINTS_PER_DAY = 0.20`, normal CDF for cover prob,
    output clamped to [0.05, 0.95].
  - Wired into `scorePicks.getModel` switch as `nfl_spread`.
  - `SPREAD_LINE_ABS_MAX.nfl = 21` (rejects alt-line / first-half / team-
    total leakage; admits every realistic main spread).
  - Calibration: identity sigmoid `(a=1, b=0)` until backtest tunes.
  - Coverage: 8 unit tests in `scoring/__tests__/nflSpreadModel.test.ts`
    pin probability sum-to-1, HFA application in points form, rest
    adjustment direction + magnitude, clamp behavior, and pick'em HFA.
- **Still gated**: `MARKET_DISABLED.nfl_spread = true` and `nfl` not in
  cron `LEAGUES`. The new `nfl_spread` switch case exists so an internal
  backtest harness can invoke the model directly without flipping the
  production gates.
- **Backtest result (2025 season, 225 games, 450 candidates) — KEEP GATED**:
  ROI **-6.2%**, win rate 47.2% (vs 52.4% break-even), Brier 0.2565 (≈ baseline
  0.250), Tier C catastrophic at -23.6% ROI. avg model prob = 0.500 vs avg
  implied prob = 0.510 — model isn't picking up the home-favoritism asymmetry
  the market prices in. Calibration is centered correctly in [0.45, 0.55]
  but tails are tiny. Full report: `.local/backtest-reports/SUMMARY.md`
  + `nfl-2025.txt`. Reproduce: `pnpm --filter @workspace/scripts run football-backtest-report -- --league nfl --start 2025-09-01 --end 2026-02-10`.
- **Next steps before any future re-evaluation**:
  1. Investigate why avg model prob centers exactly on 0.500 — model is
     not learning the home-side bias the market reflects.
  2. Future feature work (requires extending `GameFeatures`): bye-week
     boost, divisional flag, primetime indicator, indoor/outdoor + weather.
  3. Re-run the report before considering any gate flip.

### Backtest tooling (added Apr 2026)
- `scripts/src/footballBacktestReport.ts` — read-only NFL/NCAAF backtest
  report that runs the gated v1 spread models against `game_snapshots`,
  bypasses `MARKET_DISABLED` for tier assignment ONLY (production
  `assignTier` unchanged), grades against final scores, and emits the
  full metric suite (ROI, Brier, log loss, calibration buckets, tier
  breakdown, edge percentiles, red flags, NCAAF normalization audit).
  Tests: `scripts/src/__tests__/footballBacktestReport.test.ts` (8 unit
  tests for `shadowAssignTier`, `auditNcaafNormalization`, `pct`).
- `scripts/src/runFootballHistoricalIngest.ts` + `probeOddsApiHistorical.ts`
  — internal tools for populating snapshots via Odds API historical
  endpoint (30 credits/call). Production cron is unchanged.
- Historical-ingest snapshots write *before* scoring fires, so the
  "No model for nfl_moneyline" / "ncaaf_moneyline" errors at the
  scoring stage are harmless for backtest purposes — snapshots persist,
  the backtest report does its own scoring/grading from snapshots.
