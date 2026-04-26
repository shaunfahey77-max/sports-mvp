-- Migration 0002: Internal scoreboard for Model-Watch-only markets.
--
-- Adds the `model_watch_results` table used by the admin Model-Watch
-- performance endpoint. Rows here are NEVER read by /picks,
-- /performance, or /performance/history — they exist only so we can
-- evaluate whether a market in MARKET_MODEL_WATCH_ONLY (currently
-- nhl_spread and mlb_moneyline) should be promoted back to Official.
--
-- Safe to re-run on a database that already has the objects:
-- IF NOT EXISTS / exception handling on every statement.

CREATE TABLE IF NOT EXISTS "model_watch_results" (
        "id" serial PRIMARY KEY NOT NULL,
        "date" date NOT NULL,
        "game_key" text NOT NULL,
        "league" text NOT NULL,
        "market" text NOT NULL,
        "pick" text NOT NULL,
        "tier" text NOT NULL,
        "publish_odds" numeric NOT NULL,
        "publish_line" numeric,
        "close_odds" numeric,
        "close_line" numeric,
        "model_prob_calibrated" numeric NOT NULL,
        "edge" numeric NOT NULL,
        "ev" numeric NOT NULL,
        "rank_score" numeric NOT NULL,
        "clv_implied_delta" numeric,
        "clv_line_delta" numeric,
        "result" text DEFAULT 'pending' NOT NULL,
        "event_start" timestamp with time zone NOT NULL,
        "model_version" text DEFAULT 'v1' NOT NULL,
        "scoring_version" text DEFAULT 'v1' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_watch_results_unique_idx"
        ON "model_watch_results" USING btree ("date", "game_key", "market", "pick");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_watch_results_league_market_idx"
        ON "model_watch_results" USING btree ("league", "market");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_watch_results_date_idx"
        ON "model_watch_results" USING btree ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_watch_results_result_idx"
        ON "model_watch_results" USING btree ("result");
