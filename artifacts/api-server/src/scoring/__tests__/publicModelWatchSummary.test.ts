import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectFavoredSidePerGame,
  summarizeModelWatchRows,
  type AggregatorRow,
} from "../modelWatchAggregator";
import { GetPerformanceModelWatchResponse } from "@workspace/api-zod";

/**
 * `summarizeModelWatchRows` is the only piece of logic the public
 * `/performance/model-watch` endpoint owns on top of `aggregateRows`.
 * The route itself is a thin DB read + summarize + json. Locking the
 * summarize behaviour here pins the public surface so it can never
 * silently drift from the admin scoreboard or the OpenAPI contract.
 *
 * The wall between Official and Watch is preserved by always
 * exercising rows that look like model_watch_results — never
 * scored_picks. The test below also feeds the output through the
 * generated Zod response schema so OpenAPI drift fails the test loud.
 */

const baseRow = (over: Partial<AggregatorRow>): AggregatorRow => ({
  league: "nhl",
  market: "spread",
  tier: "A",
  publishOdds: -110,
  edge: 0.05,
  ev: 0.02,
  result: "win",
  clvImpliedDelta: 0.01,
  ...over,
});

const REGISTRY: Partial<Record<string, boolean>> = {
  nhl_spread: true,
  mlb_moneyline: true,
  nhl_total: true,
  nba_spread: true,
};

test("summarizeModelWatchRows: empty input emits zeroed stats; totalRegistryMarkets reflects the registry", () => {
  const s = summarizeModelWatchRows([], REGISTRY);
  assert.equal(s.leansGraded, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.meanClv, 0);
  assert.equal(s.clvSampleSize, 0);
  assert.equal(s.activeMarkets, 0);
  // 4 truthy entries in REGISTRY
  assert.equal(s.totalRegistryMarkets, 4);
});

test("summarizeModelWatchRows: leansGraded counts wins + losses + pushes (pending excluded)", () => {
  // The route filters pending out at the SQL layer; this test pins the
  // pure summarizer's denominator independently so the contract is
  // self-consistent even if the SQL filter were ever loosened.
  const rows: AggregatorRow[] = [
    baseRow({ result: "win" }),
    baseRow({ result: "loss" }),
    baseRow({ result: "push" }),
    baseRow({ result: "pending" }),
  ];
  const s = summarizeModelWatchRows(rows, REGISTRY);
  assert.equal(s.leansGraded, 3);
  // 1/(1+1) — push & pending excluded from win-rate denominator
  assert.equal(s.winRate, 0.5);
});

test("summarizeModelWatchRows: meanClv / clvSampleSize apply the same |delta| <= 0.20 filter as Official", () => {
  const rows: AggregatorRow[] = [
    baseRow({ clvImpliedDelta: 0.01 }),
    baseRow({ clvImpliedDelta: -0.02 }),
    baseRow({ clvImpliedDelta: 0.05 }),
    // outlier — corrupt snapshot, must not poison the public mean
    baseRow({ clvImpliedDelta: 0.5 }),
    // null — pre-CLV writeback, must not count
    baseRow({ clvImpliedDelta: null }),
  ];
  const s = summarizeModelWatchRows(rows, REGISTRY);
  assert.equal(s.clvSampleSize, 3);
  assert.ok(Math.abs(s.meanClv - (0.01 + -0.02 + 0.05) / 3) < 1e-9);
});

test("summarizeModelWatchRows: activeMarkets only counts distinct league_market keys present in the registry", () => {
  // Two registry markets with rows + one demoted-out market (nba_total)
  // that should be ignored. Two rows on nhl_spread should NOT inflate
  // the count past 1.
  const rows: AggregatorRow[] = [
    baseRow({ league: "nhl", market: "spread", result: "win" }),
    baseRow({ league: "nhl", market: "spread", result: "loss" }),
    baseRow({ league: "mlb", market: "moneyline", result: "win", publishOdds: 130 }),
    // not in registry — must be excluded from activeMarkets
    baseRow({ league: "nba", market: "total", result: "win" }),
  ];
  const s = summarizeModelWatchRows(rows, REGISTRY);
  assert.equal(s.activeMarkets, 2);
  assert.equal(s.totalRegistryMarkets, 4);
});

