CREATE TABLE "market_registry" (
  "league" text NOT NULL,
  "market" text NOT NULL,
  "model_version" text NOT NULL,
  "calibration_version" text NOT NULL,
  "surface_status" text NOT NULL,
  "close_capture_required_coverage" numeric NOT NULL DEFAULT '0.8',
  "observed_close_coverage_30d" numeric NOT NULL DEFAULT '0',
  "eligible" boolean NOT NULL DEFAULT false,
  "promoted_to_official_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "market_registry_unique_idx" UNIQUE("league", "market")
);

CREATE INDEX "market_registry_surface_status_idx" ON "market_registry" USING btree ("surface_status");
CREATE INDEX "market_registry_eligible_idx" ON "market_registry" USING btree ("eligible");
