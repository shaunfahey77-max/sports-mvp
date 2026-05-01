import {
  and,
  eq,
  notInArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

/**
 * Per-league plausible commence-time windows in America/New_York local hours.
 *
 * Background — Today's Picks phantom-row bug:
 * On rare occasions an upstream Odds API ingest writes a `game_snapshots`
 * row whose `commence_time` is at an hour no real game in that league
 * ever starts (e.g. an NHL row with `commence_time = 15:00 UTC` =
 * 11:00 AM ET — NHL never starts a game that early). The row then
 * propagates into `candidate_bets` and onto the public Today's Picks
 * board even though no such game is on tonight's actual slate. The
 * production trace was `nhl_2026-05-01_phi_car`, snapshot id 35681,
 * commence_time `2026-05-01 15:00:00+00`, which displaced the real
 * VGK @ UTA card from the Member Model Watch board.
 *
 * This helper defines a per-league inclusive ET hour window. Snapshots
 * whose `commence_time` projected to America/New_York local hour falls
 * outside the league's window are:
 *   - rejected at ingest in `transformGame` (no new phantom rows enter
 *     `game_snapshots` going forward);
 *   - excluded from the public read endpoints `/picks` and
 *     `/picks/candidates` (existing phantom rows already in the DB are
 *     hidden from the dashboard without requiring a destructive
 *     backfill).
 *
 * Windows are intentionally conservative — wider than every real start
 * time observed in the per-league fixtures, and tight enough only to
 * catch the documented 11:00 AM ET NHL phantom. Leagues NOT in the
 * registry are not validated (the helper returns `true` / no SQL
 * filter is added), so this change is strictly opt-in per league. Any
 * future per-league window must be backed by a fixture survey before
 * being added here, to avoid silently dropping legitimate games.
 *
 * Out of scope (intentionally NOT addressed by this helper):
 *   - Cross-league rank-score normalization on the Member board. That
 *     is a separate product/ranking decision, tracked separately.
 */
export interface PlausibleEventStartWindow {
  /** Inclusive earliest plausible local hour ET (0–23). */
  minHourEt: number;
  /** Inclusive latest plausible local hour ET (0–23). */
  maxHourEt: number;
}

export const PLAUSIBLE_EVENT_START_WINDOWS: Readonly<
  Record<string, PlausibleEventStartWindow>
> = {
  // NHL: real start times observed in the historical fixtures range
  // from ~12:30 PM ET (rare Sunday matinees) to ~10:30 PM ET (latest
  // west-coast late games). Window [12, 23] inclusive is wider than
  // every observed real start (so no real game is rejected) and tight
  // enough to reject the 11:00 AM ET phantom that triggered this bug.
  nhl: { minHourEt: 12, maxHourEt: 23 },
};

/**
 * Pure boolean check: is `eventStart`'s ET local hour inside the
 * league's plausible window?
 *
 *   - Returns `true` if the league is not in the registry
 *     (default-allow — change is opt-in per league).
 *   - Returns `false` if `eventStart` does not parse as a valid Date.
 */
export function isPlausibleEventStart(
  league: string,
  eventStart: Date | string | number,
): boolean {
  const window = PLAUSIBLE_EVENT_START_WINDOWS[league];
  if (!window) return true;

  const date =
    eventStart instanceof Date ? eventStart : new Date(eventStart);
  if (Number.isNaN(date.getTime())) return false;

  // Use Intl with hourCycle 'h23' so we always get a 0–23 hour string,
  // independent of the host's locale. The 'America/New_York' timezone
  // applies the correct EDT/EST offset for the date in question (no
  // DST drift, since Intl resolves the offset per date).
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
  }).format(date);
  const hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return false;

  return hour >= window.minHourEt && hour <= window.maxHourEt;
}

/**
 * Build a drizzle SQL condition admitting a row only when its
 * `(league, eventStart)` pair satisfies its plausible window. Rows
 * whose `league` is not in the registry are admitted unconditionally.
 * Rows whose `eventStart` is NULL are also admitted (no time data
 * means we cannot evaluate plausibility — conservative default).
 *
 * Returns `undefined` if the registry is empty (no rules → no filter
 * to add).
 */
export function buildPlausibleEventStartCondition(
  leagueCol: AnyColumn,
  eventStartCol: AnyColumn,
): SQL | undefined {
  const entries = Object.entries(PLAUSIBLE_EVENT_START_WINDOWS);
  if (entries.length === 0) return undefined;

  const registeredLeagues = entries.map(([k]) => k);
  // Non-registered leagues bypass the filter entirely. This keeps the
  // change strictly opt-in per league — adding NBA / MLB later only
  // requires populating the registry, no route changes.
  const unregisteredAllow = notInArray(leagueCol, registeredLeagues);

  const perLeagueAllow = entries.map(
    ([league, w]) =>
      and(
        eq(leagueCol, league),
        // Allow NULL eventStart through (scoredPicksTable.eventStart is
        // nullable). Without this, NULL would short-circuit to NULL in
        // the BETWEEN comparison and the row would be silently dropped.
        sql`(${eventStartCol} IS NULL OR EXTRACT(HOUR FROM (${eventStartCol} AT TIME ZONE 'America/New_York')) BETWEEN ${w.minHourEt} AND ${w.maxHourEt})`,
      )!,
  );

  return or(unregisteredAllow, ...perLeagueAllow);
}
