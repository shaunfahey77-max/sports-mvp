import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyTieringToCandidates,
  isOfficialCandidate,
  type CandidateOutput,
} from "../scorePicks";
import {
  LEAGUE_MARKET_QUALITY,
  MARKET_DISABLED,
  MARKET_MODEL_WATCH_ONLY,
  ODDS_RANGE_GUARDRAIL_LEAGUES,
  ODDS_RANGE_OVERRIDE,
  TIER_A_THRESHOLD_OVERRIDE,
  type League,
  type MarketType,
} from "../../config/scoringModelConfig";

interface CandidateOverrides {
  league: League;
  marketType: MarketType;
  side?: CandidateOutput["side"];
  publishOdds?: number;
  publishLine?: number | null;
  edge?: number;
  ev?: number;
  marketQuality?: number;
}

function makeCandidate(overrides: CandidateOverrides): CandidateOutput {
  return {
    gameKey: `${overrides.league}_2026-04-25_aaa_bbb`,
    league: overrides.league,
    marketType: overrides.marketType,
    side: overrides.side ?? "home",
    eventStart: new Date("2026-04-25T23:05:00Z"),
    publishOdds: overrides.publishOdds ?? -110,
    publishLine: overrides.publishLine ?? null,
    modelProbRaw: 0.6,
    modelProbCalibrated: 0.6,
    marketProbFair: 0.5,
    edge: overrides.edge ?? 0.1,
    ev: overrides.ev ?? 0.08,
    rankScore: 0,
    tier: "PASS",
    calibrationMethod: "sigmoid",
    calibrationVersion: "v1",
    marketQuality:
      overrides.marketQuality ??
      LEAGUE_MARKET_QUALITY[overrides.league][overrides.marketType],
    selectionReason: null,
    snapshotDate: "2026-04-25",
    modelVersion: "v1",
  };
}

test("legacy fallback suppression maps are empty by default", () => {
  const disabled = Object.entries(MARKET_DISABLED).filter(([, v]) => v === true);
  const watchOnly = Object.entries(MARKET_MODEL_WATCH_ONLY).filter(([, v]) => v === true);

  assert.deepEqual(disabled, []);
  assert.deepEqual(watchOnly, []);
});

test("default scorer behavior: nhl_spread tiers normally when no registry override exists", () => {
  const c = makeCandidate({
    league: "nhl",
    marketType: "spread",
    publishOdds: -110,
    publishLine: -1.5,
    edge: 0.08,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
  });

  assert.ok((TIER_A_THRESHOLD_OVERRIDE["nhl_spread"] ?? 0) <= 0.99);
  assert.equal(tiered.tier, "A");
  assert.equal(tiered.selectionReason, "high_rank_score");
  assert.equal(isOfficialCandidate(tiered), true);
});

test("default scorer behavior: mlb_moneyline tiers normally when no registry override exists", () => {
  const c = makeCandidate({
    league: "mlb",
    marketType: "moneyline",
    publishOdds: -130,
    edge: 0.07,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.8], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
  });

  assert.equal(tiered.tier, "A");
  assert.equal(tiered.selectionReason, "high_rank_score");
  assert.equal(isOfficialCandidate(tiered), true);
});

test("odds_out_of_range still wins before any explicit registry watch override", () => {
  const range = ODDS_RANGE_OVERRIDE["mlb_moneyline"];
  assert.ok(range, "mlb_moneyline odds range override must exist for this test");
  assert.ok(range!.max < 600, "test fixture must be outside the configured range");

  const c = makeCandidate({
    league: "mlb",
    marketType: "moneyline",
    side: "away",
    publishOdds: 600,
    edge: 0.2,
    ev: 0.1,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      mlb_moneyline: "model_watch",
    },
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "odds_out_of_range");
});

test("registry override: model_watch can demote an otherwise-eligible market", () => {
  const c = makeCandidate({
    league: "ncaam",
    marketType: "spread",
    publishOdds: -110,
    publishLine: -3.5,
    edge: 0.08,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      ncaam_spread: "model_watch",
    },
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "model_watch_only");
  assert.equal(isOfficialCandidate(tiered), false);
});

test("registry override: suppressed can disable an otherwise-eligible market", () => {
  const c = makeCandidate({
    league: "ncaam",
    marketType: "spread",
    publishOdds: -110,
    publishLine: -3.5,
    edge: 0.08,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      ncaam_spread: "suppressed",
    },
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "market_disabled");
  assert.equal(isOfficialCandidate(tiered), false);
});

test("registry override: shadow preserves official eligibility", () => {
  const c = makeCandidate({
    league: "nhl",
    marketType: "spread",
    publishOdds: -110,
    publishLine: -1.5,
    edge: 0.08,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      nhl_spread: "shadow",
    },
  });

  assert.equal(tiered.tier, "A");
  assert.equal(tiered.selectionReason, "high_rank_score");
  assert.equal(isOfficialCandidate(tiered), true);
});

test("official-lane discipline: long plus-money rows are filtered from surfaced official picks", () => {
  const c = makeCandidate({
    league: "nhl",
    marketType: "total",
    side: "over",
    publishOdds: 170,
    publishLine: 5.5,
    edge: 0.12,
    ev: 0.08,
  });

  const [tiered] = applyTieringToCandidates([c], [0.8], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      nhl_total: "shadow",
    },
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "official_profile_filtered");
  assert.equal(isOfficialCandidate(tiered), false);
});

test("official-lane discipline: plus-money spread rows above +100 are filtered", () => {
  const c = makeCandidate({
    league: "nba",
    marketType: "spread",
    side: "away",
    publishOdds: 120,
    publishLine: 7.5,
    edge: 0.12,
    ev: 0.08,
  });

  const [tiered] = applyTieringToCandidates([c], [0.8], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      nba_spread: "shadow",
    },
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "official_profile_filtered");
  assert.equal(isOfficialCandidate(tiered), false);
});

test("official-lane discipline: live Tier A rows are relabeled to B", () => {
  const c = makeCandidate({
    league: "nhl",
    marketType: "total",
    side: "under",
    publishOdds: -110,
    publishLine: 5.5,
    edge: 0.12,
    ev: 0.08,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    surfaceStatusByMarketKey: {
      nhl_total: "shadow",
    },
  });

  assert.equal(tiered.tier, "B");
  assert.equal(tiered.selectionReason, "medium_rank_score");
  assert.equal(isOfficialCandidate(tiered), true);
});
