import {
  pgTable,
  text,
  numeric,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Registry-driven market control plane for the rebuild.
 *
 * This table is the durable source of truth for whether a given
 * (league, market) is in shadow, model_watch, official, or suppressed state.
 * The existing config-based gates remain in place during the transition; new
 * rebuild logic should progressively move to this registry instead of adding
 * more league/market-specific branches.
 */
export const marketRegistryTable = pgTable(
  "market_registry",
  {
    league: text("league").notNull(),
    market: text("market").notNull(),
    modelVersion: text("model_version").notNull(),
    calibrationVersion: text("calibration_version").notNull(),
    surfaceStatus: text("surface_status").notNull(),
    closeCaptureRequiredCoverage: numeric("close_capture_required_coverage")
      .notNull()
      .default("0.8"),
    observedCloseCoverage30d: numeric("observed_close_coverage_30d")
      .notNull()
      .default("0"),
    eligible: boolean("eligible").notNull().default(false),
    promotedToOfficialAt: timestamp("promoted_to_official_at", {
      withTimezone: true,
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("market_registry_unique_idx").on(t.league, t.market),
    index("market_registry_surface_status_idx").on(t.surfaceStatus),
    index("market_registry_eligible_idx").on(t.eligible),
  ],
);

export const insertMarketRegistrySchema = createInsertSchema(
  marketRegistryTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertMarketRegistry = z.infer<typeof insertMarketRegistrySchema>;
export type MarketRegistry = typeof marketRegistryTable.$inferSelect;
