import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateByLeagueMarket,
  aggregateRows,
  renderMarkdownReport,
  type AggregatorRow,
} from "../modelWatchAggregator";

/**
 * Aggregator math is the only thing the admin Model-Watch endpoint
 * does in JS — everything else is a thin DB pass-through. Locking the
 * math here prevents silent regressions that would mislead the
 * promote / demote decisions the report is meant to inform.
 */

const baseRow = (over: Partial<AggregatorRow>): AggregatorRow => ({
  league: "nhl",
  market: "spread",
  tier: "A",
  publishOdds: -110,
  edge: 0.05,
  ev: 0.02,
  result: "pending",
  clvImpliedDelta: null,
  ...over,
});

test("aggregateRows: empty input returns zeroed stats", () => {
  const s = aggregateRows([]);
  assert.equal(s.samples, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.roi, 0);
  assert.equal(s.clvSampleSize, 0);
});

test("aggregateRows: pushes excluded from win rate but included in resolved/ROI denominator", () => {
  const rows: AggregatorRow[] = [
    baseRow({ result: "win", publishOdds: -110 }),
    baseRow({ result: "loss" }),
    baseRow({ result: "push" }),
  ];
  const s = aggregateRows(rows);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.pushes, 1);
  assert.equal(s.resolved, 3);
  // 1/(1+1) = 0.5 — push excluded
  assert.equal(s.winRate, 0.5);
  // win at -110 = +0.909..u, loss = -1u, push = 0u → -0.0909/3 ≈ -0.0303
  assert.ok(Math.abs(s.unitsWon - (10 / 11 - 1)) < 1e-9);
  assert.ok(Math.abs(s.roi - s.unitsWon / 3) < 1e-9);
});

test("aggregateRows: pending rows count toward samples but not toward resolved/ROI/winRate", () => {
  const rows: AggregatorRow[] = [
    baseRow({ result: "pending" }),
    baseRow({ result: "pending" }),
  ];
  const s = aggregateRows(rows);
  assert.equal(s.samples, 2);
  assert.equal(s.pending, 2);
  assert.equal(s.resolved, 0);
  assert.equal(s.roi, 0);
  assert.equal(s.winRate, 0);
});

test("aggregateRows: CLV outliers (>20pp) are excluded; mean and hit rate use clean rows only", () => {
  const rows: AggregatorRow[] = [
    baseRow({ clvImpliedDelta: 0.01 }),
    baseRow({ clvImpliedDelta: -0.02 }),
    baseRow({ clvImpliedDelta: 0.05 }),
    // outlier — corrupt snapshot, must not poison the mean
    baseRow({ clvImpliedDelta: 0.5 }),
    // null — pre-CLV writeback, must not count
    baseRow({ clvImpliedDelta: null }),
  ];
  const s = aggregateRows(rows);
  assert.equal(s.clvSampleSize, 3);
  assert.equal(s.clvHitRate, 2 / 3);
  assert.ok(Math.abs(s.avgClv - (0.01 + -0.02 + 0.05) / 3) < 1e-9);
});

test("aggregateRows: ROI uses American-odds → decimal payout (not flat units)", () => {
  // Single +200 win → +2.0u profit. Single -150 loss → -1.0u.
  // Combined ROI = (2.0 - 1.0) / 2 = 0.5 → +50% per resolved pick.
  const rows: AggregatorRow[] = [
    baseRow({ result: "win", publishOdds: 200 }),
    baseRow({ result: "loss", publishOdds: -150 }),
  ];
  const s = aggregateRows(rows);
  assert.equal(s.unitsWon, 1);
  assert.equal(s.roi, 0.5);
});

