-- Migration 0003: Idempotency / audit table for the nightly Model-Watch
-- alert check (Task #17 — alert when a Model-Watch market earns its way
-- into live picks).
--
-- The nightly cron aggregates `model_watch_results` and, when a
-- (league, market) bucket clears the configured promotion thresholds,
-- it inserts a row here and emits a notification log line. The unique
-- index on (league, market) is what guarantees re-firing is idempotent
-- — once a market has alerted, subsequent nightly runs see the row and
-- skip the notification. Deleting a row lets the alert fire again on
-- the next eligible nightly run.
--
-- Safe to re-run on a database that already has the objects:
-- IF NOT EXISTS on every statement.

CREATE TABLE IF NOT EXISTS "model_watch_alerts" (
        "id" serial PRIMARY KEY NOT NULL,
        "league" text NOT NULL,
        "market" text NOT NULL,
        "first_fired_at" timestamp with time zone DEFAULT now() NOT NULL,
        "resolved_samples" integer NOT NULL,
        "roi" numeric NOT NULL,
        "avg_clv" numeric NOT NULL,
        "win_rate" numeric NOT NULL,
        "metrics" jsonb NOT NULL,
        "thresholds" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_watch_alerts_league_market_unique_idx"
        ON "model_watch_alerts" USING btree ("league", "market");
