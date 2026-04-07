import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  integer,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const simulationRunsTable = pgTable(
  "simulation_runs",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().unique(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: integer("days").notNull().default(45),
    leagues: text("leagues").array().notNull(),
    markets: text("markets").array().notNull(),
    modelVersion: text("model_version").notNull().default("v1"),
    scoringVersion: text("scoring_version").notNull().default("v1"),
    calibrationVersion: text("calibration_version").notNull().default("v1"),
    status: text("status").notNull().default("pending"),
    totalPicks: integer("total_picks"),
    picksPerDay: numeric("picks_per_day"),
    roi: numeric("roi"),
    winRate: numeric("win_rate"),
    unitsWon: numeric("units_won"),
    avgEv: numeric("avg_ev"),
    avgEdge: numeric("avg_edge"),
    avgClv: numeric("avg_clv"),
    clvHitRate: numeric("clv_hit_rate"),
    maxDrawdown: numeric("max_drawdown"),
    results: jsonb("results"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("simulation_runs_status_idx").on(t.status),
    index("simulation_runs_run_id_idx").on(t.runId),
    index("simulation_runs_created_idx").on(t.createdAt),
  ]
);

export const insertSimulationRunSchema = createInsertSchema(
  simulationRunsTable
).omit({ id: true, createdAt: true });
export type InsertSimulationRun = z.infer<typeof insertSimulationRunSchema>;
export type SimulationRun = typeof simulationRunsTable.$inferSelect;