test("aggregateByLeagueMarket: groups by league_market and produces per-tier breakdown", () => {
  const rows: AggregatorRow[] = [
    baseRow({ league: "nhl", market: "spread", tier: "A", result: "win", publishOdds: -110 }),
    baseRow({ league: "nhl", market: "spread", tier: "A", result: "loss" }),
    baseRow({ league: "nhl", market: "spread", tier: "B", result: "win", publishOdds: -110 }),
    baseRow({ league: "mlb", market: "moneyline", tier: "C", result: "push" }),
  ];
  const buckets = aggregateByLeagueMarket(rows, []);

  assert.equal(buckets.length, 2);
  const nhl = buckets.find((b) => b.league === "nhl" && b.market === "spread")!;
  const mlb = buckets.find((b) => b.league === "mlb" && b.market === "moneyline")!;

  assert.equal(nhl.total.samples, 3);
  assert.equal(nhl.byTier.A.samples, 2);
  assert.equal(nhl.byTier.A.wins, 1);
  assert.equal(nhl.byTier.A.losses, 1);
  assert.equal(nhl.byTier.B.samples, 1);
  assert.equal(nhl.byTier.B.wins, 1);
  assert.equal(nhl.byTier.C.samples, 0);

  assert.equal(mlb.total.samples, 1);
  assert.equal(mlb.byTier.C.pushes, 1);
});

test("aggregateByLeagueMarket: empty registry markets still appear with zero samples", () => {
  const buckets = aggregateByLeagueMarket([], ["nhl_spread", "mlb_moneyline"]);
  assert.equal(buckets.length, 2);
  for (const b of buckets) {
    assert.equal(b.total.samples, 0);
    assert.equal(b.byTier.A.samples, 0);
    assert.equal(b.byTier.B.samples, 0);
    assert.equal(b.byTier.C.samples, 0);
  }
});

test("aggregateByLeagueMarket: registry + extra-from-rows union (no silent drop on demoted markets)", () => {
  const rows: AggregatorRow[] = [
    baseRow({ league: "nba", market: "spread", tier: "A", result: "win", publishOdds: -110 }),
  ];
  const buckets = aggregateByLeagueMarket(rows, ["nhl_spread"]);
  // both nhl_spread (registry) and nba_spread (rows) present
  assert.equal(buckets.length, 2);
  assert.ok(buckets.some((b) => b.league === "nhl" && b.market === "spread"));
  assert.ok(buckets.some((b) => b.league === "nba" && b.market === "spread"));
});

