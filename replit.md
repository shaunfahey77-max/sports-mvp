# Overview

SportsMVP is a premium sports prediction and scoring engine focused on NBA and NHL betting markets (moneyline, spread, and total). It provides users with data-driven picks, performance analytics, and tools like a parlay builder. The platform aims to help users "Bet Like an MVP" by offering sophisticated predictive models and clear insights into betting opportunities, including expected value (EV) and edge percentages. The project uses live game odds from The Odds API and is built as a pnpm workspace monorepo.

# User Preferences

I want iterative development. I prefer detailed explanations for complex features or architectural decisions. Ask before making major changes.

# System Architecture

The SportsMVP platform is built as a pnpm workspace monorepo.

**Core Technologies:**
- **Node.js**: Version 24
- **TypeScript**: Version 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod (v4) and drizzle-zod
- **API Codegen**: Orval (from OpenAPI spec)
- **Build Tool**: esbuild (CJS bundle)

**UI/UX Decisions (Frontend - SportsMVP):**
The frontend is a React + Vite application adhering to specific brand guidelines.
- **Brand**: SportsMVP, with a "Bet Like an MVP." tagline.
- **Fonts**: Montserrat (headings, bold) and Roboto (body) from Google Fonts.
- **Color Scheme**: Dark navy theme (Page BG: `#060D1F`, Card: `#0D1B3E`, Border: `#1A3066`).
- **Brand Accent**: Gold `#FFC107` (eyebrows, primary CTAs, active states); softer hover `#FFD54F`.
- **Status Colors**: Win `#4ADE80`, Loss `#F87171`, Push `#FFC107`.
- **Typography**: Headlines use `'Playfair Display', serif`; body remains the system sans.
- **Shell Pattern**: All member pages (Dashboard, Tracker, Parlay, Account, Performance, History, Subscribe, Landing) use the shared `PageLayout` hero — gold uppercase eyebrow → Playfair title → muted subtitle, with the "Math, not mystique." footer.
- **Logos**: Primary shield and horizontal lockup.
- **Badges**: Tier badges (A=gold, B=MVP Blue, C=slate, PASS=dimmed).
- **Results Indicators**: Win=green, Loss=red, Push=yellow.

**Key Features & Pages:**
- **Today's Action (`/`)**: Displays candidate picks with tier badges, league/market labels, EV%, edge%, and results.
- **Dashboard (`/picks`)**: Grid of today's scored picks, highlighting a "Top Pick."
- **Parlay Builder (`/parlay`)**: (MVP+ subscriber feature) Pick selection, parlay calculator, and auto-build functionality.
- **Model Performance (`/performance`)**: Rolling analytics (win rate, ROI, units won, Brier score, CLV hit rate) with time window toggles and breakdowns.
- **Pick History (`/history`)**: Filterable grid of all historical picks.
- **Components**: `PickCard`, `CandidateCard`, `TopPickCallout`, `InfoTooltip`.

**Prediction Layer:**
- Nine dedicated prediction models, one for each league (NBA, NHL) and market (Moneyline, Spread, Total). Each exports a `predict` function returning raw probabilities.

**Scoring Layer:**
- **Market Probability**: Converts American odds to fair probabilities, removing vig.
- **Calibration**: Applies sigmoid/isotonic calibration to raw model probabilities.
- **Expected Value (EV)**: Calculates EV, edge, and Closing Line Value (CLV).
- **Bet Ranking**: Ranks bets based on a composite score (`rank_score = 0.50*ev + 0.25*edge + 0.15*calib_conf + 0.10*mkt_quality`).
- **Tier Assignment**: Assigns A/B/C/PASS tiers based on rank score bands and risk controls.
- **Scoring Pipeline**: Orchestrates the entire process from model output to final ranked picks.
- **Pick Validation**: Scores outcomes and calculates ROI, Brier score, and CLV metrics.
- **Configuration**: `scoringModelConfig.ts` centralizes all scoring parameters, including rank weights, tier thresholds, and calibration methods.

