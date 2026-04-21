/**
 * NCAAF team abbreviation coverage + collision-safety tests.
 *
 * Why this exists:
 *   The fuzzy fallback ("last word, lowercased, max 4 chars") collapses
 *   Ohio State / Oklahoma State / Oregon State all to "stat" and is
 *   therefore unsafe for college football. The eventual NCAAF backtest
 *   harness needs stable, collision-free per-team identifiers. These
 *   tests pin (a) collision-uniqueness within ncaaf, (b) coverage of
 *   the most-bet programs, (c) alias resolution for common short forms,
 *   and (d) that aliases never resolve to abbrev that don't exist.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NCAAF_TEAM_ABBREVS,
  NCAAF_TEAM_ALIASES,
  getTeamAbbrev,
  resolveTeamAbbrev,
} from "../../lib/teamAbbreviations";

/**
 * The exact FBS-program team strings that fell through to the fuzzy
 * fallback in the 2025 NCAAF backtest (`.local/backtest-reports/ncaaf-2025.txt`).
 *
 * Phase A normalization repair (2026-04-21) added feed-form aliases for
 * each of these. This fixture pins them as a regression guard: any future
 * change that re-breaks deterministic resolution for these strings must
 * fail the test. FCS-only opponents from the same fuzzy list are
 * deliberately excluded — the football redesign plan calls for filtering
 * FBS-vs-FCS games out of the candidate set rather than expanding the
 * canonical map to all ~250 FCS schools.
 */
const NCAAF_FBS_FEED_FUZZY_FIXTURE_2025: Array<[string, string]> = [
  ["UMass Minutemen", "mass"],
  ["UL Monroe Warhawks", "ulm"],
  ["Florida International Panthers", "fiu"],
  ["Southern Mississippi Golden Eagles", "sou"],
  ["Delaware Blue Hens", "del"],
  ["Sam Houston State Bearkats", "sam"],
];

test("ncaaf abbrev map has no collisions (every abbrev unique within league)", () => {
  const seen = new Map<string, string>();
  for (const [team, abbrev] of Object.entries(NCAAF_TEAM_ABBREVS)) {
    const prior = seen.get(abbrev);
    assert.ok(
      prior === undefined,
      `Collision: "${abbrev}" used by both "${prior}" and "${team}"`
    );
    seen.set(abbrev, team);
  }
});

test("ncaaf abbrev map covers a substantial portion of FBS (>= 130 schools)", () => {
  const count = Object.keys(NCAAF_TEAM_ABBREVS).length;
  assert.ok(count >= 130, `Expected >= 130 FBS schools, got ${count}`);
});

test("known historical collision pairs resolve to distinct codes", () => {
  // The fuzzy fallback collapsed all of these to the same 4-char suffix.
  const pairs: Array<[string, string]> = [
    ["Ohio State Buckeyes", "Oklahoma State Cowboys"],
    ["Ohio State Buckeyes", "Oregon State Beavers"],
    ["Oklahoma State Cowboys", "Oregon State Beavers"],
    ["Miami Hurricanes", "Miami (OH) RedHawks"],
    ["Texas Longhorns", "Texas A&M Aggies"],
    ["Texas Longhorns", "Texas State Bobcats"],
    ["Texas A&M Aggies", "Texas Tech Red Raiders"],
    ["Washington Huskies", "Washington State Cougars"],
    ["Michigan Wolverines", "Michigan State Spartans"],
    ["Mississippi State Bulldogs", "Missouri Tigers"],
    ["LSU Tigers", "Auburn Tigers"],
    ["LSU Tigers", "Clemson Tigers"],
    ["Kansas State Wildcats", "Kennesaw State Owls"],
    ["UCLA Bruins", "USC Trojans"],
    ["Utah Utes", "Utah State Aggies"],
  ];
  for (const [a, b] of pairs) {
    const aCode = getTeamAbbrev(a, "ncaaf");
    const bCode = getTeamAbbrev(b, "ncaaf");
    assert.notEqual(aCode, bCode, `${a} (${aCode}) collided with ${b} (${bCode})`);
  }
});

test("common aliases resolve to the canonical school's abbrev", () => {
  // These are short forms that show up across feeds and historical CSVs.
  const cases: Array<[string, string]> = [
    ["Ohio State", "ohst"],
    ["Ohio St", "ohst"],
    ["Penn State", "psu"],
    ["Penn St", "psu"],
    ["Kansas St", "ksst"],
    ["Oklahoma St", "okst"],
    ["Oregon St", "orst"],
    ["Mississippi", "olem"], // common alias for Ole Miss
    ["Mizzou", "mizz"],
    ["UNC", "unc"],
    ["NC State", "ncst"],
    ["FSU", "fsu"],
    ["BYU", "byu"],
    ["TCU", "tcu"],
    ["UCF", "ucf"],
    ["Cal", "cal"],
    ["UMass", "mass"],
    ["Pitt", "pitt"],
    ["WSU", "wsu"],
    ["WVU", "wvu"],
  ];
  for (const [alias, expected] of cases) {
    assert.equal(
      getTeamAbbrev(alias, "ncaaf"),
      expected,
      `alias "${alias}" should resolve to "${expected}"`
    );
  }
});

