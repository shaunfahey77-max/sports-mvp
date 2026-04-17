/**
 * Parity test: ensures the internal KPI report's `computeMetrics` produces
 * the same Brier / log-loss / ROI / win-rate / units numbers as the live
 * settlement pipeline's `computeValidationMetrics`. Catches future drift
 * if either helper is changed in isolation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, type PickRow } from "../kpiReport";
import {
  computeValidationMetrics,
  type PickWithFullData,
} from "../../../artifacts/api-server/src/scoring/validatePicks";

const FIXTURE: Array<{
  result: "win" | "loss" | "push" | "pending";
  publishOdds: number;
  modelProbCalibrated: number;
  edge: number;
  ev: number;
  tier: string;
  league: string;
  market: string;
}> = [
  { result: "win",  publishOdds: -110, modelProbCalibrated: 0.62, edge: 0.10, ev: 0.05, tier: "A", league: "nba", market: "spread" },
  { result: "loss", publishOdds: -110, modelProbCalibrated: 0.58, edge: 0.06, ev: 0.02, tier: "A", league: "nba", market: "spread" },
  { result: "win",  publishOdds: +120, modelProbCalibrated: 0.55, edge: 0.09, ev: 0.07, tier: "B", league: "nba", market: "moneyline" },
  { result: "loss", publishOdds: -150, modelProbCalibrated: 0.65, edge: 0.05, ev: 0.01, tier: "B", league: "nba", market: "moneyline" },
  { result: "push", publishOdds: -110, modelProbCalibrated: 0.50, edge: 0.04, ev: 0.02, tier: "B", league: "nhl", market: "spread" },
  { result: "win",  publishOdds: -105, modelProbCalibrated: 0.60, edge: 0.07, ev: 0.04, tier: "A", league: "nhl", market: "spread" },
  { result: "loss", publishOdds: +100, modelProbCalibrated: 0.52, edge: 0.05, ev: 0.03, tier: "B", league: "nhl", market: "total" },
  { result: "loss", publishOdds: -110, modelProbCalibrated: 0.57, edge: 0.06, ev: 0.02, tier: "B", league: "nhl", market: "total" },
  { result: "win",  publishOdds: +130, modelProbCalibrated: 0.48, edge: 0.08, ev: 0.06, tier: "A", league: "nhl", market: "total" },
  { result: "pending", publishOdds: -120, modelProbCalibrated: 0.55, edge: 0.04, ev: 0.02, tier: "B", league: "nba", market: "spread" },
];

const kpiRows: PickRow[] = FIXTURE.map((p, i) => ({
  id: i + 1,
  date: "2026-04-15",
  league: p.league,
  market: p.market,
  pick: "home",
  result: p.result,
  publishOdds: p.publishOdds,
  modelProbCalibrated: p.modelProbCalibrated,
  edge: p.edge,
  ev: p.ev,
  tier: p.tier,
  clvImpliedDelta: null,
  createdAt: new Date("2026-04-15T12:00:00Z"),
}));

const validationRows: PickWithFullData[] = FIXTURE.map((p, i) => ({
  id: i + 1,
  league: p.league,
  market: p.market,
  pick: "home",
  publishOdds: p.publishOdds,
  closeOdds: null,
  closeLine: null,
  publishLine: null,
  modelProbCalibrated: p.modelProbCalibrated,
  result: p.result,
  ev: p.ev,
  edge: p.edge,
  clvImpliedDelta: null,
  tier: p.tier,
}));

test("KPI report parity: Brier / log-loss / ROI / win-rate / units match computeValidationMetrics", () => {
  const kpi = computeMetrics(kpiRows);
  const live = computeValidationMetrics(validationRows, 1);

  // computeValidationMetrics treats every non-pending pick as "resolved" (push
  // counts as outcome=0 in Brier). kpiReport's computeMetrics matches that
  // contract — these assertions enforce the parity.
  assert.equal(kpi.totalPicks, live.totalPicks, "totalPicks");
  assert.equal(kpi.wins, live.wins, "wins");
  assert.equal(kpi.losses, live.losses, "losses");
  assert.equal(kpi.pushes, live.pushes, "pushes");
  assert.equal(kpi.pending, live.pending, "pending");

  const eq = (a: number, b: number, label: string, eps = 1e-9) => {
    assert.ok(Math.abs(a - b) < eps, `${label}: kpi=${a} live=${b}`);
  };
  eq(kpi.winRate, live.winRate, "winRate");
  eq(kpi.unitsWon, live.unitsWon, "unitsWon");
  eq(kpi.roi, live.roi, "roi");
  eq(kpi.brierScore, live.brierScore, "brierScore");
  eq(kpi.logLoss, live.logLoss, "logLoss");
  // computeValidationMetrics averages ev/edge over resolved picks (matches
  // kpiReport when there are resolved picks present) — verify both helpers
  // see the same denominator.
  eq(kpi.avgEv, live.avgEv, "avgEv");
  eq(kpi.avgEdge, live.avgEdge, "avgEdge");
});