test("renderMarkdownReport: emits headings and rows for each bucket", () => {
  const rows: AggregatorRow[] = [
    baseRow({ league: "nhl", market: "spread", tier: "A", result: "win", publishOdds: -110 }),
    baseRow({ league: "nhl", market: "spread", tier: "A", result: "loss" }),
  ];
  const md = renderMarkdownReport(aggregateByLeagueMarket(rows, ["nhl_spread"]));
  assert.match(md, /Model-Watch internal scoreboard/);
  assert.match(md, /## NHL spread/);
  assert.match(md, /Overall/);
  assert.match(md, /Tier A/);
  // 1-1 record at -110 → win rate 50%, ROI = (10/11 - 1)/2 ≈ -4.55%
  assert.match(md, /50\.0%/);
});

test("renderMarkdownReport: empty buckets produces a friendly placeholder", () => {
  const md = renderMarkdownReport([]);
  assert.match(md, /No graded rows yet/);
});

test("aggregateByLeagueMarket: omits `recent` when no recentLimit option is passed (back-compat)", () => {
  const rows: AggregatorRow[] = [
    baseRow({ result: "win", date: "2026-04-01", gameKey: "g1", pick: "home" }),
  ];
  const buckets = aggregateByLeagueMarket(rows, []);
  for (const b of buckets) {
    assert.equal(b.recent, undefined);
  }
});

test("aggregateByLeagueMarket: attaches per-bucket recent slice in input order with limit", () => {
  // Caller supplies rows pre-ordered desc by date; the aggregator just slices
  // the first N per bucket. Verify both slicing and per-bucket isolation.
  const rows: AggregatorRow[] = [
    baseRow({ league: "nhl", market: "spread", date: "2026-04-05", gameKey: "g5", pick: "home", tier: "A", result: "win", publishOdds: -110, clvImpliedDelta: 0.02 }),
    baseRow({ league: "nhl", market: "spread", date: "2026-04-04", gameKey: "g4", pick: "away", tier: "B", result: "loss", clvImpliedDelta: -0.01 }),
    baseRow({ league: "nhl", market: "spread", date: "2026-04-03", gameKey: "g3", pick: "home", tier: "A", result: "push", clvImpliedDelta: null }),
    baseRow({ league: "nhl", market: "spread", date: "2026-04-02", gameKey: "g2", pick: "away", tier: "C", result: "pending", clvImpliedDelta: null }),
    baseRow({ league: "mlb", market: "moneyline", date: "2026-04-06", gameKey: "m1", pick: "home", tier: "A", result: "win", publishOdds: 130, clvImpliedDelta: 0.04 }),
  ];
  const buckets = aggregateByLeagueMarket(rows, [], { recentLimit: 3 });

  const nhl = buckets.find((b) => b.league === "nhl" && b.market === "spread")!;
  assert.ok(nhl.recent);
  assert.equal(nhl.recent!.length, 3);
  assert.deepEqual(
    nhl.recent!.map((r) => r.gameKey),
    ["g5", "g4", "g3"]
  );
  // First row mapped end-to-end so the UI does not have to reach into the DB.
  assert.deepEqual(nhl.recent![0], {
    date: "2026-04-05",
    gameKey: "g5",
    tier: "A",
    pick: "home",
    publishOdds: -110,
    result: "win",
    clvImpliedDelta: 0.02,
  });

  // Other bucket gets its own slice — recent is per-bucket, not global.
  const mlb = buckets.find((b) => b.league === "mlb" && b.market === "moneyline")!;
  assert.equal(mlb.recent!.length, 1);
  assert.equal(mlb.recent![0].gameKey, "m1");
});

test("aggregateByLeagueMarket: registry-only buckets (no rows) get an empty recent array", () => {
  const buckets = aggregateByLeagueMarket([], ["nhl_spread"], { recentLimit: 25 });
  assert.equal(buckets.length, 1);
  assert.deepEqual(buckets[0].recent, []);
});

test("aggregateByLeagueMarket: recentLimit=0 is treated as 'do not include recent'", () => {
  const rows: AggregatorRow[] = [
    baseRow({ date: "2026-04-05", gameKey: "g1", pick: "home", result: "win" }),
  ];
  const buckets = aggregateByLeagueMarket(rows, [], { recentLimit: 0 });
  for (const b of buckets) {
    assert.equal(b.recent, undefined);
  }
});

test("aggregateByLeagueMarket: stringy publishOdds and clvImpliedDelta are coerced to numbers in recent", () => {
  // DB returns numeric columns as strings via drizzle; the recent payload
  // must be numbers so the React table can format without re-parsing.
  const rows: AggregatorRow[] = [
    baseRow({
      date: "2026-04-05",
      gameKey: "g1",
      pick: "home",
      publishOdds: "-110",
      clvImpliedDelta: "0.0125",
    }),
  ];
  const buckets = aggregateByLeagueMarket(rows, [], { recentLimit: 5 });
  const r = buckets[0].recent![0];
  assert.equal(typeof r.publishOdds, "number");
  assert.equal(r.publishOdds, -110);
  assert.equal(typeof r.clvImpliedDelta, "number");
  assert.ok(Math.abs((r.clvImpliedDelta as number) - 0.0125) < 1e-9);
});

test("aggregateByLeagueMarket: per-bucket recent does NOT alter aggregate stats", () => {
  // Same rows aggregated with and without recentLimit should produce
  // identical totals/per-tier breakdowns. Locks in that the recent slice
  // is purely additive.
  const rows: AggregatorRow[] = [
    baseRow({ tier: "A", result: "win", publishOdds: -110, date: "2026-04-05", gameKey: "g1", pick: "home" }),
    baseRow({ tier: "B", result: "loss", date: "2026-04-04", gameKey: "g2", pick: "away" }),
  ];
  const a = aggregateByLeagueMarket(rows, []);
  const b = aggregateByLeagueMarket(rows, [], { recentLimit: 25 });
  assert.deepEqual(a[0].total, b[0].total);
  assert.deepEqual(a[0].byTier, b[0].byTier);
});
