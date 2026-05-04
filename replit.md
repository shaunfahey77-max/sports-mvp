# Overview

SportsMVP is a premium sports prediction and scoring engine providing data-driven picks, performance analytics, and tools for NBA, NHL, and MLB betting markets. The platform aims to offer sophisticated betting insights through advanced modeling, calibration, and value assessment, helping users "Bet Like an MVP." Picks are categorized into "Official" when meeting rigorous launch thresholds and "Model Watch" for newer or recovering markets. The project vision is to be a leading data-driven platform in sports betting, offering transparency through metrics like Expected Value (EV) and edge percentages.

The platform offers a Free Guest Pass and a paid Membership tier, with a legacy tier maintained for existing subscribers.

# User Preferences

I want iterative development. I prefer detailed explanations for complex features or architectural decisions. Ask before making major changes.

# System Architecture

The SportsMVP platform is built as a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9. The backend is an Express 5 API, utilizing PostgreSQL with Drizzle ORM for data persistence and Zod for validation. API codegen is handled by Orval from an OpenAPI spec.

**UI/UX Decisions (Frontend - SportsMVP):**
The frontend is a React + Vite application.
- **Brand**: SportsMVP, tagline "Bet Like an MVP."
- **Fonts**: Montserrat (headings) and Roboto (body).
- **Color Scheme**: Dark navy theme (`#060D1F`, `#0D1B3E`, `#1A3066`) with a gold accent (`#FFC107`).
- **Status Colors**: Green for Win (`#4ADE80`), Red for Loss (`#F87171`), Yellow for Push (`#FFC107`).
- **Typography**: Headlines use `'Playfair Display', serif`; body uses system sans-serif.
- **Shell Pattern**: Consistent `PageLayout` hero and "Math, not mystique." footer across member pages.
- **Badges**: Tier badges (A=gold, B=MVP Blue, C=slate, PASS=dimmed).

**Key Features & Pages:**
- **Today's Action (`/`)**: Displays candidate picks with detailed metrics and results.
- **Dashboard (`/picks`)**: Grid of today's scored picks, featuring a "Top Pick" and displaying "Model Watch" picks as a UI transparency device when no official picks are available.
- **Parlay Builder (`/parlay`)**: Allows pick selection, calculation, and auto-building of parlays (subscriber feature).
- **Model Performance (`/performance`)**: Provides rolling analytics (win rate, ROI, units won, Brier score, CLV hit rate) with time window toggles.
- **Pick History (`/history`)**: Filterable grid of all historical picks.
- **Core Components**: `PickCard`, `CandidateCard`, `TopPickCallout`, `InfoTooltip`.

**Prediction & Scoring Layer:**
- **Prediction**: Nine dedicated models (per league/market) provide raw probabilities.
- **Scoring Pipeline**: Converts American odds to fair probabilities, applies calibration (sigmoid/isotonic), calculates Expected Value (EV), edge, and Closing Line Value (CLV).
- **Bet Ranking**: Ranks bets based on a composite score (`rank_score = 0.50*ev + 0.25*edge + 0.15*calib_conf + 0.10*mkt_quality`).
- **Tier Assignment**: Assigns A/B/C/PASS tiers based on rank score bands and risk controls, configured via `scoringModelConfig.ts`.
- **Pick Validation**: Scores outcomes and calculates performance metrics.

**Simulation Engine:**
- An on-demand 45-day backtester provides insights into ROI, win rate, CLV hit rate, and Brier score.

**Authentication & Subscriptions:**
- **Authentication**: Clerk handles user management, sign-in, and sign-up. API routes are protected by Clerk's `userId`.
- **Subscription System**: Stripe manages MVP and MVP Pro subscriptions, with features gated by user tier. API endpoints exist for Stripe webhooks, checkout, portal management, and price fetching.

**Database Schema (PostgreSQL):**
- **`users`**: User data, Stripe IDs, subscription tier.
- **`game_snapshots`**: Raw game and market data.
- **`candidate_bets`**: All evaluated bets with scoring metadata.
- **`scored_picks`**: Final (non-PASS) picks with outcomes.
- **`validation_metrics`**: Rolling performance snapshots.
- **`simulation_runs`**: Results of simulation runs.
- **Data Quality Filter**: A `data_quality` column on `candidate_bets` and `scored_picks` allows for surgical exclusion of contaminated rows from public surfaces.

**Candidates Endpoint (`/picks/candidates`):**
- Dedup prefers latest `snapshotDate` per (gameKey, marketType, side), not highest EV.
- Non-renderable `selectionReason` values (market_disabled, insufficient_edge, etc.) are filtered out before `capAndSort` so they don't consume per-game/per-league cap slots.

**API Routes:**
- **Snapshots**: `/api/snapshots`, `/api/snapshots/generate`, `/api/snapshots/finalize`.
- **Picks**: `/api/picks`, `/api/picks/candidates`, `/api/picks/score`, `/api/picks/validate`.
- **Performance**: `/api/performance`, `/api/performance/history`.
- **Simulation**: `/api/simulate`, `/api/simulate/{runId}`, `/api/simulate/list`.
- **User**: `/api/user/me`.
- **Admin**: `/api/admin/calibration-review` provides an internal tool for analysts to review all scored picks, bypassing public filters for calibration insights.

**Production Static Serving:**
The API server serves both `/api/*` and the SportsMVP SPA shell from the same Express process, ensuring consistent application of the basic authentication gate across all public surfaces.

# External Dependencies

- **The Odds API**: Live game odds and historical scores.
- **Clerk**: Authentication and user management.
- **Stripe**: Payment processing and subscription management.
- **PostgreSQL**: Primary application database.
- **Google Fonts**: For Montserrat and Roboto fonts.
- **ESPN CDN**: Team logos.
- **Basic Auth Gate**: Uses `SITE_BASIC_AUTH_USER` and `SITE_BASIC_AUTH_PASS` environment variables to protect the public site, implemented via the `@workspace/preview-gate` package.