test("every alias resolves to a real entry in NCAAF_TEAM_ABBREVS", () => {
  for (const [alias, canonical] of Object.entries(NCAAF_TEAM_ALIASES)) {
    assert.ok(
      canonical in NCAAF_TEAM_ABBREVS,
      `alias "${alias}" → "${canonical}" is not in NCAAF_TEAM_ABBREVS`
    );
  }
});

test("Odds API canonical names resolve directly without fuzzy fallback", () => {
  // Spot-check that the canonical-form keys match the Odds API style.
  const odds: string[] = [
    "Alabama Crimson Tide",
    "Georgia Bulldogs",
    "Ohio State Buckeyes",
    "Michigan Wolverines",
    "USC Trojans",
    "UCLA Bruins",
    "Notre Dame Fighting Irish",
    "Miami Hurricanes",
    "Boise State Broncos",
    "Coastal Carolina Chanticleers",
  ];
  for (const name of odds) {
    const code = getTeamAbbrev(name, "ncaaf");
    assert.ok(code.length >= 2 && code.length <= 5, `code "${code}" out of range`);
    // Sanity: code matches the explicit map (not a fuzzy slice).
    assert.equal(code, NCAAF_TEAM_ABBREVS[name]);
  }
});

test("getTeamAbbrev tolerates surrounding whitespace", () => {
  assert.equal(getTeamAbbrev("  Ohio State Buckeyes  ", "ncaaf"), "ohst");
  assert.equal(getTeamAbbrev("  Ohio St  ", "ncaaf"), "ohst");
});

// ---------------------------------------------------------------------------
// Phase A normalization invariants (2026-04-21)
//
// These tests pin two guarantees that the football redesign plan calls for
// before any future NCAAF backtest is allowed to run:
//   1. Every canonical FBS entry resolves via `source: 'canonical'` (no
//      silent fuzzy collapse on the canonical map itself).
//   2. The exact feed-form strings observed in the 2025 backtest fuzzy
//      bucket — the FBS subset — now resolve via `'canonical'` or
//      `'alias'` (NOT `'fuzzy'`).
// ---------------------------------------------------------------------------

test("every NCAAF_TEAM_ABBREVS canonical key resolves via source='canonical'", () => {
  for (const [team, expected] of Object.entries(NCAAF_TEAM_ABBREVS)) {
    const resolved = resolveTeamAbbrev(team, "ncaaf");
    assert.equal(
      resolved.source,
      "canonical",
      `canonical key "${team}" should resolve via 'canonical', got '${resolved.source}'`
    );
    assert.equal(resolved.abbrev, expected);
  }
});

test("every NCAAF_TEAM_ALIASES alias resolves via source='alias' to its canonical abbrev", () => {
  for (const [alias, canonical] of Object.entries(NCAAF_TEAM_ALIASES)) {
    const resolved = resolveTeamAbbrev(alias, "ncaaf");
    assert.equal(
      resolved.source,
      "alias",
      `alias "${alias}" should resolve via 'alias', got '${resolved.source}'`
    );
    assert.equal(
      resolved.abbrev,
      NCAAF_TEAM_ABBREVS[canonical],
      `alias "${alias}" should produce abbrev for canonical "${canonical}"`
    );
  }
});

test("2025 backtest FBS-feed-form fuzzy strings now resolve deterministically (no fuzzy)", () => {
  for (const [feedName, expectedAbbrev] of NCAAF_FBS_FEED_FUZZY_FIXTURE_2025) {
    const resolved = resolveTeamAbbrev(feedName, "ncaaf");
    assert.notEqual(
      resolved.source,
      "fuzzy",
      `feed-form name "${feedName}" still falls through to fuzzy; ` +
        `add a NCAAF_TEAM_ALIASES entry pointing at the canonical key.`
    );
    assert.equal(
      resolved.abbrev,
      expectedAbbrev,
      `feed-form name "${feedName}" should resolve to "${expectedAbbrev}", ` +
        `got "${resolved.abbrev}" via source='${resolved.source}'`
    );
  }
});

test("resolveTeamAbbrev reports 'fuzzy' for genuinely-unknown FCS strings (back-compat)", () => {
  // FCS schools are intentionally NOT in the canonical map. The fuzzy
  // path must still return a value (no throw) so production code is
  // resilient, but it must be reported as 'fuzzy' so callers can detect
  // and filter these games. The opposite behavior — silently treating
  // an unknown school as canonical — would be a worse regression.
  const fcsExamples = [
    "Bucknell Bison",
    "Holy Cross Crusaders",
    "William and Mary Tribe",
    "Bryant Bulldogs",
  ];
  for (const name of fcsExamples) {
    const resolved = resolveTeamAbbrev(name, "ncaaf");
    assert.equal(
      resolved.source,
      "fuzzy",
      `FCS-style name "${name}" should be reported as 'fuzzy', got '${resolved.source}'`
    );
    assert.ok(
      resolved.abbrev.length >= 1 && resolved.abbrev.length <= 4,
      `fuzzy abbrev "${resolved.abbrev}" out of expected length range`
    );
  }
});
