import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformGame, type OddsBookmaker, type OddsGame } from "../oddsApi";

const __dirname = dirname(fileURLToPath(import.meta.url));

function mkBook(key: string, markets: OddsBookmaker["markets"]): OddsBookmaker {
  return { key, title: key, last_update: "2026-04-25T00:00:00Z", markets };
}

function mkGame(opts: {
  homeTeam: string;
  awayTeam: string;
  bookmakers: OddsBookmaker[];
  commenceTime?: string;
}): OddsGame {
  return {
    id: "test-game",
    sport_key: "icehockey_nhl",
    sport_title: "NHL",
    commence_time: opts.commenceTime ?? "2026-04-25T23:00:00Z",
    home_team: opts.homeTeam,
    away_team: opts.awayTeam,
    bookmakers: opts.bookmakers,
  };
}

// ===========================================================================
// Change 2: ML / spread consistency rail in transformGame
// ===========================================================================
// After all per-side and per-line filters, the chosen ML pair and the
// chosen spread pair MUST agree on which team is the favorite. If
// vig-removed home prob > 0.5 (ML favors home) but the spread point is
// positive (spread favors away), or vice versa — drop the snapshot
// rather than emit an internally inconsistent record into the model.
//
// Decisive thresholds (5pp ML margin AND >=1 spread point) prevent
// false positives on pick'em / coin-flip games.
// ===========================================================================

