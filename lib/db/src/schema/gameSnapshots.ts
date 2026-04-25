import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
  date,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gameSnapshotsTable = pgTable(
  "game_snapshots",
  {
    id: serial("id").primaryKey(),
    gameKey: text("game_key").notNull().unique(),
    league: text("league").notNull(),
    eventStart: timestamp("event_start", { withTimezone: true }).notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    homePublishMl: numeric("home_publish_ml").notNull(),
    awayPublishMl: numeric("away_publish_ml").notNull(),
    homeCloseMl: numeric("home_close_ml"),
    awayCloseMl: numeric("away_close_ml"),
    publishSpread: numeric("publish_spread"),
    publishSpreadLine: numeric("publish_spread_line"),
    publishAwaySpreadLine: numeric("publish_away_spread_line"),
    closeSpread: numeric("close_spread"),
    closeSpreadLine: numeric("close_spread_line"),
    closeAwaySpreadLine: numeric("close_away_spread_line"),
    publishTotal: numeric("publish_total"),
    publishOverLine: numeric("publish_over_line"),
    publishUnderLine: numeric("publish_under_line"),
    closeTotal: numeric("close_total"),
    closeOverLine: numeric("close_over_line"),
    closeUnderLine: numeric("close_under_line"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    status: text("status").notNull().default("scheduled"),
    snapshotDate: date("snapshot_date").notNull(),
    // Per-side book provenance for the chosen lines. Nullable for back-compat
    // with rows captured before this column existed. Populated by transformGame
    // so post-hoc investigation of any future bad snapshot can identify which
    // book contributed which side without re-fetching historical odds.
    bestBooks: jsonb("best_books").$type<{
      moneylineHome?: string;
      moneylineAway?: string;
      spreadHome?: string;
      spreadAway?: string;
      totalOver?: string;
      totalUnder?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("game_snapshots_date_idx").on(t.snapshotDate),
    index("game_snapshots_league_idx").on(t.league),
    index("game_snapshots_status_idx").on(t.status),
  ]
);

export const insertGameSnapshotSchema = createInsertSchema(
  gameSnapshotsTable
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGameSnapshot = z.infer<typeof insertGameSnapshotSchema>;
export type GameSnapshot = typeof gameSnapshotsTable.$inferSelect;