test("summarizeModelWatchRows: totalRegistryMarkets ignores falsy registry entries", () => {
  // Mirrors the Partial<Record<string, boolean>> shape — falsy entries
  // (false, undefined) must not bump the denominator.
  const reg: Partial<Record<string, boolean>> = {
    nhl_spread: true,
    mlb_moneyline: true,
    legacy_disabled: false,
    legacy_undefined: undefined,
  };
  const s = summarizeModelWatchRows([], reg);
  assert.equal(s.totalRegistryMarkets, 2);
});

test("summarizeModelWatchRows: ROI / units / per-tier are NOT exposed (public surface stays narrow)", () => {
  const rows: AggregatorRow[] = [
    baseRow({ result: "win", publishOdds: 200, clvImpliedDelta: 0.04 }),
    baseRow({ result: "loss", publishOdds: -150, clvImpliedDelta: -0.01 }),
  ];
  const s = summarizeModelWatchRows(rows, REGISTRY);
  // Pin the exact key set: any new field must be added deliberately
  // (and to the OpenAPI contract) — never leaked by accident.
  assert.deepEqual(
    Object.keys(s).sort(),
    [
      "activeMarkets",
      "clvSampleSize",
      "leansGraded",
      "meanClv",
      "totalRegistryMarkets",
      "winRate",
    ],
  );
});

test("selectFavoredSidePerGame: collapses a complementary home/away pair down to the model-favored side", () => {
  // Both rows for the same game/market — the scorer writes both sides
  // for every Watch market. Probabilities are complementary
  // (0.55 home / 0.45 away). The dedup must keep the home row.
  const rows: AggregatorRow[] = [
    {
      league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: -120, edge: 0.01, ev: 0, result: "win",
      clvImpliedDelta: 0.005,
      gameKey: "mlb_2026-04-28_sea_min", pick: "home",
      modelProbCalibrated: 0.55,
    },
    {
      league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: 110, edge: -0.01, ev: 0, result: "loss",
      clvImpliedDelta: -0.005,
      gameKey: "mlb_2026-04-28_sea_min", pick: "away",
      modelProbCalibrated: 0.45,
    },
  ];
  const out = selectFavoredSidePerGame(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].pick, "home");
  assert.equal(out[0].result, "win");
});

test("selectFavoredSidePerGame: rows lacking gameKey or modelProbCalibrated pass through untouched", () => {
  // Synthetic-fixture rows must NOT be silently dropped by the dedup —
  // every existing test that builds rows without these fields relies on
  // them being aggregated as-is.
  const rows: AggregatorRow[] = [
    { league: "nhl", market: "spread", tier: "A",
      publishOdds: -110, edge: 0.05, ev: 0.02, result: "win",
      clvImpliedDelta: 0.01 },
    { league: "nhl", market: "spread", tier: "A",
      publishOdds: -110, edge: 0.05, ev: 0.02, result: "loss",
      clvImpliedDelta: -0.01 },
    // gameKey present but modelProbCalibrated missing — also passthrough
    { league: "nhl", market: "spread", tier: "A",
      publishOdds: -110, edge: 0.05, ev: 0.02, result: "push",
      clvImpliedDelta: 0,
      gameKey: "nhl_2026-04-28_x_y", pick: "home" },
  ];
  const out = selectFavoredSidePerGame(rows);
  assert.equal(out.length, 3);
});

test("selectFavoredSidePerGame: ties keep the first-seen row (Map insertion order)", () => {
  // Both sides at exactly 0.5 is a degenerate market state but
  // shouldn't crash; we keep whichever side arrived first.
  const rows: AggregatorRow[] = [
    { league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: -100, edge: 0, ev: 0, result: "win",
      clvImpliedDelta: 0,
      gameKey: "mlb_2026-04-28_a_b", pick: "home", modelProbCalibrated: 0.5 },
    { league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: -100, edge: 0, ev: 0, result: "loss",
      clvImpliedDelta: 0,
      gameKey: "mlb_2026-04-28_a_b", pick: "away", modelProbCalibrated: 0.5 },
  ];
  const out = selectFavoredSidePerGame(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].pick, "home");
});

