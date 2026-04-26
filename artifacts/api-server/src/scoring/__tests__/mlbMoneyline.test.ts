/**
 * MLB Phase 0.75D foundation — moneyline only.
 *
 * Verifies the model + scoring config wiring without touching the DB:
 *  1. Model produces complementary home/away probs that sum to 1.
 *  2. Home advantage shifts probability toward the home team vs. the
 *     vig-removed market fair price.
 *  3. Run line and totals are gated via MARKET_DISABLED so even if a
 *     candidate ever leaks through they are forced to PASS.
 *  4. Cron-level guarantee: MLB only runs the moneyline market (no
 *     getModel call for mlb_spread / mlb_total).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { predict } from "../../prediction/mlbMoneylineModel";
import { applyTieringToCandidates, type CandidateOutput } from "../scorePicks";
import {
  MARKET_DISABLED,
  HOME_ADVANTAGE,
  ODDS_RANGE_OVERRIDE,
  ODDS_RANGE_GUARDRAIL_LEAGUES,
  LEAGUE_MARKET_QUALITY,
} from "../../config/scoringModelConfig";
import {
  DEFAULT_CALIBRATION_PARAMS,
  getCalibrationParams,
} from "../calibration";
import { removeTwoSidedVig } from "../marketProb";

function makeGame(homeMl: number, awayMl: number) {
  return {
    gameKey: "mlb_2026-04-21_nyy_bos",
    league: "mlb" as const,
    eventStart: new Date("2026-04-21T23:05:00Z"),
    homeTeam: "Boston Red Sox",
    awayTeam: "New York Yankees",
    homePublishMl: homeMl,
    awayPublishMl: awayMl,
    snapshotDate: "2026-04-21",
  };
}

test("mlb model: home/away raw probs are complementary", async () => {
  const out = await predict(makeGame(-150, 130));
  assert.ok(out.rawProbHome != null && out.rawProbAway != null);
  assert.ok(out.rawProbHome > 0 && out.rawProbHome < 1);
  assert.ok(Math.abs((out.rawProbHome + out.rawProbAway) - 1) < 1e-9);
});

test("mlb model: home advantage pushes probability above market fair", async () => {
  // Pick-em moneyline so vig-removed fair home prob ≈ 0.5; with positive
  // home advantage the adjusted prob must exceed 0.5.
  const out = await predict(makeGame(-110, -110));
  const { fairA } = removeTwoSidedVig(-110, -110);
  assert.ok(out.rawProbHome! > fairA);
  assert.ok(out.rawProbHome! - fairA <= HOME_ADVANTAGE.mlb + 1e-9);
});

test("mlb config: run line and totals are MARKET_DISABLED stubs", () => {
  assert.equal(MARKET_DISABLED["mlb_spread"], true);
  assert.equal(MARKET_DISABLED["mlb_total"], true);
  // Moneyline must NOT be disabled — it is the foundation we are enabling.
  assert.notEqual(MARKET_DISABLED["mlb_moneyline"], true);
});

test("mlb config: moneyline calibration params exist with identity sigmoid", () => {
  const params = getCalibrationParams("mlb", "moneyline");
  assert.equal(params.method, "sigmoid");
  assert.equal(params.sigmoidA, 1.0);
  assert.equal(params.sigmoidB, 0.0);
  // Spread / total intentionally absent from DEFAULT_CALIBRATION_PARAMS.mlb.
  assert.equal(DEFAULT_CALIBRATION_PARAMS.mlb?.spread, undefined);
  assert.equal(DEFAULT_CALIBRATION_PARAMS.mlb?.total, undefined);
});

test("mlb config: odds-range guardrail enabled and bounded", () => {
  assert.ok((ODDS_RANGE_GUARDRAIL_LEAGUES as readonly string[]).includes("mlb"));
  const range = ODDS_RANGE_OVERRIDE["mlb_moneyline"];
  assert.ok(range, "mlb_moneyline odds range override must be set");
  assert.equal(range!.min, -400);
  assert.equal(range!.max, 350);
});

test("mlb config: market quality scores reflect moneyline-only readiness", () => {
  const q = LEAGUE_MARKET_QUALITY.mlb;
  assert.ok(q.moneyline >= 0.5, "mlb moneyline must clear MIN_MARKET_QUALITY (0.3) with margin");
  assert.ok(q.spread <= 0.3, "mlb spread quality must remain at not-ready level");
  assert.ok(q.total <= 0.3, "mlb total quality must remain at not-ready level");
});

test("applyTieringToCandidates: an mlb_spread candidate is force-PASSED via market_disabled", () => {
  // Construct a synthetic mlb_spread candidate that would otherwise pass
  // every check (high edge, high EV, high market quality, in-range odds).
  const c: CandidateOutput = {
    gameKey: "mlb_2026-04-21_nyy_bos",
    league: "mlb",
    marketType: "spread",
    side: "home",
    eventStart: new Date("2026-04-21T23:05:00Z"),
    publishOdds: -110,
    publishLine: -1.5,
    modelProbRaw: 0.6,
    modelProbCalibrated: 0.6,
    marketProbFair: 0.5,
    edge: 0.10,
    ev: 0.10,
    rankScore: 0,
    tier: "PASS",
    calibrationMethod: "sigmoid",
    calibrationVersion: "v1",
    marketQuality: 0.95,
    selectionReason: null,
    snapshotDate: "2026-04-21",
    modelVersion: "v1",
  };

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ["nba", "nhl", "mlb"],
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "market_disabled");
});

test("applyTieringToCandidates: a healthy mlb_moneyline candidate is demoted to PASS / model_watch_only", () => {
  // Task #8: MLB ML is now Model-Watch-only. A candidate that would
  // otherwise clear A/B/C is forced to PASS with selection_reason
  // 'model_watch_only' so it surfaces on the Model Watch slot but
  // never enters scored_picks / Performance / History.
  const c: CandidateOutput = {
    gameKey: "mlb_2026-04-21_nyy_bos",
    league: "mlb",
    marketType: "moneyline",
    side: "home",
    eventStart: new Date("2026-04-21T23:05:00Z"),
    publishOdds: -130,
    publishLine: null,
    modelProbRaw: 0.62,
    modelProbCalibrated: 0.62,
    marketProbFair: 0.55,
    edge: 0.07,
    ev: 0.05,
    rankScore: 0,
    tier: "PASS",
    calibrationMethod: "sigmoid",
    calibrationVersion: "v1",
    marketQuality: LEAGUE_MARKET_QUALITY.mlb.moneyline,
    selectionReason: null,
    snapshotDate: "2026-04-21",
    modelVersion: "v1",
  };

  const [tiered] = applyTieringToCandidates([c], [0.70], {
    oddsRangeGuardrailLeagues: ["nba", "nhl", "mlb"],
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "model_watch_only");
});

test("applyTieringToCandidates: out-of-range mlb moneyline odds are dropped", () => {
  const c: CandidateOutput = {
    gameKey: "mlb_2026-04-21_nyy_bos",
    league: "mlb",
    marketType: "moneyline",
    side: "away",
    eventStart: new Date("2026-04-21T23:05:00Z"),
    // +500 is well above the +350 ceiling — should be flagged before tiering.
    publishOdds: 500,
    publishLine: null,
    modelProbRaw: 0.4,
    modelProbCalibrated: 0.4,
    marketProbFair: 0.20,
    edge: 0.20,
    ev: 0.10,
    rankScore: 0,
    tier: "PASS",
    calibrationMethod: "sigmoid",
    calibrationVersion: "v1",
    marketQuality: LEAGUE_MARKET_QUALITY.mlb.moneyline,
    selectionReason: null,
    snapshotDate: "2026-04-21",
    modelVersion: "v1",
  };

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ["nba", "nhl", "mlb"],
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "odds_out_of_range");
});