test("consistency rail: REJECTS snapshot when ML favorite (home -200) disagrees with spread favorite (home +1.5)", () => {
  // Home is a heavy ML favorite (-200 → ~67% fair) but the spread says
  // home gets +1.5 points (i.e. home is the underdog). Real-data
  // pattern: this is what a corrupted snapshot looks like — different
  // books contributed contradictory directional info that the per-pair
  // filters didn't catch because each side individually was in range.
  const game = mkGame({
    homeTeam: "Boston Bruins",
    awayTeam: "Tampa Bay Lightning",
    bookmakers: [
      mkBook("book-a", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -200 },
          { name: "Tampa Bay Lightning", price: 175 },
        ]},
        { key: "spreads", last_update: "", outcomes: [
          // Spread says home is the +1.5 dog — directly contradicts ML.
          { name: "Boston Bruins", price: -110, point: 1.5 },
          { name: "Tampa Bay Lightning", price: -110, point: -1.5 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.equal(snap, null);
});

test("consistency rail: REJECTS snapshot when ML favorite (away -180) disagrees with spread favorite (away +1.5)", () => {
  // Mirror case: away is the ML favorite but spread says away is dog.
  const game = mkGame({
    homeTeam: "Calgary Flames",
    awayTeam: "Colorado Avalanche",
    bookmakers: [
      mkBook("book-a", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Calgary Flames", price: 160 },
          { name: "Colorado Avalanche", price: -180 },
        ]},
        { key: "spreads", last_update: "", outcomes: [
          { name: "Calgary Flames", price: -110, point: -1.5 },
          { name: "Colorado Avalanche", price: -110, point: 1.5 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.equal(snap, null);
});

test("consistency rail: ALLOWS snapshot when ML and spread agree directionally (home -200 + home -1.5)", () => {
  // Sanity / non-regression: normal consistent snapshot must still flow.
  const game = mkGame({
    homeTeam: "Boston Bruins",
    awayTeam: "Tampa Bay Lightning",
    bookmakers: [
      mkBook("book-a", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -200 },
          { name: "Tampa Bay Lightning", price: 175 },
        ]},
        { key: "spreads", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -110, point: -1.5 },
          { name: "Tampa Bay Lightning", price: -110, point: 1.5 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.ok(snap, "consistent snapshot should pass");
  assert.equal(snap!.publishSpread, -1.5);
  assert.equal(snap!.homePublishMl, -200);
});

test("consistency rail: ALLOWS pick'em-ish ML (-110/-110) even if spread sign 'disagrees' — small ML margin", () => {
  // Pick'em ML: -110 / -110 → fair home prob ≈ 0.5. Margin is 0,
  // below the 5pp gate, so the rail must NOT trigger regardless of
  // spread sign. This is critical to prevent false positives on
  // coin-flip games.
  const game = mkGame({
    homeTeam: "Boston Bruins",
    awayTeam: "Tampa Bay Lightning",
    bookmakers: [
      mkBook("book-a", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -110 },
          { name: "Tampa Bay Lightning", price: -110 },
        ]},
        { key: "spreads", last_update: "", outcomes: [
          // Spread says away is favored by 1.5 — would naively conflict
          // with home being a 50.0001% ML "favorite" if we didn't gate
          // on margin. Gate must hold.
          { name: "Boston Bruins", price: -110, point: 1.5 },
          { name: "Tampa Bay Lightning", price: -110, point: -1.5 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.ok(snap, "pick'em ML should pass even with directional spread");
});

test("consistency rail: ALLOWS tiny spreads (|point|<1) even if ML/spread sign disagrees", () => {
  // Hockey/baseball half-point hooks at 0.5 occur. If somehow ML and
  // a 0.5 spread sign disagree, the rail should NOT fire because the
  // spread itself is below the decisive threshold.
  const game = mkGame({
    homeTeam: "Boston Bruins",
    awayTeam: "Tampa Bay Lightning",
    bookmakers: [
      mkBook("book-a", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -150 },
          { name: "Tampa Bay Lightning", price: 130 },
        ]},
        { key: "spreads", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -110, point: 0.5 },
          { name: "Tampa Bay Lightning", price: -110, point: -0.5 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.ok(snap, "tiny spread should pass even with directional ML disagreement");
});

test("consistency rail: NO spread present (ML-only game) — rail does not crash, snapshot passes", () => {
  // If a game has h2h but no spreads market at all, rail must skip
  // (best.spread is null). Regression test.
  const game = mkGame({
    homeTeam: "Boston Bruins",
    awayTeam: "Tampa Bay Lightning",
    bookmakers: [
      mkBook("book-a", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -200 },
          { name: "Tampa Bay Lightning", price: 175 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.ok(snap);
  assert.equal(snap!.publishSpread, null);
});

// ===========================================================================
// Change 3: bestBooks provenance is populated on every successful snapshot
// ===========================================================================

test("bestBooks: provenance reflects the actual best-price book per side and per market", () => {
  // For favorites, the BEST American price is the one CLOSEST to even
  // (e.g. -195 is better than -200 — americanToDecimal: -195 → 1.513,
  // -200 → 1.500). For underdogs, the LONGEST positive price wins.
  // Best spread price is also the highest decimal odds at the chosen
  // matched-pair point.
  const game = mkGame({
    homeTeam: "Boston Bruins",
    awayTeam: "Tampa Bay Lightning",
    bookmakers: [
      mkBook("draftkings", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -200 },
          { name: "Tampa Bay Lightning", price: 170 },
        ]},
        { key: "spreads", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -110, point: -1.5 },
          { name: "Tampa Bay Lightning", price: -110, point: 1.5 },
        ]},
      ]),
      mkBook("fanduel", [
        { key: "h2h", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -195 },  // best home ML (shorter favorite)
          { name: "Tampa Bay Lightning", price: 175 },  // best away ML (longer dog)
        ]},
        { key: "spreads", last_update: "", outcomes: [
          { name: "Boston Bruins", price: -105, point: -1.5 },  // best home spread
          { name: "Tampa Bay Lightning", price: -115, point: 1.5 },
        ]},
      ]),
    ],
  });

  const snap = transformGame(game, "nhl");
  assert.ok(snap);
  assert.equal(snap!.bestBooks.moneylineHome, "fanduel");
  assert.equal(snap!.bestBooks.moneylineAway, "fanduel");
  // Best home spread price at point -1.5 is fanduel's -105.
  assert.equal(snap!.bestBooks.spreadHome, "fanduel");
  // Best away spread price at point +1.5 is draftkings' -110 (vs fanduel's -115).
  assert.equal(snap!.bestBooks.spreadAway, "draftkings");
});

// ===========================================================================
// Integration replay: real Odds API historical NHL payloads from 2026-04-14/15
// ===========================================================================
// These are the 4 actual games whose stored game_snapshots rows had bad
// ML/spread data on 2026-04-13. The historical payloads themselves are
// CLEAN (the bad rows were captured at a transient bad cron cycle, not
// reflective of any real book quote at game time). Therefore:
//
//  1. Running the clean payloads through transformGame should produce
//     valid snapshots (no false positives from new filters).
//  2. Injecting the bug pattern into one of these clean payloads must
//     produce the expected behavior: bad book gets dropped, snapshot
//     still produced from remaining clean books.
//  3. Injecting bug pattern into ALL books must produce snapshot=null.
// ===========================================================================

interface FixtureFile {
  description: string;
  fetched: string;
  games: Array<{ label: string; game: OddsGame }>;
}

const FIXTURE: FixtureFile = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures", "nhl-historical-2026-04-14-15.json"),
    "utf8"
  )
);

for (const { label, game } of FIXTURE.games) {
  test(`integration replay: clean historical NHL payload for ${label} produces a valid snapshot`, () => {
    const snap = transformGame(game, "nhl");
    assert.ok(snap, `expected ${label} to produce a valid snapshot from clean historical data`);
    // The new filters should NOT reject any of the four — these are real
    // book payloads with normal cross-book pricing.
    assert.ok(snap!.gameKey.startsWith("nhl_2026-04-1"));
    assert.ok(snap!.homePublishMl >= -500 && snap!.homePublishMl <= 500,
      `home ML ${snap!.homePublishMl} should be in NHL range`);
    assert.ok(snap!.awayPublishMl >= -500 && snap!.awayPublishMl <= 500,
      `away ML ${snap!.awayPublishMl} should be in NHL range`);
    // bestBooks must be populated.
    assert.ok(snap!.bestBooks.moneylineHome);
    assert.ok(snap!.bestBooks.moneylineAway);
  });
}

test("integration replay: injecting a bad ML book into the col_cgy payload — bad book is dropped, snapshot still valid from remaining 11 clean books", () => {
  const orig = FIXTURE.games.find((g) => g.label === "col_cgy")!.game;
  // Clone deeply so we don't mutate the fixture for other tests.
  const cloned: OddsGame = JSON.parse(JSON.stringify(orig));

  // Inject a bad-stale book at the front of the bookmaker list with
  // home +6000 / away -2200 — exactly the wpg_mamm/col_cgy pattern.
  cloned.bookmakers.unshift({
    key: "stale-bad-book",
    title: "Stale Bad Book",
    last_update: "2026-04-13T15:10:00Z",
    markets: [
      { key: "h2h", last_update: "", outcomes: [
        { name: cloned.home_team, price: 6000 },
        { name: cloned.away_team, price: -2200 },
      ]},
    ],
  });

  const snap = transformGame(cloned, "nhl");
  assert.ok(snap, "snapshot should still be produced — clean books remain");
  // The bad book MUST NOT be the chosen home or away ML book.
  assert.notEqual(snap!.bestBooks.moneylineHome, "stale-bad-book");
  assert.notEqual(snap!.bestBooks.moneylineAway, "stale-bad-book");
  // And the chosen ML quotes must remain in NHL range.
  assert.ok(snap!.homePublishMl >= -500 && snap!.homePublishMl <= 500);
  assert.ok(snap!.awayPublishMl >= -500 && snap!.awayPublishMl <= 500);
});

test("integration replay: replacing ALL h2h pairs with bad quotes yields snapshot=null (no usable h2h)", () => {
  const orig = FIXTURE.games.find((g) => g.label === "col_cgy")!.game;
  const cloned: OddsGame = JSON.parse(JSON.stringify(orig));

  // Stomp every book's h2h with the bad pattern. Spreads/totals can stay
  // clean — that's not what we're testing here.
  for (const bk of cloned.bookmakers) {
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (h2h) {
      h2h.outcomes = [
        { name: cloned.home_team, price: 6000 },
        { name: cloned.away_team, price: -2200 },
      ];
    }
  }

  const snap = transformGame(cloned, "nhl");
  assert.equal(snap, null, "every book bad → snapshot must be rejected");
});

test("integration replay: injecting a directional ML/spread inconsistency into col_cgy triggers consistency rail", () => {
  const orig = FIXTURE.games.find((g) => g.label === "col_cgy")!.game;
  const cloned: OddsGame = JSON.parse(JSON.stringify(orig));

  // Stomp every book's h2h to make HOME the heavy ML favorite (-300).
  // Stomp every book's spread to make AWAY the favorite (-1.5).
  // This is the exact internal-inconsistency pattern Change 2 catches.
  for (const bk of cloned.bookmakers) {
    const h2h = bk.markets.find((m) => m.key === "h2h");
    if (h2h) {
      h2h.outcomes = [
        { name: cloned.home_team, price: -300 },
        { name: cloned.away_team, price: 250 },
      ];
    }
    const sp = bk.markets.find((m) => m.key === "spreads");
    if (sp) {
      sp.outcomes = [
        { name: cloned.home_team, price: -110, point: 1.5 },
        { name: cloned.away_team, price: -110, point: -1.5 },
      ];
    }
  }

  const snap = transformGame(cloned, "nhl");
  assert.equal(snap, null, "ML home -300 + spread home +1.5 must trip rail");
});
