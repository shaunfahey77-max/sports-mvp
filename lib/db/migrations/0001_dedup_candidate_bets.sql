-- Migration 0001: Deduplicate candidate_bets and restore unique index.
--
-- The cron job that scores picks every 10 minutes was inserting duplicate rows
-- because the unique index never successfully existed in production (data was
-- already duplicated before the index could be created).
-- This migration:
--   1. Keeps only the highest-id row per (snapshot_date, game_key, market_type, side)
--   2. Creates the unique index so future upserts prevent duplicates
--
-- Safe to run on a clean database (no duplicates → no deletes, IF NOT EXISTS on index).

DELETE FROM candidate_bets
WHERE id NOT IN (
  SELECT MAX(id)
  FROM candidate_bets
  GROUP BY snapshot_date, game_key, market_type, side
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_bets_unique_candidate_idx"
  ON "candidate_bets" USING btree ("snapshot_date", "game_key", "market_type", "side");
