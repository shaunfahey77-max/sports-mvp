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
- **Team abbreviations**: deliberately not maintained — NCAAF FBS has
  ~134 teams. Following the NCAAM precedent, the fuzzy fallback in
  `getTeamAbbrev` handles college team names. A maintained map can be
  added later if surfacing requires consistent abbreviations.
- **Gating**: `MARKET_DISABLED` keeps `ncaaf_spread`, `ncaaf_moneyline`,
  `ncaaf_total` all `true`. `LEAGUE_MARKET_QUALITY.ncaaf` set to inert
  0.10 across the board until evidence justifies otherwise.
- **Next steps for NCAAF spread build (when ready)**:
  1. Add NCAAF spread features to `featureEngine.ts` (rest days, bye,
     conference flag, ranked-vs-unranked indicator, neutral-site flag,
     altitude / venue notes where relevant).
  2. Build `ncaafSpreadModel.ts` mirroring `nhlSpreadModel.ts` shape with
     NCAAF-specific margin std dev (~16.5 pts historically — wider than
     NFL due to talent gaps).
  3. Add NCAAF spread plausibility ranges
     (`SPREAD_LINE_ABS_MAX.ncaaf` ≈ 45 to handle blowout favorites).
  4. Add `ncaaf_spread` calibration entry, identity sigmoid initially.
  5. Backtest against a historical NCAAF season before flipping
     `MARKET_DISABLED.ncaaf_spread` off.
  6. Wire `ncaaf` into cron `LEAGUES` only when preseason approaches AND
     the model has cleared backtest.

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
- **Next steps before flipping the gate off**:
  1. Backtest against a historical NFL season — measure realized cover
     rate vs model prob in 5pt buckets, check for systematic over/under-
     confidence, fit the calibration sigmoid against that.
  2. Once calibration is fit, flip `MARKET_DISABLED.nfl_spread` off.
  3. Wire `nfl` into cron `LEAGUES` only when preseason approaches AND
     the model has cleared backtest.
  4. Future feature work (requires extending `GameFeatures`): bye-week
     boost, divisional flag, primetime indicator, indoor/outdoor + weather.
