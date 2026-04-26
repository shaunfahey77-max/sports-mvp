import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  integer,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Idempotency / audit table for the nightly Model-Watch alert check.
 *
 * The cron job aggregates `model_watch_results` and, when a (league,
 * market) bucket clears the configured promotion thresholds (resolved
 * sample size, ROI, mean CLV), it records a row here and emits a
 * notification log line. The unique index on (league, market) is what
 * makes re-firing idempotent: once a market has earned its alert, the
 * nightly job will see the existing row and skip the notification.
 *
 * Operationally, deleting a row here will let the alert fire again on
 * the next eligible nightly run — useful after thresholds are re-tuned
 * or a market is intentionally re-evaluated.
 *
 * `metrics` and `thresholds` snapshot the values that earned the alert
 * so the audit trail does not drift if the config or aggregation logic
 * changes later.
 */
export const modelWatchAlertsTable = pgTable(
  "model_watch_alerts",
  {
    id: serial("id").primaryKey(),
    league: text("league").notNull(),
    market: text("market").notNull(),
    firstFiredAt: timestamp("first_fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedSamples: integer("resolved_samples").notNull(),
    roi: numeric("roi").notNull(),
    avgClv: numeric("avg_clv").notNull(),
    winRate: numeric("win_rate").notNull(),
    metrics: jsonb("metrics").notNull(),
    thresholds: jsonb("thresholds").notNull(),
  },
  (t) => [
    uniqueIndex("model_watch_alerts_league_market_unique_idx").on(
      t.league,
      t.market
    ),
  ]
);

export const insertModelWatchAlertSchema = createInsertSchema(
  modelWatchAlertsTable
).omit({ id: true, firstFiredAt: true });
export type InsertModelWatchAlert = z.infer<typeof insertModelWatchAlertSchema>;
export type ModelWatchAlert = typeof modelWatchAlertsTable.$inferSelect;
