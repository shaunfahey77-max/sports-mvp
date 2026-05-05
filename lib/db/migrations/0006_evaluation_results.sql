CREATE TABLE "evaluation_results" (
  "date" date NOT NULL,
  "game_key" text NOT NULL,
  "league" text NOT NULL,
  "market" text NOT NULL,
  "pick" text NOT NULL,
  "publish_odds" numeric NOT NULL,
  "publish_line" numeric,
  "model_prob_raw" numeric NOT NULL,
  "model_prob_calibrated" numeric NOT NULL,
  "market_prob_fair" numeric NOT NULL,
  "edge" numeric NOT NULL,
  "ev" numeric NOT NULL,
  "rank_score" numeric NOT NULL,
  "tier" text NOT NULL,
  "market_quality" numeric NOT NULL,
  "calibration_confidence" numeric NOT NULL DEFAULT '1',
  "result" text NOT NULL DEFAULT 'pending',
  "close_odds" numeric,
  "close_line" numeric,
  "clv_implied_delta" numeric,
  "clv_line_delta" numeric,
  "surface_status" text NOT NULL,
  "model_version" text NOT NULL DEFAULT 'v1',
  "calibration_version" text NOT NULL DEFAULT 'v1',
  "scoring_version" text NOT NULL DEFAULT 'v1',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "evaluation_results_unique_pick_idx" UNIQUE("date", "game_key", "market", "pick")
);

CREATE INDEX "evaluation_results_date_idx" ON "evaluation_results" USING btree ("date");
CREATE INDEX "evaluation_results_league_market_idx" ON "evaluation_results" USING btree ("league", "market");
CREATE INDEX "evaluation_results_tier_idx" ON "evaluation_results" USING btree ("tier");
CREATE INDEX "evaluation_results_surface_status_idx" ON "evaluation_results" USING btree ("surface_status");
CREATE INDEX "evaluation_results_result_idx" ON "evaluation_results" USING btree ("result");
CREATE INDEX "evaluation_results_game_key_idx" ON "evaluation_results" USING btree ("game_key");
