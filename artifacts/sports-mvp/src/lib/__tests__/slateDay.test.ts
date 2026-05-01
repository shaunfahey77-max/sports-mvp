import { test } from "node:test";
import assert from "node:assert/strict";
import { getSlateDayET } from "../slateDay";

/**
 * Pin the ET-boundary contract for the slate-day helper.
 *
 * The whole point of this helper is to keep the dashboard's "today"
 * aligned with the ET calendar bucket the server uses. The most
 * regression-prone moments are the hours straddling ET midnight,
 * where a browser-local-tz computation would silently roll over a
 * day early or late. Pin those boundaries explicitly.
 */

// ─── Eastern Daylight Time (EDT = UTC−4) — typical April–November ──

test("getSlateDayET: 03:59 UTC = 23:59 ET prior day (EDT) → returns prior day", () => {
  // 2026-05-02T03:59 UTC is 2026-05-01T23:59 in EDT.
  assert.equal(
    getSlateDayET(new Date("2026-05-02T03:59:00Z")),
    "2026-05-01",
    "must NOT have rolled over yet — ET is still the prior day",
  );
});

test("getSlateDayET: 04:00 UTC = 00:00 ET (EDT) → rolls to new day", () => {
  // 2026-05-02T04:00 UTC is 2026-05-02T00:00 in EDT — the new ET day begins.
  assert.equal(
    getSlateDayET(new Date("2026-05-02T04:00:00Z")),
    "2026-05-02",
    "ET midnight has just hit — slate day must roll over",
  );
});

test("getSlateDayET: mid-afternoon UTC stays on the same calendar day in ET (EDT)", () => {
  // 2026-05-01T18:00 UTC = 2026-05-01T14:00 EDT — clearly the same day.
  assert.equal(
    getSlateDayET(new Date("2026-05-01T18:00:00Z")),
    "2026-05-01",
  );
});

// ─── Eastern Standard Time (EST = UTC−5) — typical November–March ──

test("getSlateDayET: 04:59 UTC = 23:59 ET prior day (EST) → returns prior day", () => {
  // January is EST. 2026-01-15T04:59 UTC = 2026-01-14T23:59 EST.
  assert.equal(
    getSlateDayET(new Date("2026-01-15T04:59:00Z")),
    "2026-01-14",
    "EST boundary: must not roll over until 05:00 UTC",
  );
});

test("getSlateDayET: 05:00 UTC = 00:00 ET (EST) → rolls to new day", () => {
  assert.equal(
    getSlateDayET(new Date("2026-01-15T05:00:00Z")),
    "2026-01-15",
    "EST boundary: rolls over at 05:00 UTC, not 04:00",
  );
});

// ─── Default-arg sanity ───────────────────────────────────────────

test("getSlateDayET: default arg returns a valid YYYY-MM-DD string", () => {
  const result = getSlateDayET();
  assert.match(
    result,
    /^\d{4}-\d{2}-\d{2}$/,
    `expected YYYY-MM-DD, got ${JSON.stringify(result)}`,
  );
});

test("getSlateDayET: format matches what the server's transformGame() emits ('en-CA' YYYY-MM-DD)", () => {
  // Belt-and-suspenders: the server uses the exact same Intl call
  // (`'en-CA'`, `timeZone: 'America/New_York'`). Re-derive here and
  // confirm the helper is byte-equal so a future refactor of the
  // helper that breaks the contract — e.g. switching to a US-style
  // `M/d/yyyy` locale — is caught immediately.
  const sample = new Date("2026-07-04T15:00:00Z");
  const expected = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(sample);
  assert.equal(getSlateDayET(sample), expected);
});
