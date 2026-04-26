import { test } from "node:test";
import assert from "node:assert/strict";

import { computeMonotonicityReport } from "../monotonicity";
import type { AggregatorRow } from "../modelWatchAggregator";

function row(overrides: Partial<AggregatorRow>): AggregatorRow {
  return {
    league: "nba",
    market: "spread",
    tier: "B",
    publishOdds: -110,
    edge: 0.05,
    ev: 0.04,
    result: "pending",
    clvImpliedDelta: null,
    ...overrides,
  };
}

test("monotonicity: empty rows → empty buckets, monotonic vacuously true, correlations null", () => {
  const r = computeMonotonicityReport([], 4);
  assert.deepEqual(r.buckets, []);
  assert.equal(r.isMonotonicWinRate, true);
  assert.equal(r.isMonotonicRoi, true);
  assert.equal(r.edgeWinRateCorrelation, null);
  assert.equal(r.edgeRoiCorrelation, null);
});

test("monotonicity: bucketCount < 2 → empty buckets (no meaningful split)", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    row({ edge: 0.01 * (i + 1), result: "win" }),
  );
  const r = computeMonotonicityReport(rows, 1);
  assert.deepEqual(r.buckets, []);
});

test("monotonicity: equal-frequency split — 12 rows / 4 buckets → 3 each", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row({ edge: 0.01 * (i + 1), result: i % 2 === 0 ? "win" : "loss" }),
  );
  const r = computeMonotonicityReport(rows, 4);
  assert.equal(r.buckets.length, 4);
  for (const b of r.buckets) assert.equal(b.n, 3);
  // Bucket 1 = highest edges; rows are ranked by edge desc, so bucket 1
  // contains edges 0.10, 0.11, 0.12.
  assert.ok(Math.abs(r.buckets[0].minEdge - 0.10) < 1e-9);
  assert.ok(Math.abs(r.buckets[0].maxEdge - 0.12) < 1e-9);
  // Bucket 4 = lowest edges 0.01, 0.02, 0.03.
  assert.ok(Math.abs(r.buckets[3].minEdge - 0.01) < 1e-9);
  assert.ok(Math.abs(r.buckets[3].maxEdge - 0.03) < 1e-9);
});

test("monotonicity: perfectly monotonic — high edge → high win rate", () => {
  // Bucket 1 (highest edge): all wins. Bucket 4 (lowest edge): all losses.
  // Construct 8 rows: top 4 win, bottom 4 lose.
  const rows: AggregatorRow[] = [];
  for (let i = 0; i < 4; i++) rows.push(row({ edge: 0.10 + i * 0.01, result: "win" }));
  for (let i = 0; i < 4; i++) rows.push(row({ edge: 0.01 + i * 0.01, result: "loss" }));
  const r = computeMonotonicityReport(rows, 4, { minResolvedPerBucket: 1 });
  assert.equal(r.buckets.length, 4);
  assert.equal(r.isMonotonicWinRate, true);
  assert.equal(r.isMonotonicRoi, true);
  // All-wins bucket has winRate 1; all-losses bucket has winRate 0.
  assert.equal(r.buckets[0].stats.winRate, 1);
  assert.equal(r.buckets[3].stats.winRate, 0);
  // edge↑ correlates positively with winRate↑. Pearson on a clean step-
  // function vs linear edge midpoints maxes out around 0.97, not 1.0;
  // anything above 0.9 is unambiguous "high edge tracks high win rate".
  assert.ok(r.edgeWinRateCorrelation !== null);
  assert.ok(r.edgeWinRateCorrelation > 0.9);
});

test("monotonicity: inverted — high edge → low win rate flags isMonotonic=false and negative correlation", () => {
  const rows: AggregatorRow[] = [];
  // Top edges all lose, bottom edges all win — inversion.
  for (let i = 0; i < 4; i++) rows.push(row({ edge: 0.10 + i * 0.01, result: "loss" }));
  for (let i = 0; i < 4; i++) rows.push(row({ edge: 0.01 + i * 0.01, result: "win" }));
  const r = computeMonotonicityReport(rows, 4, { minResolvedPerBucket: 1 });
  assert.equal(r.isMonotonicWinRate, false);
  assert.ok(r.edgeWinRateCorrelation !== null);
  assert.ok(r.edgeWinRateCorrelation < -0.9);
});

test("monotonicity: warnings emitted when bucket has too few resolved samples", () => {
  // 8 rows, all pending → every bucket has 0 resolved.
  const rows = Array.from({ length: 8 }, (_, i) =>
    row({ edge: 0.01 * (i + 1), result: "pending" }),
  );
  const r = computeMonotonicityReport(rows, 4, { minResolvedPerBucket: 5 });
  assert.equal(r.warnings.length, 4);
  for (const w of r.warnings) assert.ok(w.includes("only 0 resolved sample"));
  // No decided buckets → vacuously monotonic, correlations null.
  assert.equal(r.isMonotonicWinRate, true);
  assert.equal(r.edgeWinRateCorrelation, null);
});

test("monotonicity: pushes are not 'decided' but still counted in n", () => {
  const rows: AggregatorRow[] = [];
  for (let i = 0; i < 4; i++) rows.push(row({ edge: 0.10, result: "push" }));
  for (let i = 0; i < 4; i++) rows.push(row({ edge: 0.05, result: "win" }));
  const r = computeMonotonicityReport(rows, 2, { minResolvedPerBucket: 1 });
  assert.equal(r.buckets.length, 2);
  assert.equal(r.buckets[0].n, 4);
  assert.equal(r.buckets[1].n, 4);
  // Bucket 0 (all pushes) has 0 wins+losses → not in decidedBuckets.
  // Bucket 1 (all wins) has 4 decided. Decided count = 1 → no inversion possible.
  assert.equal(r.isMonotonicWinRate, true);
});

test("monotonicity: rows with non-finite edge are silently dropped", () => {
  const rows: AggregatorRow[] = [
    row({ edge: Number.NaN, result: "win" }),
    row({ edge: "not a number", result: "win" }),
    row({ edge: 0.10, result: "win" }),
    row({ edge: 0.05, result: "loss" }),
  ];
  const r = computeMonotonicityReport(rows, 2, { minResolvedPerBucket: 1 });
  // Only 2 valid rows → 1 per bucket.
  assert.equal(r.buckets.length, 2);
  assert.equal(r.buckets[0].n, 1);
  assert.equal(r.buckets[1].n, 1);
});

test("monotonicity: numeric-string edge works (matches DB numeric column shape)", () => {
  const rows: AggregatorRow[] = [
    row({ edge: "0.10", result: "win" }),
    row({ edge: "0.08", result: "win" }),
    row({ edge: "0.05", result: "loss" }),
    row({ edge: "0.02", result: "loss" }),
  ];
  const r = computeMonotonicityReport(rows, 2, { minResolvedPerBucket: 1 });
  assert.equal(r.buckets.length, 2);
  assert.equal(r.buckets[0].stats.winRate, 1);
  assert.equal(r.buckets[1].stats.winRate, 0);
});
