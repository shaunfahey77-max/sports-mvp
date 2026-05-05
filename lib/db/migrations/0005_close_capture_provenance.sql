ALTER TABLE "game_snapshots"
  ADD COLUMN "close_captured_at" timestamp with time zone,
  ADD COLUMN "close_source" text;

CREATE INDEX "game_snapshots_close_captured_at_idx"
  ON "game_snapshots" ("close_captured_at");
