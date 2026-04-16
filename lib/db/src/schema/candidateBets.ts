import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const candidateBetsTable = pgTable(
  "candidate_bets",
  {
    id: serial("id").primaryKey(),
    gameKey: text("game_key").notNull(),
    league: text("league").notNull(),
    marketType: text("market_type").notNull(),
    side: text("side").notNull(),
    eventStart: timestamp("event_start", { withTimezone: true }).notNull(),
    publishOdds: numeric("publish_odds").notNull(),
    publishLine: numeric("publish_line"),
    modelProbRaw: numeric("model_prob_raw").notNull(),
    modelProbCalibrated: numeric("model_prob_calibrated").notNull(),
    marketProbFair: numeric("market_prob_fair").notNull(),
    edge: numeric("edge").notNull(),
    ev: numeric("ev").notNull(),
    rankScore: numeric("rank_score").notNull(),
    tier: text("tier").notNull(),
    calibrationMethod: text("calibration_method").notNull().default("none"),
    calibrationVersion: text("calibration_version").notNull().default("v1"),
    marketQuality: numeric("market_quality").notNull().default("1.0"),
    selectionReason: text("selection_reason"),
    snapshotDate: date("snapshot_date").notNull(),
    modelVersion: text("model_version").notNull().default("v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("candidate_bets_unique_candidate_idx").on(
      t.snapshotDate,
      t.gameKey,
      t.marketType,
      t.side
    ),
    index("candidate_bets_date_idx").on(t.snapshotDate),
    index("candidate_bets_league_market_idx").on(t.league, t.marketType),
    index("candidate_bets_tier_idx").on(t.tier),
    index("candidate_bets_game_key_idx").on(t.gameKey),
  ]
);

export const insertCandidateBetSchema = createInsertSchema(
  candidateBetsTable
).omit({ id: true, createdAt: true });
export type InsertCandidateBet = z.infer<typeof insertCandidateBetSchema>;
export type CandidateBet = typeof candidateBetsTable.$inferSelect;
