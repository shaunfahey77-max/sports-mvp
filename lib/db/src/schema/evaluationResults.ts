import {
  pgTable,
  text,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Unified evaluation surface for every scored candidate that reaches a
 * settlement path, regardless of whether it was rendered as an Official pick,
 * shown on Model Watch, or fully suppressed from user surfaces.
 *
 * This table is the rebuild replacement for the legacy split between
 * scored_picks and model_watch_results. During the transition those tables stay
 * read-only for historical comparability while new evaluation work migrates
 * here.
 */
export const evaluationResultsTable = pgTable(
  "evaluation_results",
  {
    date: date("date").notNull(),
    gameKey: text("game_key").notNull(),
    league: text("league").notNull(),
    market: text("market").notNull(),
    pick: text("pick").notNull(),
    publishOdds: numeric("publish_odds").notNull(),
    publishLine: numeric("publish_line"),
    modelProbRaw: numeric("model_prob_raw").notNull(),
    modelProbCalibrated: numeric("model_prob_calibrated").notNull(),
    marketProbFair: numeric("market_prob_fair").notNull(),
    edge: numeric("edge").notNull(),
    ev: numeric("ev").notNull(),
    rankScore: numeric("rank_score").notNull(),
    tier: text("tier").notNull(),
    marketQuality: numeric("market_quality").notNull(),
    calibrationConfidence: numeric("calibration_confidence")
      .notNull()
      .default("1"),
    result: text("result").notNull().default("pending"),
    closeOdds: numeric("close_odds"),
    closeLine: numeric("close_line"),
    clvImpliedDelta: numeric("clv_implied_delta"),
    clvLineDelta: numeric("clv_line_delta"),
    surfaceStatus: text("surface_status").notNull(),
    modelVersion: text("model_version").notNull().default("v1"),
    calibrationVersion: text("calibration_version").notNull().default("v1"),
    scoringVersion: text("scoring_version").notNull().default("v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("evaluation_results_unique_pick_idx").on(
      t.date,
      t.gameKey,
      t.market,
      t.pick,
    ),
    index("evaluation_results_date_idx").on(t.date),
    index("evaluation_results_league_market_idx").on(t.league, t.market),
    index("evaluation_results_tier_idx").on(t.tier),
    index("evaluation_results_surface_status_idx").on(t.surfaceStatus),
    index("evaluation_results_result_idx").on(t.result),
    index("evaluation_results_game_key_idx").on(t.gameKey),
  ],
);

export const insertEvaluationResultSchema = createInsertSchema(
  evaluationResultsTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertEvaluationResult = z.infer<
  typeof insertEvaluationResultSchema
>;
export type EvaluationResult = typeof evaluationResultsTable.$inferSelect;
