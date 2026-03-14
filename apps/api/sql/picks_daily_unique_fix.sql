-- Inspect current indexes/constraints first
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'picks_daily'
ORDER BY indexname;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'picks_daily'::regclass
ORDER BY conname;

-- Remove old game-level uniqueness
ALTER TABLE picks_daily DROP CONSTRAINT IF EXISTS picks_daily_unique_game;
DROP INDEX IF EXISTS picks_daily_unique_game;
DROP INDEX IF EXISTS picks_daily_date_league_game_key_key;

-- Add correct market-level uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS picks_daily_unique_game_market
ON picks_daily (date, league, game_key, market);

-- Verify
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'picks_daily'
ORDER BY indexname;
