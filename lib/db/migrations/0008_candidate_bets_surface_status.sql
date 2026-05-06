ALTER TABLE "candidate_bets"
ADD COLUMN "surface_status" text;

UPDATE "candidate_bets"
SET "surface_status" = CASE
  WHEN "selection_reason" = 'model_watch_only' THEN 'model_watch'
  WHEN "selection_reason" = 'market_disabled' THEN 'suppressed'
  ELSE 'shadow'
END
WHERE "surface_status" IS NULL;

ALTER TABLE "candidate_bets"
ALTER COLUMN "surface_status" SET DEFAULT 'shadow';

ALTER TABLE "candidate_bets"
ALTER COLUMN "surface_status" SET NOT NULL;

CREATE INDEX "candidate_bets_surface_status_idx"
ON "candidate_bets" USING btree ("surface_status");
