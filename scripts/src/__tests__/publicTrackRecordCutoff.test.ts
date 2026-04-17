/**
 * Pure-logic test for the public track-record cutoff filter. Mirrors the
 * SQL semantics of `buildPreFixExclusionCondition` in
 * artifacts/api-server/src/routes/performance.ts so we catch drift between
 * the config (PUBLIC_TRACK_RECORD_CUTOFFS) and the public read surface.
 *
 * NHL pre-fix cutoff = 2026-04-12: NHL rows BEFORE that date are excluded;
 * NHL on/after that date AND every NBA row of any date are included.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_TRACK_RECORD_CUTOFFS } from "../../../artifacts/api-server/src/config/scoringModelConfig";

function isPublicVisible(
  league: string,
  date: string,
  cutoffs: Partial<Record<string, string>> = PUBLIC_TRACK_RECORD_CUTOFFS,
): boolean {
  for (const [l, c] of Object.entries(cutoffs)) {
    if (!c) continue;
    if (league === l && date < c) return false;
  }
  return true;
}

test("cutoff config: NHL is set to 2026-04-12 (Task #4 fix landed 04-12)", () => {
  assert.equal(PUBLIC_TRACK_RECORD_CUTOFFS.nhl, "2026-04-12");
});

test("public visibility: NHL rows BEFORE 2026-04-12 are hidden from the public surface", () => {
  assert.equal(isPublicVisible("nhl", "2026-04-10"), false);
  assert.equal(isPublicVisible("nhl", "2026-04-11"), false); // the contaminated +21.56u day
  assert.equal(isPublicVisible("nhl", "2026-01-01"), false);
});

test("public visibility: NHL rows ON OR AFTER 2026-04-12 are visible (clean post-fix)", () => {
  assert.equal(isPublicVisible("nhl", "2026-04-12"), true);
  assert.equal(isPublicVisible("nhl", "2026-04-13"), true);
  assert.equal(isPublicVisible("nhl", "2026-12-31"), true);
});

test("public visibility: NBA is unaffected by the NHL cutoff at every date", () => {
  for (const d of ["2026-01-01", "2026-04-10", "2026-04-11", "2026-04-12", "2026-12-31"]) {
    assert.equal(isPublicVisible("nba", d), true, `nba on ${d} should be visible`);
  }
});

test("public visibility: leagues with no cutoff entry are unaffected", () => {
  // ncaam isn't in the cutoff map — it shouldn't be touched by this filter
  // (it is gated separately as 'experimental' in DEFAULT_PRODUCTION_LEAGUES).
  assert.equal(isPublicVisible("ncaam", "2025-01-01"), true);
});

test("cutoff is a strict less-than (boundary day is the FIRST included day)", () => {
  // Lock the off-by-one in case someone changes < to <= later.
  const c = { nhl: "2026-04-12" };
  assert.equal(isPublicVisible("nhl", "2026-04-11", c), false);
  assert.equal(isPublicVisible("nhl", "2026-04-12", c), true);
});
