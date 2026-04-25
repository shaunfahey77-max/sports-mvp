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

// -----------------------------------------------------------------------
// Change 1: NHL moneyline plausibility filter (MONEYLINE_RANGE)
// -----------------------------------------------------------------------
// These tests reproduce the 4/13 NHL incident pattern: stale/buggy book
// payloads with ML quotes 4-50x more extreme than any real cross-book
// quote, which then drove spurious 30-50% spread edges through the
// downstream vig-removal math.
//
// NHL range is ±500. The bad rows had quotes like:
//   wpg_mamm:  WPG -1800 / MAMM +3300
//   col_cgy:   CGY +6000 / COL -2200
//   wsh_cbj:   WSH -? / CBJ +600 (CBJ side over range)
// All four games' bad quotes had at least one side outside ±500.

test("NHL ML filter: drops a book whose home ML is +6000 (above range), prefers in-range book", () => {
  const books: OddsBookmaker[] = [
    mkBook("bad-stale-book", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Calgary Flames", price: 6000 },
          { name: "Colorado Avalanche", price: -2200 },
        ],
      },
    ]),
    mkBook("real-book-a", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Calgary Flames", price: 145 },
          { name: "Colorado Avalanche", price: -175 },
        ],
      },
    ]),
    mkBook("real-book-b", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Calgary Flames", price: 138 },
          { name: "Colorado Avalanche", price: -165 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Calgary Flames", "Colorado Avalanche", "nhl");

  // The bad book's +6000 / -2200 pair must be filtered out entirely.
  // The picker must NOT take the +6000 home (longest underdog price)
  // even though it would otherwise win best-price-per-side.
  assert.notEqual(best.h2h?.homeBook, "bad-stale-book");
  assert.notEqual(best.h2h?.awayBook, "bad-stale-book");
  // Best in-range home is real-book-a's +145; best in-range away is
  // real-book-b's -165.
  assert.equal(best.h2h?.homeOdds, 145);
  assert.equal(best.h2h?.awayOdds, -165);
});

test("NHL ML filter: drops a book whose away ML is below -500 (per-pair, not per-side)", () => {
  // This is the wpg_mamm pattern: WPG home -1800 / MAMM away +3300.
  // Both sides are out of range. Even if only ONE side were broken,
  // the whole pair must drop because picking the in-range side from a
  // book whose other side is broken is itself a consistency hazard.
  const books: OddsBookmaker[] = [
    mkBook("bad-stale-book", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Utah Mammoth", price: -1800 },  // home, way below -500
          { name: "Winnipeg Jets", price: 3300 },  // away, way above +500
        ],
      },
    ]),
    mkBook("real-book", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Utah Mammoth", price: -175 },
          { name: "Winnipeg Jets", price: 145 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Utah Mammoth", "Winnipeg Jets", "nhl");
  assert.equal(best.h2h?.homeBook, "real-book");
  assert.equal(best.h2h?.awayBook, "real-book");
  assert.equal(best.h2h?.homeOdds, -175);
  assert.equal(best.h2h?.awayOdds, 145);
});

test("NHL ML filter: drops the pair if EITHER side is out of range (asymmetric bad quote)", () => {
  // Half-broken book: home is realistic, away is +6000.
  // Per-pair filter must drop both. The picker may NOT keep the
  // home -150 from the bad book just because it's "in range" — its
  // pair partner is bogus, so the whole h2h pair is suspect.
  const books: OddsBookmaker[] = [
    mkBook("half-broken-book", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: -150 },  // in range
          { name: "Away Team", price: 6000 },  // out of range
        ],
      },
    ]),
    mkBook("real-book", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: -140 },
          { name: "Away Team", price: 120 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Home Team", "Away Team", "nhl");
  // Bad book's -150 is the longer favorite price; without filter, it
  // would have won the home-side competition. After filter, real-book's
  // -140 wins.
  assert.equal(best.h2h?.homeBook, "real-book");
  assert.equal(best.h2h?.awayBook, "real-book");
  assert.equal(best.h2h?.homeOdds, -140);
  assert.equal(best.h2h?.awayOdds, 120);
});

test("NHL ML filter: ALL books out of range yields no h2h selection (signals snapshot rejection)", () => {
  const books: OddsBookmaker[] = [
    mkBook("book-a", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: 6000 },
          { name: "Away Team", price: -2200 },
        ],
      },
    ]),
    mkBook("book-b", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Home Team", price: -1800 },
          { name: "Away Team", price: 3300 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Home Team", "Away Team", "nhl");
  assert.equal(best.h2h, null);
});

test("ML filter: leagues with no configured range (e.g. ncaaf) keep all books", () => {
  // NCAAF intentionally has no MONEYLINE_RANGE entry — Power 5 vs FCS
  // games can produce legitimately extreme ML quotes (-5000+). Filter
  // must be a no-op for unconfigured leagues so we don't introduce
  // regressions in those sports.
  const books: OddsBookmaker[] = [
    mkBook("book-a", [
      {
        key: "h2h",
        last_update: "",
        outcomes: [
          { name: "Alabama Crimson Tide", price: -5000 },
          { name: "Mercer Bears", price: 1800 },
        ],
      },
    ]),
  ];

  const best = pickBestLines(books, "Alabama Crimson Tide", "Mercer Bears", "ncaaf");
  // Filter is a no-op — the -5000 / +1800 pair must survive.
  assert.equal(best.h2h?.homeOdds, -5000);
  assert.equal(best.h2h?.awayOdds, 1800);
});
