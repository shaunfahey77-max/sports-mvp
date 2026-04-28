# Overview

SportsMVP is a premium sports prediction and scoring engine covering NBA, NHL, and MLB betting markets. Picks publish as Official only when the underlying market clears the launch thresholds (calibration, edge, CLV); newer or recovering markets surface in a separate Model Watch lane while they earn promotion. The platform provides data-driven picks, performance analytics, and tools like a parlay builder, with expected value (EV) and edge percentages exposed on every pick. Live odds come from The Odds API. Built as a pnpm workspace monorepo.

Pricing is launched at two tiers: a Free Guest Pass (one delayed Tier-A pick + public history) and Members at $19.99/mo or $149/yr (full slate including the Model Watch lane). The legacy `mvp_pro` tier ($39.99 "Inner Circle") is retired from new acquisition — backend types and webhook handling for it remain so existing subscriptions continue to render correctly, but `/stripe/prices` filters it out and `/stripe/checkout` rejects it with HTTP 410.

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
- **Dashboard (`/picks`)**: Grid of today's scored picks, highlighting a "Top Pick." When no scored picks AND no non-PASS candidates exist for the day, the page falls back to rendering the SINGLE highest-ranked PASS candidate as a clearly-labeled "Model Watch / Not an Official Pick" card (`FallbackCandidateCard`, `data-testid="fallback-candidate-card"`). Fallback rows never enter `scored_picks`, never appear in `/api/performance`, and never appear in History — they are a pure UI transparency device. Branch order in `Dashboard.tsx`: `allPicks > 0` → official picks; else `liveCandidates (non-PASS) > 0` → live candidates with `TopPickCallout`; else `fallbackCandidate` → fallback section; else "No Action Today".
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

## Environment Variables — Public Site Basic Auth Gate

`SITE_BASIC_AUTH_USER` and `SITE_BASIC_AUTH_PASS` (both secrets, both
environments) toggle a Basic Auth gate that protects the public site.

- Both set → gate is ON. Any unauthenticated request returns `401` with
  `WWW-Authenticate: Basic realm="Restricted"`.
- Either unset or empty → gate is OFF (middleware no-ops). This is the
  rollback path: clear either secret and restart the API server +
  sports-mvp workflow.
- Carve-outs (always reach their handler, never gated): `/api/admin/*`,
  `/api/snapshots/*`, `/api/stripe/webhook`, `/api/health`,
  `/api/healthz`, and the Clerk proxy path (`CLERK_PROXY_PATH`).
- Shared logic (cookie signing/verification, branded HTML login page,
  login + logout handling, Set-Cookie attribute strings, Basic-Auth
  fallback, "session expired" UX) lives in the `@workspace/preview-gate`
  workspace package (`lib/preview-gate/src/index.ts`). Both surfaces
  consume the same module so behavior cannot drift.
- Surface glue:
  `artifacts/api-server/src/middlewares/basicAuthMiddleware.ts`
  (mounted in `app.ts` after pino-http, before Clerk middleware) owns
  the API carve-outs, and `artifacts/sports-mvp/vite.config.ts` owns the
  Vite dev/preview server's proxy-prefix sniffing for the form `action`
  / redirect targets (no carve-outs there — the Vite server only serves
  the SPA shell).
- Comparison uses `crypto.timingSafeEqual` on length-padded buffers to
  avoid timing leaks.

## Production Static Serving — SPA Shell Lives Inside the API Server

The api-server serves both `/api/*` and the sports-mvp SPA shell from
the same Express process. This is required so the basicAuthMiddleware
above gates every public surface — including `/`, `/picks`,
`/performance`, and `/assets/*` — on both `sportsmvp.net` and the
`*.replit.app` deployment URL. Previously, sports-mvp deployed as a
platform-level static service that sat ABOVE the api-server and
bypassed the gate entirely.

Implementation:

- `artifacts/api-server/src/app.ts` reads `../../sports-mvp/dist/public/`
  (the sports-mvp Vite `outDir`) at boot. If `index.html` is present, it
  mounts `express.static` for `/assets/*` (long immutable cache) and the
  root (no-store), plus a SPA fallback that sends `index.html` for any
  GET/HEAD that isn't `/api/*`. If the directory is absent (dev runs
  that don't build sports-mvp), the handlers no-op.
- `artifacts/api-server/.replit-artifact/artifact.toml` claims
  `paths = ["/"]` (was `["/api"]`) so the platform routes ALL production
  traffic through this Node process.
- `artifacts/sports-mvp/.replit-artifact/artifact.toml` keeps
  `services.production.build` (so the platform still produces
  `dist/public/` in sports-mvp's service env, where vite.config.ts can
  read `PORT` and `BASE_PATH`) but has `serve` / `publicDir` /
  `rewrites` removed so it does NOT deploy a competing static layer.
- The dev workflow is unchanged: vite still runs at sports-mvp's
  `previewPath` via `services.development`, and api-server's
  `existsSync(FRONTEND_INDEX)` guard skips static serving when no
  build has been produced.

## Internal Calibration-Review Tool

`POST /api/admin/calibration-review` is a read-only analyst surface that
DELIBERATELY bypasses the public `PUBLIC_TRACK_RECORD_CUTOFFS` filter and
the `data_quality` filter so the analyst can see every scored pick — and
decide what to recalibrate, disable, or promote. The tool does not change
math, thresholds, model blending, or any pricing/product surface; it only
reads `scored_picks`.

Auth: `SESSION_SECRET` in the POST body, mirroring every other admin
endpoint.

Per (league_market, cohort, quality) it reports the standard scoreboard
stats (CLV / ROI / win rate / avg edge / avg EV) plus:

- **Brier (model)** — Brier score on `model_prob_calibrated` vs win/loss
- **Brier (market)** — Brier score on `market_prob_fair` vs win/loss
- **Brier skill** — `1 - brierModel / brierMarket`; positive ⇒ model beats
  the no-vig market price as a probability forecast
- **Edge → win rate monotonicity** — equal-frequency edge buckets with
  per-bucket win rate / ROI / CLV, plus `edgeWinRateCorrelation` and
  `edgeRoiCorrelation` (Pearson on bucket midpoints). Negative correlation
  flags a calibration smell.

Cohort split: `PRE` if `date < PUBLIC_TRACK_RECORD_CUTOFFS[league]`, else
`POST`. Leagues without a cutoff are all `POST`.

Quality split: `clean` if `data_quality IS NULL`, `flagged` for any
non-null label (e.g. `contaminated_ingest`, `pre_fix_contaminated`).
Flagged rows appear as their OWN bucket — never silently removed.

Body fields:

- `secret` (required)
- `format` `"json" | "markdown"` (default `"json"`)
- `sinceDays` number, default `180`. Pass `0` for full history.
- `leagues` `string[]`, restrict to these leagues
- `markets` `string[]`, restrict to these market types
- `buckets` integer in `[2, 20]`, default `4` (monotonicity bucket count)

Implementation lives in `artifacts/api-server/src/scoring/`:
`brierScore.ts`, `monotonicity.ts`, `cohortAnalysis.ts`,
`cohortReportMarkdown.ts`, plus the route in `routes/admin.ts`. Each
helper has a focused unit-test file under `scoring/__tests__/`, all wired
into the `api-tests` workflow.