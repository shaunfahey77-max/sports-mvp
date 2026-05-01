import { test } from "node:test";
import assert from "node:assert/strict";
import { pgTable, text, timestamp, PgDialect } from "drizzle-orm/pg-core";
import {
  buildPlausibleEventStartCondition,
  isPlausibleEventStart,
  PLAUSIBLE_EVENT_START_WINDOWS,
} from "../plausibleEventStart";

// ===========================================================================
// Per-league plausible commence-time windows
// ===========================================================================
// Pinned by the NHL phantom-row bug: a `nhl_2026-05-01_phi_car` snapshot
// with `commence_time = 2026-05-01 15:00:00+00` (= 11:00 AM ET) was
// being surfaced on Today's Picks even though NHL never starts a game
// at 11:00 AM ET. The fix: reject snapshots whose `eventStart` projected
// to America/New_York hour falls outside the league's plausible window.
//
// These tests pin:
//   - The exact NHL bug case rejects (15:00 UTC May 1 = 11:00 AM ET).
//   - Real observed NHL start times accept (7:00 PM ET, late west-coast
//     ~10:00 PM ET start).
//   - Boundary hours of the [12, 23] inclusive window behave correctly
//     (12:00 ET in, 11:00 ET out, 23:59 ET in, 00:00 ET out).
//   - DST handling is correct around the spring-forward / fall-back
//     transitions: a UTC instant that maps to "in window" before/after
//     DST must continue to map to the same ET hour, so the rule is not
//     accidentally hour-shifted by a DST offset bug.
//   - Unregistered leagues default-allow (the helper is opt-in per
//     league, mirroring the registry contract).
//   - Garbage-in returns false rather than throwing (defensive).
// ===========================================================================

test("registry exposes NHL with the documented [12, 23] window", () => {
  const nhl = PLAUSIBLE_EVENT_START_WINDOWS.nhl;
  assert.ok(nhl, "NHL must be in the registry");
  assert.equal(nhl.minHourEt, 12);
  assert.equal(nhl.maxHourEt, 23);
});

test("NHL: rejects the documented phantom — 2026-05-01 15:00 UTC = 11:00 AM ET", () => {
  // The exact production phantom row: `nhl_2026-05-01_phi_car`,
  // commence_time `2026-05-01 15:00:00+00`. May 1 is in EDT (UTC-4),
  // so 15:00 UTC = 11:00 AM ET — outside the NHL [12, 23] window.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-05-01T15:00:00Z"),
    false,
    "11:00 AM ET NHL start must be rejected (the documented phantom)",
  );
});

test("NHL: accepts a real evening start — 2026-05-01 23:00 UTC = 7:00 PM ET", () => {
  // The real BUF @ BOS row from the same slate: 23:00 UTC = 7:00 PM ET.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-05-01T23:00:00Z"),
    true,
  );
});

test("NHL: accepts a real late west-coast start — 2026-05-02 02:10 UTC = 10:10 PM ET on May 1", () => {
  // The real VGK @ UTA row from the same slate: commence_time is
  // already on the next UTC day but ET-buckets to May 1 night.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-05-02T02:10:00Z"),
    true,
  );
});

test("NHL: boundary — 12:00 ET (window minimum) accepts", () => {
  // Apr 25, 2026 is in EDT (UTC-4). 12:00 ET = 16:00 UTC.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-04-25T16:00:00Z"),
    true,
  );
});

test("NHL: boundary — 11:00 ET (one hour below window) rejects", () => {
  // 11:00 ET in EDT = 15:00 UTC.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-04-25T15:00:00Z"),
    false,
  );
});

test("NHL: boundary — 23:59 ET (within hour 23, window maximum) accepts", () => {
  // 23:59 ET in EDT = 03:59 UTC next day. Hour-portion in ET = 23.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-04-26T03:59:00Z"),
    true,
  );
});

test("NHL: boundary — 00:00 ET (hour 0, just past window) rejects", () => {
  // 00:00 ET in EDT = 04:00 UTC same calendar day next.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-04-26T04:00:00Z"),
    false,
  );
});

test("NHL: DST safety — 7:00 PM ET in EST (Feb) accepts (UTC-5 offset)", () => {
  // Feb 14, 2026 is in EST (UTC-5). 7:00 PM ET = 00:00 UTC the next day.
  // If the helper were to use a fixed UTC-4 offset (DST bug), this
  // would compute as 8:00 PM ET — still in window — but would silently
  // misalign for a row at the boundary. We assert acceptance here and
  // the boundary rejection below pins the actual DST behavior.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-02-15T00:00:00Z"),
    true,
  );
});

test("NHL: DST safety — 11:00 AM ET in EST (Feb) rejects, same UTC offset shift caught", () => {
  // Feb 14, 2026 (EST, UTC-5): 11:00 AM ET = 16:00 UTC. With the
  // correct EST offset the ET hour computes as 11 → reject. With a
  // hard-coded UTC-4 (always EDT) bug, the ET hour would compute as
  // 12 → accept (false negative on the DST boundary).
  assert.equal(
    isPlausibleEventStart("nhl", "2026-02-14T16:00:00Z"),
    false,
  );
});

