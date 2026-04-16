import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBestLines, type OddsBookmaker } from "../oddsApi";

function mkBook(key: string, markets: OddsBookmaker["markets"]): OddsBookmaker {
  return { key, title: key, last_update: "2026-04-16T00:00:00Z", markets };
}

test("NHL total: never pairs over@3.5 (alt) with under@6.5 (main) — matches the 3.5/9.5 alt leaks observed in scored_picks", () => {
  // Reproduces the bug pattern behind:
  //   nhl_2026-04-11_tbl_bos total over publishOdds=+500 publishLine=3.5 edge=0.554
  //   nhl_2026-04-09_min_dal total over publishOdds=+2500 publishLine=9.5 edge=0.425
  // Book A offers an aberrant alt/team/period total under the main "totals"
  // key; Book B offers the realistic main line. The previous picker took
  // Book A's over (lowest point + longest price) and Book B's under,
  // stored publishTotal = 3.5, and then evaluated the NHL total model at
  // line=3.5 against market odds vig-removed as if the sides matched.
  const books: OddsBookmaker[] = [
    mkBook("alt-book", [
      {
        key: "totals",
        last_update: "",
        outcomes: [
          { name: "Over", price: 500, point: 3.5 },
          { name: "Under", price: -900, point: 3.5 },
        ],
      },
    ]),
    mkBook("main-book-a", [
      {
        key: "totals",
        last_update: "",
        outcomes: [
          { name: "Over", price: -110, point: 6.0 },
          { name: "Under", price: -110, point: 6.0 },
        ],
      },
    ]),
    mkBook("main-book-b", [
      {
        key: "totals",
        last_update: "",
        outcomes: [
          { name: "Over", price: -105, point: 6.0 },
          { name: "Under", price: -115, point: 6.0 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Boston Bruins", "Tampa Bay Lightning", "nhl");

  // Must land on the main 6.0 line — NOT 3.5 — because alt-book's 3.5 is
  // outside the NHL plausibility range (5.0-7.0).
  assert.equal(best.total?.overPoint, 6.0);
  assert.equal(best.total?.underPoint, 6.0);
  // And the picked prices must be the best price *at* that shared line.
  assert.equal(best.total?.overOdds, -105);
  assert.equal(best.total?.underOdds, -110);
});

test("NHL spread: never pairs home -1.5 with away +2.5 — matches the -2.5 alt leaks observed in scored_picks", () => {
  // Reproduces the bug pattern behind:
  //   nhl_2026-04-11_ott_nyi spread away -2.5 +2000 edge=0.441
  //   nhl_2026-04-14_wpg_mamm spread home -2.5 +475  edge=0.368
  // Book A offers an alt puck-line (±2.5); book B offers the main ±1.5.
  // Previous picker took the biggest away-point winner from A and the
  // standard home-point from B, yielding publishSpread = -1.5 while
  // publishAwaySpreadLine = +2000 was actually quoted at +2.5.
  const books: OddsBookmaker[] = [
    mkBook("alt-book", [
      {
        key: "spreads",
        last_update: "",
        outcomes: [
          { name: "New York Islanders", price: -1500, point: -2.5 },
          { name: "Ottawa Senators", price: 2000, point: 2.5 },
        ],
      },
    ]),
    mkBook("main-book", [
      {
        key: "spreads",
        last_update: "",
        outcomes: [
          { name: "New York Islanders", price: -130, point: -1.5 },
          { name: "Ottawa Senators", price: 110, point: 1.5 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "New York Islanders", "Ottawa Senators", "nhl");

  // Must land on ±1.5 — NOT ±2.5 — because ±2.5 is outside the NHL
  // puck-line plausibility range (abs ≤ 2.0).
  assert.equal(best.spread?.homePoint, -1.5);
  assert.equal(best.spread?.awayPoint, 1.5);
  assert.equal(best.spread?.homeOdds, -130);
  assert.equal(best.spread?.awayOdds, 110);
});

test("NHL spread: even without the plausibility filter, matched-pair shopping never mixes home@X with away@Y across books", () => {
  // This test exercises the core correctness property of the new picker:
  // even if two books disagree on the MAIN line (both within range),
  // the chosen home point must equal -awayPoint.
  const books: OddsBookmaker[] = [
    mkBook("book-a", [
      {
        key: "spreads",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: -140, point: -1.5 },
          { name: "Away Team", price: 120, point: 1.5 },
        ],
      },
    ]),
    // Book B shows a matched pair at a different line — completely legal,
    // just a different main. Picker must not cross-pair between A and B.
    mkBook("book-b", [
      {
        key: "spreads",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: 170, point: 0.5 },
          { name: "Away Team", price: -200, point: -0.5 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Home Team", "Away Team", "nhl");

  assert.ok(best.spread);
  // Either line is acceptable — but home + away points MUST sum to zero.
  assert.equal((best.spread!.homePoint + best.spread!.awayPoint), 0);
});

test("NBA spread: NBA plausibility range is generous enough to retain all real NBA spreads (|point| up to 25)", () => {
  // NBA spreads regularly reach ±13 to ±19 in blowout matchups. The
  // plausibility cap must not regress NBA behavior.
  const books: OddsBookmaker[] = [
    mkBook("book-a", [
      {
        key: "spreads",
        last_update: "",
        outcomes: [
          { name: "Detroit Pistons", price: -110, point: 15.5 },
          { name: "Denver Nuggets", price: -110, point: -15.5 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Denver Nuggets", "Detroit Pistons", "nba");
  assert.equal(best.spread?.homePoint, -15.5);
});

test("moneyline: still shops each side independently across books (no line to mismatch)", () => {
  const books: OddsBookmaker[] = [
    mkBook("book-a", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: -150 },
          { name: "Away Team", price: 120 },
        ],
      },
    ]),
    mkBook("book-b", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: -140 },
          { name: "Away Team", price: 130 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Home Team", "Away Team", "nhl");
  // Best home price is -140 (book-b); best away price is 130 (book-b).
  assert.equal(best.h2h?.homeOdds, -140);
  assert.equal(best.h2h?.awayOdds, 130);
});