test("selectFavoredSidePerGame: groups are scoped per (gameKey, league, market) — different markets stay separate", () => {
  const rows: AggregatorRow[] = [
    // Same gameKey, different market — must NOT collapse together.
    { league: "nhl", market: "spread", tier: "A",
      publishOdds: -110, edge: 0.04, ev: 0.02, result: "win",
      clvImpliedDelta: 0.01,
      gameKey: "nhl_2026-04-28_col_lak", pick: "home", modelProbCalibrated: 0.6 },
    { league: "nhl", market: "total", tier: "A",
      publishOdds: -105, edge: 0.03, ev: 0.01, result: "loss",
      clvImpliedDelta: -0.01,
      gameKey: "nhl_2026-04-28_col_lak", pick: "over", modelProbCalibrated: 0.55 },
  ];
  const out = selectFavoredSidePerGame(rows);
  assert.equal(out.length, 2);
});

test("summarizeModelWatchRows: applies favored-side dedup so paired home/away rows do not pin winRate at 0.5", () => {
  // Two games, each with a home/away pair. Model favors home in BOTH
  // games; home wins the first, loses the second. Without dedup we'd
  // see 2 wins / 2 losses (50%); with dedup we see 1 win / 1 loss
  // (also 50% in this contrived case, but leansGraded must be 2 not 4).
  const rows: AggregatorRow[] = [
    // Game 1 — favored home wins
    { league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: -120, edge: 0.01, ev: 0, result: "win",
      clvImpliedDelta: 0.01,
      gameKey: "mlb_2026-04-28_sea_min", pick: "home", modelProbCalibrated: 0.55 },
    { league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: 110, edge: -0.01, ev: 0, result: "loss",
      clvImpliedDelta: -0.01,
      gameKey: "mlb_2026-04-28_sea_min", pick: "away", modelProbCalibrated: 0.45 },
    // Game 2 — favored home loses
    { league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: -130, edge: 0.02, ev: 0, result: "loss",
      clvImpliedDelta: -0.02,
      gameKey: "mlb_2026-04-28_det_atl", pick: "home", modelProbCalibrated: 0.58 },
    { league: "mlb", market: "moneyline", tier: "PASS",
      publishOdds: 120, edge: -0.02, ev: 0, result: "win",
      clvImpliedDelta: 0.02,
      gameKey: "mlb_2026-04-28_det_atl", pick: "away", modelProbCalibrated: 0.42 },
  ];
  const REGISTRY: Partial<Record<string, boolean>> = {
    mlb_moneyline: true, nhl_spread: true, nhl_total: true, nba_spread: true,
  };
  const s = summarizeModelWatchRows(rows, REGISTRY);
  // 4 raw rows → 2 favored-side rows after dedup
  assert.equal(s.leansGraded, 2);
  // 1 win / 1 loss across the favored sides
  assert.equal(s.winRate, 0.5);
  assert.equal(s.activeMarkets, 1);
});

test("summarizeModelWatchRows: favored side genuinely changes winRate when the model is right more often than 50%", () => {
  // Model favors home in 3 games; home wins all 3. Raw rows would be
  // 3 wins / 3 losses (50%). Favored-side dedup should give 3/0 = 100%.
  const rows: AggregatorRow[] = [];
  for (const gk of ["g1", "g2", "g3"]) {
    rows.push({
      league: "nhl", market: "spread", tier: "PASS",
      publishOdds: -110, edge: 0.04, ev: 0.02, result: "win",
      clvImpliedDelta: 0.01,
      gameKey: gk, pick: "home", modelProbCalibrated: 0.6,
    });
    rows.push({
      league: "nhl", market: "spread", tier: "PASS",
      publishOdds: -110, edge: -0.04, ev: -0.02, result: "loss",
      clvImpliedDelta: -0.01,
      gameKey: gk, pick: "away", modelProbCalibrated: 0.4,
    });
  }
  const s = summarizeModelWatchRows(rows, { nhl_spread: true });
  assert.equal(s.leansGraded, 3);
  assert.equal(s.winRate, 1);
});

test("GetPerformanceModelWatchResponse contract: summarize output + windowDays parses cleanly through the generated Zod schema", () => {
  // Wire the summarizer's output through the OpenAPI-generated Zod
  // schema. If the route shape ever drifts from the spec (or vice-versa),
  // this fails loudly here instead of silently in the wild.
  const summary = summarizeModelWatchRows(
    [
      baseRow({ result: "win", clvImpliedDelta: 0.02 }),
      baseRow({ result: "loss", clvImpliedDelta: -0.01 }),
      baseRow({ result: "push", clvImpliedDelta: null }),
    ],
    REGISTRY,
  );
  const payload = { windowDays: 30, ...summary };
  const parsed = GetPerformanceModelWatchResponse.safeParse(payload);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error));
});
