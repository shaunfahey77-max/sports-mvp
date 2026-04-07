import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  integer,
  date,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const validationMetricsTable = pgTable(
  "validation_metrics",
  {
    id: serial("id").primaryKey(),
    runDate: date("run_date").notNull(),
    league: text("league"),
    market: text("market"),
    windowDays: integer("window_days").notNull(),
    totalPicks: integer("total_picks").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    pushes: integer("pushes").notNull().default(0),
    roi: numeric("roi").notNull().default("0"),
    winRate: numeric("win_rate").notNull().default("0"),
    unitsWon: numeric("units_won").notNull().default("0"),
    maxDrawdown: numeric("max_drawdown").notNull().default("0"),
    avgEv: numeric("avg_ev").notNull().default("0"),
    avgEdge: numeric("avg_edge").notNull().default("0"),
    clvHitRate: numeric("clv_hit_rate").notNull().default("0"),
    avgClv: numeric("avg_clv").notNull().default("0"),
    brierScore: numeric("brier_score").notNull().default("0"),
    logLoss: numeric("log_loss").notNull().default("0"),
    passRate: numeric("pass_rate").notNull().default("0"),
    picksPerDay: numeric("picks_per_day").notNull().default("0"),
    modelVersion: text("model_version").notNull().default("v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("validation_metrics_date_idx").on(t.runDate),
    index("validation_metrics_league_market_idx").on(t.league, t.market),
    index("validation_metrics_window_idx").on(t.windowDays),
  ]
);

export const insertValidationMetricSchema = createInsertSchema(
  validationMetricsTable
).omit({ id: true, createdAt: true });
export type InsertValidationMetric = z.infer<typeof insertValidationMetricSchema>;
export type ValidationMetric = typeof validationMetricsTable.$inferSelect;
