import { and, gte, ne, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { PUBLIC_TRACK_RECORD_CUTOFFS } from "../config/scoringModelConfig";

/**
 * Build a WHERE condition that excludes pre-fix contaminated rows from a
 * date-keyed table. For each league with a cutoff in
 * PUBLIC_TRACK_RECORD_CUTOFFS, rows must have date >= cutoff. Leagues
 * without a cutoff are unaffected. Rows whose league is unknown to the
 * cutoff map are also unaffected.
 *
 * Implemented as: NOT (league = X AND date < cutoffX) for each cutoff,
 * AND-ed together. This preserves all non-contaminated history while
 * deterministically excluding only the pre-fix portion of each league.
 *
 * Returns null if no cutoffs are configured (no filter needed).
 *
 * Hoisted out of routes/performance.ts so non-performance read endpoints
 * (notably routes/picks.ts) can apply the same exclusion without taking
 * a cross-route import. Single source of truth for the public read filter.
 */
export function buildPreFixExclusionCondition(
  leagueCol: AnyPgColumn,
  dateCol: AnyPgColumn,
): SQL | null {
  const clauses: SQL[] = [];
  for (const [league, cutoff] of Object.entries(PUBLIC_TRACK_RECORD_CUTOFFS)) {
    if (!cutoff) continue;
    // NOT (league = X AND date < cutoff) === (league != X OR date >= cutoff)
    const c = or(ne(leagueCol, league), gte(dateCol, cutoff));
    if (c) clauses.push(c);
  }
  if (clauses.length === 0) return null;
  return and(...clauses) ?? null;
}
