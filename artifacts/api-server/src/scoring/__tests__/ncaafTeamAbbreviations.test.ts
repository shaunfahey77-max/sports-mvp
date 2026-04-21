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
} from "../../lib/teamAbbreviations";

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
