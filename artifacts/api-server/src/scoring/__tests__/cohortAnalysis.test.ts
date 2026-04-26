import { test } from "node:test";
import assert from "node:assert/strict";

import {
  summarizeCohorts,
  type CohortInputRow,
} from "../cohortAnalysis";

function row(overrides: Partial<CohortInputRow>): CohortInputRow {
  return {
    league: "nhl",
    market: "spread",
    tier: "A",
    date: "2026-04-15",
    publishOdds: -110,
    edge: 0.05,
    ev: 0.04,
    result: "win",
    clvImpliedDelta: 0.01,
    modelProbCalibrated: 0.55,
    marketProbFair: 0.50,
    dataQuality: null,
    ...overrides,
  };
}

test("summarizeCohorts: empty rows → empty buckets, zero counters", () => {
  const r = summarizeCohorts([], { cutoffs: {} });
  assert.equal(r.totalRows, 0);
  assert.equal(r.totalFlagged, 0);
  assert.deepEqual(r.cutoffs, {});
  assert.deepEqual(r.buckets, []);
  assert.ok(typeof r.generatedAt === "string");
});

test("summarizeCohorts: PRE/POST split uses lex compare on YYYY-MM-DD vs cutoff", () => {
  const rows = [
    row({ date: "2026-04-10", result: "loss" }), // PRE (before 04-12)
    row({ date: "2026-04-11", result: "loss" }), // PRE
    row({ date: "2026-04-12", result: "win" }),  // POST (cutoff is INCLUSIVE of POST)
    row({ date: "2026-04-15", result: "win" }),  // POST
  ];
  const r = summarizeCohorts(rows, { cutoffs: { nhl: "2026-04-12" } });
  const post = r.buckets.find((b) => b.cohort === "POST");
  const pre = r.buckets.find((b) => b.cohort === "PRE");
  assert.ok(post && pre);
  assert.equal(post.stats.samples, 2);
  assert.equal(post.stats.wins, 2);
  assert.equal(pre.stats.samples, 2);
  assert.equal(pre.stats.losses, 2);
  assert.equal(post.cutoff, "2026-04-12");
  assert.equal(pre.cutoff, "2026-04-12");
  assert.deepEqual(r.cutoffs, { nhl: "2026-04-12" });
});

test("summarizeCohorts: leagues without a cutoff → all POST (no PRE bucket)", () => {
  const rows = [
    row({ league: "mlb", date: "2025-01-01", result: "win" }),
    row({ league: "mlb", date: "2026-12-31", result: "loss" }),
  ];
  const r = summarizeCohorts(rows, { cutoffs: { nhl: "2026-04-12" } });
  assert.equal(r.buckets.length, 1);
  assert.equal(r.buckets[0].cohort, "POST");
  assert.equal(r.buckets[0].cutoff, null);
  assert.equal(r.buckets[0].stats.samples, 2);
  // cutoffsUsed should NOT include mlb (no cutoff was looked up for it).
  assert.deepEqual(r.cutoffs, {});
});

test("summarizeCohorts: flagged rows are kept as their OWN bucket, not removed", () => {
  const rows = [
    // 3 clean POST wins
    row({ date: "2026-04-15", result: "win", dataQuality: null }),
    row({ date: "2026-04-16", result: "win", dataQuality: null }),
    row({ date: "2026-04-17", result: "win", dataQuality: null }),
    // 2 flagged POST losses (e.g. contaminated ingest still in production)
    row({ date: "2026-04-15", result: "loss", dataQuality: "contaminated_ingest" }),
    row({ date: "2026-04-16", result: "loss", dataQuality: "contaminated_ingest" }),
  ];
  const r = summarizeCohorts(rows, { cutoffs: { nhl: "2026-04-12" } });
  assert.equal(r.totalRows, 5);
  assert.equal(r.totalFlagged, 2);
  // Two buckets, distinguishable by .quality.
  const clean = r.buckets.find((b) => b.quality === "clean");
  const flagged = r.buckets.find((b) => b.quality === "flagged");
  assert.ok(clean && flagged);
  assert.equal(clean.stats.samples, 3);
  assert.equal(clean.stats.wins, 3);
  assert.equal(flagged.stats.samples, 2);
  assert.equal(flagged.stats.losses, 2);
  // Flagged bucket stats are NOT mixed into clean bucket — that is the
  // entire point of "shown as flagged, not silently removed".
  assert.equal(clean.stats.losses, 0);
});

test("summarizeCohorts: separate league_market keys produce separate buckets", () => {
  const rows = [
    row({ league: "nba", market: "spread", date: "2026-04-15" }),
    row({ league: "nba", market: "moneyline", date: "2026-04-15" }),
    row({ league: "nhl", market: "spread", date: "2026-04-15" }),
  ];
  const r = summarizeCohorts(rows, { cutoffs: {} });
  assert.equal(r.buckets.length, 3);
  const keys = r.buckets.map((b) => `${b.league}_${b.market}`).sort();
  assert.deepEqual(keys, ["nba_moneyline", "nba_spread", "nhl_spread"]);
});

test("summarizeCohorts: market keys with multiple underscores are preserved", () => {
  const rows = [row({ league: "nba", market: "first_half_total" })];
  const r = summarizeCohorts(rows, { cutoffs: {} });
  assert.equal(r.buckets[0].league, "nba");
  assert.equal(r.buckets[0].market, "first_half_total");
});

