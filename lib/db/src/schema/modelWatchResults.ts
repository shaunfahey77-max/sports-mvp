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

/**
 * Internal-only scoreboard for markets in MARKET_MODEL_WATCH_ONLY
 * (currently nhl_spread and mlb_moneyline). These markets surface only on
 * the dashboard's Model Watch slot and are intentionally excluded from
 * scored_picks / validation_metrics so they cannot leak into the public
 * Performance / History numbers. This table grades each Model-Watch
 * candidate as if it had been an Official pick so we can build settled
 * evidence over time and decide when to promote a market back to Official.
 *
 * Rows are written by the Model-Watch grader (see
 * artifacts/api-server/src/scoring/modelWatchGrader.ts) when a game
 * snapshot reaches `final` status, and also on demand via the admin
 * regrade endpoint. Values mirror scored_picks closely so the same
 * downstream math (americanToDecimal-based ROI, CLV deltas) applies.
 *
 * Public read surfaces (/picks, /performance, /performance/history) MUST
 * NOT read from this table. It is consumed only by the admin endpoint
 * /admin/model-watch/performance.
 */
export const modelWatchResultsTable = pgTable(
  "model_watch_results",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    gameKey: text("game_key").notNull(),
    league: text("league").notNull(),
    market: text("market").notNull(),
    pick: text("pick").notNull(),
    // Tier (A / B / C / PASS) re-derived by re-running assignTier on the
    // recorded inputs. Informational only — the grader writes a row for
    // every Model-Watch candidate's outcome regardless of tier (watch
    // markets sit below the per-market production edge floor by design,
    // so PASS is the common case here).
    tier: text("tier").notNull(),
    publishOdds: numeric("publish_odds").notNull(),
    publishLine: numeric("publish_line"),
    closeOdds: numeric("close_odds"),
    closeLine: numeric("close_line"),
    modelProbCalibrated: numeric("model_prob_calibrated").notNull(),
    edge: numeric("edge").notNull(),
    ev: numeric("ev").notNull(),
    rankScore: numeric("rank_score").notNull(),
    clvImpliedDelta: numeric("clv_implied_delta"),
    clvLineDelta: numeric("clv_line_delta"),
    result: text("result").notNull().default("pending"),
    eventStart: timestamp("event_start", { withTimezone: true }).notNull(),
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
    uniqueIndex("model_watch_results_unique_idx").on(
      t.date,
      t.gameKey,
      t.market,
      t.pick
    ),
    index("model_watch_results_league_market_idx").on(t.league, t.market),
    index("model_watch_results_date_idx").on(t.date),
    index("model_watch_results_result_idx").on(t.result),
  ]
);

export const insertModelWatchResultSchema = createInsertSchema(
  modelWatchResultsTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertModelWatchResult = z.infer<typeof insertModelWatchResultSchema>;
export type ModelWatchResult = typeof modelWatchResultsTable.$inferSelect;