test("NHL: DST safety — 11:00 AM ET in EDT (May) rejects with correct EDT offset", () => {
  // May 1, 2026 (EDT, UTC-4): 11:00 AM ET = 15:00 UTC. ET hour = 11.
  assert.equal(
    isPlausibleEventStart("nhl", "2026-05-01T15:00:00Z"),
    false,
  );
});

test("unregistered league default-allows — MLB has no entry yet", () => {
  // The bug is NHL-only and the registry is intentionally opt-in. MLB
  // starts (e.g. 1:05 PM ET noon games, 7:05 PM ET evening) must NOT
  // be filtered until an MLB window is added with a fixture survey.
  assert.equal(
    isPlausibleEventStart("mlb", "2026-05-01T17:05:00Z"),
    true,
  );
  // Even an obviously-implausible MLB time defaults true while the
  // league is not registered. This is by design — see the registry
  // doc-comment.
  assert.equal(
    isPlausibleEventStart("mlb", "2026-05-01T03:00:00Z"),
    true,
  );
});

test("unregistered league default-allows — NBA has no entry yet either", () => {
  assert.equal(
    isPlausibleEventStart("nba", "2026-05-01T17:00:00Z"),
    true,
  );
});

test("garbage input — invalid date string returns false (defensive)", () => {
  assert.equal(
    isPlausibleEventStart("nhl", "not-a-date"),
    false,
  );
});

test("Date instance input — accepts a valid Date object", () => {
  const date = new Date("2026-05-01T23:00:00Z"); // 7:00 PM ET
  assert.equal(isPlausibleEventStart("nhl", date), true);
});

test("Date instance input — rejects an invalid Date object", () => {
  const date = new Date("invalid");
  assert.equal(isPlausibleEventStart("nhl", date), false);
});

// ===========================================================================
// SQL builder contract
// ===========================================================================
// `buildPlausibleEventStartCondition` is the read-side defense used in
// /picks and /picks/candidates. It must:
//   - return a defined SQL fragment whenever the registry is non-empty,
//   - reference every registered league as a bound parameter,
//   - bind the per-league min/max hours,
//   - project event_start to America/New_York via `AT TIME ZONE ...`,
//   - extract HOUR from the projected timestamp (not from raw UTC),
//   - allow NULL eventStart through (scoredPicksTable.eventStart is
//     nullable; without IS NULL passthrough, `BETWEEN` short-circuits
//     to NULL → row silently dropped).
//
// Rather than spin up a real DB connection, we render the SQL against
// a throwaway pgTable using PgDialect.sqlToQuery() — this catches
// regressions in the generated SQL shape (column refs, params,
// time-zone string, IS NULL handling) without needing any infra.
// ===========================================================================

const fakeCandidatesTable = pgTable("fake_candidates", {
  league: text("league").notNull(),
  eventStart: timestamp("event_start", { withTimezone: true }),
});

test("SQL builder: returns a defined SQL fragment when the registry is non-empty", () => {
  const cond = buildPlausibleEventStartCondition(
    fakeCandidatesTable.league,
    fakeCandidatesTable.eventStart,
  );
  assert.ok(cond, "must return a defined SQL when registry is non-empty");
});

test("SQL builder: emits ET projection, HOUR extraction, IS NULL passthrough, and column refs", () => {
  const dialect = new PgDialect();
  const cond = buildPlausibleEventStartCondition(
    fakeCandidatesTable.league,
    fakeCandidatesTable.eventStart,
  );
  const { sql: sqlStr } = dialect.sqlToQuery(cond!);

  // ET projection — wrong tz here (e.g. accidental UTC) would silently
  // mis-classify every NHL game.
  assert.match(
    sqlStr,
    /at time zone 'America\/New_York'/i,
    "must project event_start to America/New_York",
  );
  // HOUR extraction must be from the ET-projected timestamp, not raw UTC.
  assert.match(
    sqlStr,
    /extract\(hour from/i,
    "must extract HOUR from the ET-projected timestamp",
  );
  // NULL passthrough — without this, a NULL eventStart short-circuits
  // BETWEEN to NULL and the row is silently dropped.
  assert.match(sqlStr, /is null/i, "must allow NULL eventStart through");
  // Column references must be the supplied columns (proves we didn't
  // hardcode column names internally).
  assert.match(sqlStr, /"fake_candidates"\."league"/);
  assert.match(sqlStr, /"fake_candidates"\."event_start"/);
});

test("SQL builder: binds every registered league and its hour bounds as parameters", () => {
  const dialect = new PgDialect();
  const cond = buildPlausibleEventStartCondition(
    fakeCandidatesTable.league,
    fakeCandidatesTable.eventStart,
  );
  const { params } = dialect.sqlToQuery(cond!);

  for (const [league, w] of Object.entries(PLAUSIBLE_EVENT_START_WINDOWS)) {
    assert.ok(
      params.includes(league),
      `bound params must include the registered league '${league}'`,
    );
    assert.ok(
      params.includes(w.minHourEt),
      `bound params must include minHourEt=${w.minHourEt} for '${league}'`,
    );
    assert.ok(
      params.includes(w.maxHourEt),
      `bound params must include maxHourEt=${w.maxHourEt} for '${league}'`,
    );
  }
});