test("summarizeCohorts: brierModel and brierMarket reflect per-row probs and outcomes", () => {
  // Two POST rows, one perfect-model win one perfect-model loss.
  // model probs: 1.0 win, 0.0 loss → model brier = 0
  // market probs: 0.5 each → market brier = 0.25
  // brierSkill = 1 - 0/0.25 = 1.0
  const rows = [
    row({
      date: "2026-04-15",
      result: "win",
      modelProbCalibrated: 1.0,
      marketProbFair: 0.5,
    }),
    row({
      date: "2026-04-16",
      result: "loss",
      modelProbCalibrated: 0.0,
      marketProbFair: 0.5,
    }),
  ];
  const r = summarizeCohorts(rows, { cutoffs: {} });
  const b = r.buckets[0];
  assert.equal(b.brierModel, 0);
  assert.equal(b.brierMarket, 0.25);
  assert.equal(b.brierSkill, 1);
});

test("summarizeCohorts: pushes / pending excluded from Brier; null when no decided rows", () => {
  const rows = [
    row({ date: "2026-04-15", result: "push" }),
    row({ date: "2026-04-16", result: "pending" }),
  ];
  const r = summarizeCohorts(rows, { cutoffs: {} });
  const b = r.buckets[0];
  assert.equal(b.stats.samples, 2);
  assert.equal(b.brierModel, null);
  assert.equal(b.brierMarket, null);
  assert.equal(b.brierSkill, null);
});

test("summarizeCohorts: monotonicity report attached per bucket and uses bucket's rows only", () => {
  // Fill one bucket (POST nhl_spread) with 8 rows that show edge↔winRate
  // monotonicity, and verify isMonotonic is set on THAT bucket.
  const rows: CohortInputRow[] = [];
  for (let i = 0; i < 4; i++) {
    rows.push(row({ date: "2026-04-15", edge: 0.10 + i * 0.01, result: "win" }));
  }
  for (let i = 0; i < 4; i++) {
    rows.push(row({ date: "2026-04-15", edge: 0.01 + i * 0.01, result: "loss" }));
  }
  const r = summarizeCohorts(rows, {
    cutoffs: { nhl: "2026-04-12" },
    monotonicityBuckets: 4,
  });
  const b = r.buckets[0];
  assert.equal(b.monotonicity.buckets.length, 4);
  assert.equal(b.monotonicity.isMonotonicWinRate, true);
  assert.ok(b.monotonicity.edgeWinRateCorrelation !== null);
  assert.ok(b.monotonicity.edgeWinRateCorrelation > 0.9);
});

test("summarizeCohorts: numeric-string columns parse correctly (drizzle numeric default)", () => {
  const rows = [
    row({
      result: "win",
      modelProbCalibrated: "0.6",
      marketProbFair: "0.5",
      edge: "0.05",
      ev: "0.04",
      publishOdds: "-110",
      clvImpliedDelta: "0.02",
    }),
    row({
      result: "loss",
      modelProbCalibrated: "0.4",
      marketProbFair: "0.5",
      edge: "0.03",
      ev: "0.02",
      publishOdds: "-110",
      clvImpliedDelta: "-0.01",
    }),
  ];
  const r = summarizeCohorts(rows, { cutoffs: {} });
  const b = r.buckets[0];
  // model brier = ((0.6 - 1)^2 + (0.4 - 0)^2) / 2 = (0.16 + 0.16) / 2 = 0.16
  assert.ok(b.brierModel !== null);
  assert.ok(Math.abs(b.brierModel - 0.16) < 1e-9);
  // market brier = ((0.5 - 1)^2 + (0.5 - 0)^2) / 2 = 0.25
  assert.ok(b.brierMarket !== null);
  assert.ok(Math.abs(b.brierMarket - 0.25) < 1e-9);
  // brierSkill = 1 - 0.16/0.25 = 0.36
  assert.ok(b.brierSkill !== null);
  assert.ok(Math.abs(b.brierSkill - 0.36) < 1e-9);
});

test("summarizeCohorts: bucket order is league_market asc, POST before PRE, clean before flagged", () => {
  const rows = [
    row({ league: "nhl", market: "spread", date: "2026-04-10", dataQuality: null }),         // nhl_spread PRE clean
    row({ league: "nhl", market: "spread", date: "2026-04-15", dataQuality: null }),         // nhl_spread POST clean
    row({ league: "nhl", market: "spread", date: "2026-04-15", dataQuality: "contaminated_ingest" }), // nhl_spread POST flagged
    row({ league: "nba", market: "spread", date: "2026-04-15", dataQuality: null }),         // nba_spread POST clean
  ];
  const r = summarizeCohorts(rows, {
    cutoffs: { nhl: "2026-04-12", nba: "2026-04-12" },
  });
  const order = r.buckets.map(
    (b) => `${b.league}_${b.market}|${b.cohort}|${b.quality}`,
  );
  assert.deepEqual(order, [
    "nba_spread|POST|clean",
    "nhl_spread|POST|clean",
    "nhl_spread|POST|flagged",
    "nhl_spread|PRE|clean",
  ]);
});
