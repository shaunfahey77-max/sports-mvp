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
