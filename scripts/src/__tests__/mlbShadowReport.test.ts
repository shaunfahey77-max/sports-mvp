import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  edgeDistribution,
  calibrationBuckets,
  overallSettlement,
  dailyBuckets,
  type CandidateRow,
  type SurfacedRow,
} from "../mlbShadowReport";

function cand(o: Partial<CandidateRow> = {}): CandidateRow {
  return {
    snapshotDate: "2026-04-21",
    gameKey: "mlb_2026-04-21_x_y",
    marketType: "moneyline",
    side: "home",
    publishOdds: -110,
    modelProbCalibrated: 0.55,
    marketProbFair: 0.5238,
    edge: 0.026,
    ev: 0.011,
    tier: "PASS",
    selectionReason: "insufficient_edge",
    ...o,
  };
}

function surf(o: Partial<SurfacedRow> = {}): SurfacedRow {
  return {
    date: "2026-04-21",
    market: "moneyline",
    pick: "home",
    result: "pending",
    publishOdds: -110,
    modelProbCalibrated: 0.55,
    edge: 0.026,
    tier: "B",
    ...o,
  };
}

describe("mlbShadowReport metrics", () => {
  it("edgeDistribution returns zeros on empty input", () => {
    const e = edgeDistribution([]);
    assert.equal(e.n, 0);
    assert.equal(e.histogram.length, 0);
  });

  it("edgeDistribution buckets edges into the documented bins", () => {
    const rows: CandidateRow[] = [
      cand({ edge: -0.05 }),
      cand({ edge: -0.01 }),
      cand({ edge: 0.01 }),
      cand({ edge: 0.03 }),
      cand({ edge: 0.07 }),
      cand({ edge: 0.15 }),
      cand({ edge: 0.25 }),
    ];
    const e = edgeDistribution(rows);
    assert.equal(e.n, 7);
    assert.equal(e.min, -0.05);
    assert.equal(e.max, 0.25);
    const counts = Object.fromEntries(e.histogram.map((h) => [h.bucket, h.count]));
    assert.equal(counts["<-0.02"], 1);
    assert.equal(counts["-0.02..0"], 1);
    assert.equal(counts["0..0.02"], 1);
    assert.equal(counts["0.02..0.05"], 1);
    assert.equal(counts["0.05..0.10"], 1);
    assert.equal(counts["0.10..0.20"], 1);
    assert.equal(counts[">=0.20"], 1);
  });

  it("overallSettlement counts wins/losses/pushes and computes ROI", () => {
    const rows: SurfacedRow[] = [
      surf({ result: "win", publishOdds: 100 }),    // +1.00 unit
      surf({ result: "win", publishOdds: -110 }),   // +0.909 units
      surf({ result: "loss", publishOdds: -110 }),  // -1.00 unit
      surf({ result: "push" }),
      surf({ result: "pending" }),
    ];
    const o = overallSettlement(rows);
    assert.equal(o.total, 5);
    assert.equal(o.resolved, 4);
    assert.equal(o.pending, 1);
    assert.equal(o.wins, 2);
    assert.equal(o.losses, 1);
    assert.equal(o.pushes, 1);
    assert.equal(o.winRate, 2 / 3); // pushes excluded from wr denominator
    assert.ok(Math.abs(o.unitsWon - (1.0 + 100 / 110 - 1.0)) < 1e-9);
    assert.ok(o.brierScore >= 0 && o.brierScore <= 1);
  });

  it("overallSettlement Brier excludes pushes from the denominator", () => {
    // Two binary resolved + one push. Brier should be average over the two
    // binary rows only — push's modelProb of 0.50 should not contribute.
    const rows: SurfacedRow[] = [
      surf({ modelProbCalibrated: 0.6, result: "win" }),  // (0.6-1)^2 = 0.16
      surf({ modelProbCalibrated: 0.4, result: "loss" }), // (0.4-0)^2 = 0.16
      surf({ modelProbCalibrated: 0.5, result: "push" }), // excluded
    ];
    const o = overallSettlement(rows);
    assert.equal(o.resolved, 3);
    assert.ok(Math.abs(o.brierScore - 0.16) < 1e-9, `brier=${o.brierScore}`);
  });

  it("edgeDistribution percentiles use linear interpolation", () => {
    // For [10,20,30,40,50], p25 = 20, p50 = 30, p75 = 40 under linear interp.
    const rows = [10, 20, 30, 40, 50].map((e) => cand({ edge: e }));
    const e = edgeDistribution(rows);
    assert.equal(e.p25, 20);
    assert.equal(e.p50, 30);
    assert.equal(e.p75, 40);
  });

  it("calibrationBuckets includes a model_prob of exactly 1.0 in the final bucket", () => {
    const rows: SurfacedRow[] = [
      surf({ modelProbCalibrated: 1.0, result: "win" }),
    ];
    const b = calibrationBuckets(rows);
    const last = b[b.length - 1];
    assert.equal(last.rangeLow, 0.7);
    assert.equal(last.rangeHigh, 1.0);
    assert.equal(last.count, 1);
    assert.equal(last.resolvedCount, 1);
    assert.equal(last.realizedWinRate, 1);
  });

  it("calibrationBuckets only counts wins/losses in realized rate, not pushes", () => {
    const rows: SurfacedRow[] = [
      surf({ modelProbCalibrated: 0.52, result: "win" }),
      surf({ modelProbCalibrated: 0.53, result: "loss" }),
      surf({ modelProbCalibrated: 0.54, result: "push" }),
      surf({ modelProbCalibrated: 0.51, result: "pending" }),
    ];
    const b = calibrationBuckets(rows);
    const target = b.find((x) => x.rangeLow === 0.5 && x.rangeHigh === 0.55);
    assert.ok(target);
    assert.equal(target!.count, 4);
    assert.equal(target!.resolvedCount, 2);
    assert.equal(target!.realizedWinRate, 0.5);
  });

  it("dailyBuckets joins candidates and surfaced rows by date", () => {
    const cs: CandidateRow[] = [
      cand({ snapshotDate: "2026-04-21", edge: 0.01 }),
      cand({ snapshotDate: "2026-04-21", edge: 0.03 }),
      cand({ snapshotDate: "2026-04-22", edge: 0.05 }),
    ];
    const ss: SurfacedRow[] = [
      surf({ date: "2026-04-21", result: "win", publishOdds: 100 }),
      surf({ date: "2026-04-22", result: "loss", publishOdds: -110 }),
    ];
    const d = dailyBuckets(cs, ss);
    assert.equal(d.length, 2);
    const day1 = d.find((x) => x.date === "2026-04-21")!;
    assert.equal(day1.candidates, 2);
    assert.equal(day1.surfaced, 1);
    assert.equal(day1.wins, 1);
    assert.ok(Math.abs(day1.avgCandidateEdge - 0.02) < 1e-9);
    const day2 = d.find((x) => x.date === "2026-04-22")!;
    assert.equal(day2.candidates, 1);
    assert.equal(day2.surfaced, 1);
    assert.equal(day2.losses, 1);
  });

  it("dailyBuckets handles a day with candidates but no surfaced picks", () => {
    const cs: CandidateRow[] = [cand({ snapshotDate: "2026-04-22" })];
    const ss: SurfacedRow[] = [];
    const d = dailyBuckets(cs, ss);
    assert.equal(d.length, 1);
    assert.equal(d[0].candidates, 1);
    assert.equal(d[0].surfaced, 0);
    assert.equal(d[0].settled, 0);
  });
});
