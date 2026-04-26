/**
 * Regression test for the MARKET_MODEL_WATCH_ONLY override in
 * `applyTieringToCandidates` (Task #8 / #11).
 *
 * Pins the precedence rules so a future refactor can't silently re-promote
 * a Model-Watch-only market into Official picks (scored_picks):
 *
 *   1. A clean nhl_spread Tier-A candidate is demoted to PASS /
 *      'model_watch_only'.
 *   2. A clean mlb_moneyline Tier-A candidate is demoted to PASS /
 *      'model_watch_only'.
 *   3. market_disabled wins over model_watch_only (mlb_spread is in
 *      both registries — the disabled reason must survive).
 *   4. odds_out_of_range wins over model_watch_only (an mlb_moneyline
 *      with publish_odds outside the per-market range is dropped as a
 *      data-quality reject, not surfaced as Model Watch).
 *   5. A market that is NOT in MARKET_MODEL_WATCH_ONLY (nba_spread) is
 *      unaffected — it keeps its assignTier outcome.
 *
 * The override lives in `applyTieringToCandidates` (scorePicks.ts) and the
 * registry lives in `MARKET_MODEL_WATCH_ONLY` (scoringModelConfig.ts);
 * those are the two surfaces this test pins.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTieringToCandidates, type CandidateOutput } from "../scorePicks";
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
    edge: overrides.edge ?? 0.10,
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

test("MARKET_MODEL_WATCH_ONLY registry includes nhl_spread and mlb_moneyline", () => {
  // Pin the registry contents so an accidental deletion of an entry would
  // immediately fail this test instead of silently re-promoting the market.
  assert.equal(MARKET_MODEL_WATCH_ONLY["nhl_spread"], true);
  assert.equal(MARKET_MODEL_WATCH_ONLY["mlb_moneyline"], true);
});

test("model-watch-only override: clean nhl_spread Tier-A candidate → PASS / model_watch_only", () => {
  // nhl_spread is NOT in MARKET_DISABLED, has market_quality 0.90 and a
  // per-market MIN_EDGE of 0.06; rank_score 0.99 clears the 0.85 NHL
  // spread Tier-A override, so without the model-watch override this
  // candidate would be promoted to Tier A.
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

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "model_watch_only");
  // Sanity: registry-level invariants we depend on for this case.
  assert.notEqual(MARKET_DISABLED["nhl_spread"], true);
  assert.ok((TIER_A_THRESHOLD_OVERRIDE["nhl_spread"] ?? 0) <= 0.99);
});

test("model-watch-only override: clean mlb_moneyline Tier-A candidate → PASS / model_watch_only", () => {
  // mlb_moneyline is NOT in MARKET_DISABLED. With high edge / EV and a
  // rank_score above the global Tier A floor it would otherwise be
  // promoted to Tier A; the model-watch override must demote it to
  // PASS / 'model_watch_only'.
  const c = makeCandidate({
    league: "mlb",
    marketType: "moneyline",
    publishOdds: -130,
    edge: 0.07,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.80], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "model_watch_only");
  assert.notEqual(MARKET_DISABLED["mlb_moneyline"], true);
});

test("precedence: market_disabled wins over model_watch_only (real registry overlap)", () => {
  // Synthesize a true registry collision: temporarily add mlb_spread to
  // MARKET_MODEL_WATCH_ONLY so it lives in BOTH MARKET_DISABLED and
  // MARKET_MODEL_WATCH_ONLY. Under that overlap, the candidate must
  // still be flagged as 'market_disabled' (not 'model_watch_only') —
  // proving the precedence rule, not just current registry contents.
  assert.equal(MARKET_DISABLED["mlb_spread"], true);
  assert.notEqual(
    MARKET_MODEL_WATCH_ONLY["mlb_spread"],
    true,
    "fixture relies on mlb_spread NOT being in MARKET_MODEL_WATCH_ONLY by default",
  );

  const original = MARKET_MODEL_WATCH_ONLY["mlb_spread"];
  MARKET_MODEL_WATCH_ONLY["mlb_spread"] = true;
  try {
    const c = makeCandidate({
      league: "mlb",
      marketType: "spread",
      publishOdds: -110,
      publishLine: -1.5,
      edge: 0.10,
      ev: 0.10,
      marketQuality: 0.95,
    });

    const [tiered] = applyTieringToCandidates([c], [0.99], {
      oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
    });

    assert.equal(tiered.tier, "PASS");
    assert.equal(
      tiered.selectionReason,
      "market_disabled",
      "MARKET_DISABLED must win even when the same key is also in MARKET_MODEL_WATCH_ONLY",
    );
  } finally {
    if (original === undefined) {
      delete MARKET_MODEL_WATCH_ONLY["mlb_spread"];
    } else {
      MARKET_MODEL_WATCH_ONLY["mlb_spread"] = original;
    }
  }

  // Post-cleanup invariant: registry is back to its declared shape.
  assert.notEqual(MARKET_MODEL_WATCH_ONLY["mlb_spread"], true);
});

test("precedence: odds_out_of_range wins over model_watch_only (mlb_moneyline)", () => {
  // The MLB moneyline odds-range override caps the dog side at +350; an
  // mlb_moneyline candidate at +600 must be flagged as odds_out_of_range
  // BEFORE the model-watch override fires, so contaminated quotes never
  // surface as Model Watch picks.
  const range = ODDS_RANGE_OVERRIDE["mlb_moneyline"];
  assert.ok(range, "mlb_moneyline odds range override must exist for this test");
  assert.ok(range!.max < 600, "test fixture must be outside the configured range");

  const c = makeCandidate({
    league: "mlb",
    marketType: "moneyline",
    side: "away",
    publishOdds: 600,
    edge: 0.20,
    ev: 0.10,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
  });

  assert.equal(tiered.tier, "PASS");
  assert.equal(tiered.selectionReason, "odds_out_of_range");
});

test("scope: a market NOT in MARKET_MODEL_WATCH_ONLY (nba_spread) is unaffected", () => {
  // nba_spread is intentionally absent from MARKET_MODEL_WATCH_ONLY — a
  // healthy candidate should keep its assignTier outcome. We use a
  // rank_score that clears the nba_spread Tier-A override (0.95) so the
  // expected outcome is Tier A / 'high_rank_score'.
  assert.notEqual(MARKET_MODEL_WATCH_ONLY["nba_spread"], true);

  const c = makeCandidate({
    league: "nba",
    marketType: "spread",
    publishOdds: -110,
    publishLine: -3.5,
    edge: 0.08,
    ev: 0.05,
  });

  const [tiered] = applyTieringToCandidates([c], [0.99], {
    oddsRangeGuardrailLeagues: ODDS_RANGE_GUARDRAIL_LEAGUES,
  });

  assert.equal(tiered.tier, "A");
  assert.equal(tiered.selectionReason, "high_rank_score");
});