**Simulation Engine:**
- On-demand 45-day backtester, providing insights into ROI, win rate, CLV hit rate, and Brier score.

**Authentication & Subscriptions:**
- **Authentication**: Utilizes Clerk for user management, sign-in, and sign-up flows. API routes are protected using Clerk's `userId`.
- **Subscription System**: Integrates with Stripe for managing MVP and MVP Pro subscriptions.
    - **Tier Gating**: Features are gated based on user subscription tiers (free, MVP, MVP Pro).
    - **API Endpoints**: `/api/stripe/webhook` for handling Stripe events, `/api/stripe/checkout` for initiating checkouts, `/api/stripe/portal` for managing billing, and `/api/stripe/prices` for fetching product pricing.

**Database Schema:**
- **`users`**: Stores Clerk user data, Stripe customer/subscription IDs, and subscription tier.
- **`game_snapshots`**: Records raw game and market data (publish and close lines).
- **`candidate_bets`**: Stores all evaluated bets with complete scoring metadata. Has nullable `data_quality` text column for surgical row-level exclusion.
- **`scored_picks`**: Contains final (non-PASS) picks with their outcomes. Has nullable `data_quality` text column for surgical row-level exclusion.
- **`validation_metrics`**: Holds rolling performance snapshots (14/30/45 days).
- **`simulation_runs`**: Stores results of 45-day simulation runs.

**Data Quality Filter (surgical row exclusion):**
- A nullable `data_quality` text column on `scored_picks` and `candidate_bets` lets us hide specific contaminated rows without date cutoffs or row deletion. The constant `DATA_QUALITY_CONTAMINATED_INGEST = "contaminated_ingest"` lives in `scoringModelConfig.ts`.
- Read-side filters: `isNull(table.dataQuality)` is appended to `/api/picks`, `/api/picks/candidates`, and both `/api/performance` queries — any non-null label is excluded from public surfaces.
- Boot-time labeling: `applyContaminatedNhlLabels()` runs from `runMigrations()` on every server start, idempotently labeling 4 known contaminated NHL game_keys (col_cgy, wpg_mamm, wsh_cbj on 2026-04-14; sjs_chi on 2026-04-15). Idempotent (gated on `data_quality IS NULL`) so it's a no-op once applied.
- Critical: the **production deployment uses a separate Postgres database from the dev workspace** (different row populations, different primary keys). Schema migrations propagate automatically via `runMigrations()`, but row-level data fixes do NOT — they must run at startup or be re-applied per environment.

**API Routes:**
- **Snapshots**: `/api/snapshots` (GET), `/api/snapshots/generate` (POST), `/api/snapshots/finalize` (POST).
- **Picks**: `/api/picks` (GET), `/api/picks/candidates` (GET), `/api/picks/score` (POST), `/api/picks/validate` (POST).
- **Performance**: `/api/performance` (GET), `/api/performance/history` (GET).
- **Simulation**: `/api/simulate` (POST), `/api/simulate/{runId}` (GET), `/api/simulate/list` (GET).
- **User**: `/api/user/me` (GET).

**Key Formulas:**
- **Edge**: `model_prob_calibrated - market_prob_fair`
- **EV**: `p * (decimal_odds - 1) - (1 - p)`
- **Rank Score**: `0.50 * norm_ev + 0.25 * norm_edge + 0.15 * calib_conf + 0.10 * mkt_quality`
- **Tier Thresholds**: A (rank_score ≥ 0.65), B (≥ 0.50), C (≥ 0.35), PASS (< 0.35).

# External Dependencies

- **The Odds API**: Used for pulling live game odds and historical scores (`ODDS_API_KEY`).
- **Clerk**: Authentication and user management service (`VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
- **Stripe**: Payment processing and subscription management. Integrated via Replit Stripe connector (`REPL_IDENTITY` token).
- **PostgreSQL**: Relational database for all application data.
- **Google Fonts**: For Montserrat and Roboto fonts.
- **ESPN CDN**: For retrieving team logos.