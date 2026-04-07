import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  date,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scoredPicksTable = pgTable(
  "scored_picks",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    gameKey: text("game_key").notNull(),
    league: text("league").notNull(),
    market: text("market").notNull(),
    pick: text("pick").notNull(),
    result: text("result").notNull().default("pending"),
    publishOdds: numeric("publish_odds").notNull(),
    publishLine: numeric("publish_line"),
    closeOdds: numeric("close_odds"),
    closeLine: numeric("close_line"),
    modelProbRaw: numeric("model_prob_raw").notNull(),
    modelProbCalibrated: numeric("model_prob_calibrated").notNull(),
    marketProbFair: numeric("market_prob_fair").notNull(),
    edge: numeric("edge").notNull(),
    ev: numeric("ev").notNull(),
    rankScore: numeric("rank_score").notNull(),
    tier: text("tier").notNull(),
    clvLineDelta: numeric("clv_line_delta"),
    clvImpliedDelta: numeric("clv_implied_delta"),
    meta: jsonb("meta").default({}),
    modelVersion: text("model_version").notNull().default("v1"),
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
    index("scored_picks_date_idx").on(t.date),
    index("scored_picks_league_idx").on(t.league),
    index("scored_picks_market_idx").on(t.market),
    index("scored_picks_tier_idx").on(t.tier),
    index("scored_picks_result_idx").on(t.result),
    index("scored_picks_game_key_idx").on(t.gameKey),
  ]
);

export const insertScoredPickSchema = createInsertSchema(
  scoredPicksTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScoredPick = z.infer<typeof insertScoredPickSchema>;
export type ScoredPick = typeof scoredPicksTable.$inferSelect;
