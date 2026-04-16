-- Baseline migration: captures full production schema as of April 2026.
-- Every statement uses IF NOT EXISTS / exception handling so this is
-- completely safe to run against a database that already has these objects.

DO $$ BEGIN
  CREATE TYPE "public"."user_tier" AS ENUM('free', 'mvp', 'mvp_pro');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_snapshots" (
        "id" serial PRIMARY KEY NOT NULL,
        "game_key" text NOT NULL,
        "league" text NOT NULL,
        "event_start" timestamp with time zone NOT NULL,
        "home_team" text NOT NULL,
        "away_team" text NOT NULL,
        "home_publish_ml" numeric NOT NULL,
        "away_publish_ml" numeric NOT NULL,
        "home_close_ml" numeric,
        "away_close_ml" numeric,
        "publish_spread" numeric,
        "publish_spread_line" numeric,
        "publish_away_spread_line" numeric,
        "close_spread" numeric,
        "close_spread_line" numeric,
        "publish_total" numeric,
        "publish_over_line" numeric,
        "publish_under_line" numeric,
        "close_total" numeric,
        "close_over_line" numeric,
        "close_under_line" numeric,
        "home_score" integer,
        "away_score" integer,
        "status" text DEFAULT 'scheduled' NOT NULL,
        "snapshot_date" date NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "game_snapshots_game_key_unique" UNIQUE("game_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_bets" (
        "id" serial PRIMARY KEY NOT NULL,
        "game_key" text NOT NULL,
        "league" text NOT NULL,
        "market_type" text NOT NULL,
        "side" text NOT NULL,
        "event_start" timestamp with time zone NOT NULL,
        "publish_odds" numeric NOT NULL,
        "publish_line" numeric,
        "model_prob_raw" numeric NOT NULL,
        "model_prob_calibrated" numeric NOT NULL,
        "market_prob_fair" numeric NOT NULL,
        "edge" numeric NOT NULL,
        "ev" numeric NOT NULL,
        "rank_score" numeric NOT NULL,
        "tier" text NOT NULL,
        "calibration_method" text DEFAULT 'none' NOT NULL,
        "calibration_version" text DEFAULT 'v1' NOT NULL,
        "market_quality" numeric DEFAULT '1.0' NOT NULL,
        "selection_reason" text,
        "snapshot_date" date NOT NULL,
        "model_version" text DEFAULT 'v1' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scored_picks" (
        "id" serial PRIMARY KEY NOT NULL,
        "date" date NOT NULL,
        "game_key" text NOT NULL,
        "league" text NOT NULL,
        "market" text NOT NULL,
        "pick" text NOT NULL,
        "result" text DEFAULT 'pending' NOT NULL,
        "publish_odds" numeric NOT NULL,
        "publish_line" numeric,
        "close_odds" numeric,
        "close_line" numeric,
        "model_prob_raw" numeric NOT NULL,
        "model_prob_calibrated" numeric NOT NULL,
        "market_prob_fair" numeric NOT NULL,
        "edge" numeric NOT NULL,
        "ev" numeric NOT NULL,
        "rank_score" numeric NOT NULL,
        "tier" text NOT NULL,
        "clv_line_delta" numeric,
        "clv_implied_delta" numeric,
        "meta" jsonb DEFAULT '{}'::jsonb,
        "event_start" timestamp with time zone,
        "model_version" text DEFAULT 'v1' NOT NULL,
        "scoring_version" text DEFAULT 'v1' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "validation_metrics" (
        "id" serial PRIMARY KEY NOT NULL,
        "run_date" date NOT NULL,
        "league" text,
        "market" text,
        "window_days" integer NOT NULL,
        "total_picks" integer DEFAULT 0 NOT NULL,
        "wins" integer DEFAULT 0 NOT NULL,
        "losses" integer DEFAULT 0 NOT NULL,
        "pushes" integer DEFAULT 0 NOT NULL,
        "roi" numeric DEFAULT '0' NOT NULL,
        "win_rate" numeric DEFAULT '0' NOT NULL,
        "units_won" numeric DEFAULT '0' NOT NULL,
        "max_drawdown" numeric DEFAULT '0' NOT NULL,
        "avg_ev" numeric DEFAULT '0' NOT NULL,
        "avg_edge" numeric DEFAULT '0' NOT NULL,
        "clv_hit_rate" numeric DEFAULT '0' NOT NULL,
        "avg_clv" numeric DEFAULT '0' NOT NULL,
        "brier_score" numeric DEFAULT '0' NOT NULL,
        "log_loss" numeric DEFAULT '0' NOT NULL,
        "pass_rate" numeric DEFAULT '0' NOT NULL,
        "picks_per_day" numeric DEFAULT '0' NOT NULL,
        "model_version" text DEFAULT 'v1' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "simulation_runs" (
        "id" serial PRIMARY KEY NOT NULL,
        "run_id" text NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "days" integer DEFAULT 45 NOT NULL,
        "leagues" text[] NOT NULL,
        "markets" text[] NOT NULL,
        "model_version" text DEFAULT 'v1' NOT NULL,
        "scoring_version" text DEFAULT 'v1' NOT NULL,
        "calibration_version" text DEFAULT 'v1' NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "total_picks" integer,
        "picks_per_day" numeric,
        "roi" numeric,
        "win_rate" numeric,
        "units_won" numeric,
        "avg_ev" numeric,
        "avg_edge" numeric,
        "avg_clv" numeric,
        "clv_hit_rate" numeric,
        "max_drawdown" numeric,
        "results" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "completed_at" timestamp with time zone,
        CONSTRAINT "simulation_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
        "id" text PRIMARY KEY NOT NULL,
        "clerk_user_id" text NOT NULL,
        "email" text,
        "stripe_customer_id" text,
        "stripe_subscription_id" text,
        "tier" "user_tier" DEFAULT 'free' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_snapshots_date_idx" ON "game_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_snapshots_league_idx" ON "game_snapshots" USING btree ("league");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_snapshots_status_idx" ON "game_snapshots" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_bets_date_idx" ON "candidate_bets" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_bets_league_market_idx" ON "candidate_bets" USING btree ("league","market_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_bets_tier_idx" ON "candidate_bets" USING btree ("tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_bets_game_key_idx" ON "candidate_bets" USING btree ("game_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scored_picks_unique_pick_idx" ON "scored_picks" USING btree ("date","game_key","market","pick");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scored_picks_date_idx" ON "scored_picks" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scored_picks_league_idx" ON "scored_picks" USING btree ("league");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scored_picks_market_idx" ON "scored_picks" USING btree ("market");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scored_picks_tier_idx" ON "scored_picks" USING btree ("tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scored_picks_result_idx" ON "scored_picks" USING btree ("result");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scored_picks_game_key_idx" ON "scored_picks" USING btree ("game_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_metrics_date_idx" ON "validation_metrics" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_metrics_league_market_idx" ON "validation_metrics" USING btree ("league","market");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_metrics_window_idx" ON "validation_metrics" USING btree ("window_days");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_runs_status_idx" ON "simulation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_runs_run_id_idx" ON "simulation_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simulation_runs_created_idx" ON "simulation_runs" USING btree ("created_at");
