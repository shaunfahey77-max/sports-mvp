/**
 * Unit tests for the football backtest report's pure helpers.
 * Read-only — does not touch the DB or network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shadowAssignTier,
  auditNcaafNormalization,
  pct,
} from "../footballBacktestReport";
import type { CandidateOutput } from "../../../artifacts/api-server/src/scoring/scorePicks";
import {
  TIER_THRESHOLDS,
  MIN_EDGE_TO_CANDIDATE,
} from "../../../artifacts/api-server/src/config/scoringModelConfig";

function mkCand(overrides: Partial<CandidateOutput> = {}): CandidateOutput {
  return {
    gameKey: "g1",
    league: "nfl",
    marketType: "spread",
    side: "home",
    eventStart: new Date("2025-09-07T17:00:00Z"),
    publishOdds: -110,
    publishLine: -3,
    modelProbRaw: 0.55,
    modelProbCalibrated: 0.55,
    marketProbFair: 0.50,
    edge: 0.05,
    ev: 0.05,
    rankScore: 0,
    tier: "PASS",
    calibrationMethod: "sigmoid",
    calibrationVersion: "v1",
    marketQuality: 0.85,
    selectionReason: null,
    snapshotDate: "2025-09-07",
    modelVersion: "v1",
    ...overrides,
  };
}

test("shadowAssignTier: ignores MARKET_DISABLED — gated nfl_spread can still earn Tier A", () => {
  // Use a rank score above the global Tier A threshold so the bucket
  // assertion is robust to per-market overrides.
  const c = mkCand({ league: "nfl", marketType: "spread", edge: 0.10, ev: 0.10, marketQuality: 0.85 });
  const out = shadowAssignTier(c, TIER_THRESHOLDS.A + 0.01);
  assert.equal(out.tier, "A");
});

test("shadowAssignTier: enforces marketQuality >= 0.3", () => {
  const c = mkCand({ marketQuality: 0.2 });
  const out = shadowAssignTier(c, 1.0);
  assert.equal(out.tier, "PASS");
  assert.equal(out.selectionReason, "market_quality_too_low");
});

test("shadowAssignTier: enforces minimum edge floor", () => {
  const c = mkCand({ edge: MIN_EDGE_TO_CANDIDATE - 0.001 });
  const out = shadowAssignTier(c, 1.0);
  assert.equal(out.tier, "PASS");
  assert.equal(out.selectionReason, "insufficient_edge");
});

test("shadowAssignTier: enforces non-negative EV", () => {
  const c = mkCand({ edge: 0.20, ev: -0.01 });
  const out = shadowAssignTier(c, 1.0);
  assert.equal(out.tier, "PASS");
  assert.equal(out.selectionReason, "negative_ev");
});

test("shadowAssignTier: low rank score → PASS with rank_score_below_threshold", () => {
  const c = mkCand({ edge: 0.05, ev: 0.05, marketQuality: 0.85 });
  const out = shadowAssignTier(c, TIER_THRESHOLDS.C - 0.01);
  assert.equal(out.tier, "PASS");
  assert.equal(out.selectionReason, "rank_score_below_threshold");
});

test("auditNcaafNormalization: counts exact / alias / fuzzy correctly", () => {
  const audit = auditNcaafNormalization([
    { homeTeam: "Ohio State Buckeyes", awayTeam: "Michigan Wolverines" },        // both exact
    { homeTeam: "Ohio St", awayTeam: "Texas Longhorns" },                         // alias + exact
    { homeTeam: "Some Random FCS School", awayTeam: "Made-Up Team Of Nowhere" }, // both fuzzy
  ]);
  assert.equal(audit.totalUniqueTeams, 6);
  assert.equal(audit.exactMatches, 3);  // Ohio State, Michigan, Texas
  assert.equal(audit.aliasMatches, 1);  // Ohio St
  assert.equal(audit.fuzzyFallbacks, 2);
  assert.deepEqual(audit.fuzzyTeams.sort(), ["Made-Up Team Of Nowhere", "Some Random FCS School"]);
});

test("auditNcaafNormalization: trims whitespace before lookup", () => {
  const audit = auditNcaafNormalization([
    { homeTeam: "  Ohio State Buckeyes  ", awayTeam: "Michigan Wolverines" },
  ]);
  assert.equal(audit.exactMatches, 2);
  assert.equal(audit.fuzzyFallbacks, 0);
});

test("pct: linear-interpolation percentile matches numpy default", () => {
  assert.equal(pct([], 0.5), 0);
  assert.equal(pct([5], 0.5), 5);
  assert.equal(pct([1, 2, 3, 4, 5], 0.0), 1);
  assert.equal(pct([1, 2, 3, 4, 5], 1.0), 5);
  assert.equal(pct([1, 2, 3, 4, 5], 0.5), 3);
  // p25 of [1..5] is 2.0 under linear method (pos = 1.0)
  assert.equal(pct([1, 2, 3, 4, 5], 0.25), 2);
  // p75 of [1..5] is 4.0 (pos = 3.0)
  assert.equal(pct([1, 2, 3, 4, 5], 0.75), 4);
});
