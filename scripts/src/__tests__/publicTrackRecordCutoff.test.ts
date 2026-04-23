/**
 * Pure-logic test for the public track-record cutoff filter. Mirrors the
 * SQL semantics of `buildPreFixExclusionCondition` in
 * artifacts/api-server/src/lib/preFixCutoff.ts so we catch drift between
 * the config (PUBLIC_TRACK_RECORD_CUTOFFS) and the public read surface.
 *
 * Cutoffs (both at 2026-04-12, the line-shopping fix landing date):
 *   - NHL: rows BEFORE 2026-04-12 are excluded; on/after are visible.
 *   - NBA: same — added in the read-surface cutoff fix so the History /
 *          Performance / Picks endpoints all show current-algorithm-only
 *          NBA data.
 *
 * Leagues without an entry in the cutoff map (e.g. ncaam, mlb, nfl,
 * ncaaf) are unaffected by this filter regardless of date.
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

test("cutoff config: NBA is set to 2026-04-12 (same line-shopping fix)", () => {
  assert.equal(PUBLIC_TRACK_RECORD_CUTOFFS.nba, "2026-04-12");
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

test("public visibility: NBA rows BEFORE 2026-04-12 are hidden from the public surface", () => {
  assert.equal(isPublicVisible("nba", "2026-04-10"), false);
  assert.equal(isPublicVisible("nba", "2026-04-11"), false);
  assert.equal(isPublicVisible("nba", "2026-01-01"), false);
});

test("public visibility: NBA rows ON OR AFTER 2026-04-12 are visible (clean post-fix)", () => {
  assert.equal(isPublicVisible("nba", "2026-04-12"), true);
  assert.equal(isPublicVisible("nba", "2026-04-13"), true);
  assert.equal(isPublicVisible("nba", "2026-12-31"), true);
});

test("public visibility: leagues with no cutoff entry are unaffected", () => {
  // ncaam / mlb / nfl / ncaaf are not in the cutoff map — they shouldn't
  // be touched by this filter (each is gated separately, e.g. NCAAM as
  // experimental, MLB as shadow-mode, NFL/NCAAF as foundation-only).
  assert.equal(isPublicVisible("ncaam", "2025-01-01"), true);
  assert.equal(isPublicVisible("mlb", "2025-01-01"), true);
  assert.equal(isPublicVisible("nfl", "2025-01-01"), true);
  assert.equal(isPublicVisible("ncaaf", "2025-01-01"), true);
});

test("cutoff is a strict less-than (boundary day is the FIRST included day)", () => {
  // Lock the off-by-one in case someone changes < to <= later.
  const c = { nhl: "2026-04-12", nba: "2026-04-12" };
  assert.equal(isPublicVisible("nhl", "2026-04-11", c), false);
  assert.equal(isPublicVisible("nhl", "2026-04-12", c), true);
  assert.equal(isPublicVisible("nba", "2026-04-11", c), false);
  assert.equal(isPublicVisible("nba", "2026-04-12", c), true);
});
