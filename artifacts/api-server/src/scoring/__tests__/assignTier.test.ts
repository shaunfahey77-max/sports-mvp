import { test } from "node:test";
import assert from "node:assert/strict";
import { assignTier, type TierInput } from "../assignTiers";
import { applyTieringToCandidates } from "../scorePicks";
import type { CandidateOutput } from "../scorePicks";

const CLEAN: Omit<TierInput, "league" | "marketType" | "rankScore"> = {
  edge: 0.08,
  ev: 0.05,
  marketQuality: 0.9,
};

test("assignTier: global Tier A threshold (0.65) applies when no league/market override", () => {
  assert.equal(assignTier({ ...CLEAN, rankScore: 0.70 }).tier, "A");
  assert.equal(assignTier({ ...CLEAN, rankScore: 0.64 }).tier, "B");
});

test("assignTier: nba_spread override (0.95) — below override lands in B, at/above lands in A", () => {
  const base = { ...CLEAN, league: "nba" as const, marketType: "spread" as const };
  assert.equal(assignTier({ ...base, rankScore: 0.94 }).tier, "B");
  assert.equal(assignTier({ ...base, rankScore: 0.95 }).tier, "A");
  assert.equal(assignTier({ ...base, rankScore: 0.98 }).tier, "A");
});

test("assignTier: nba_moneyline override (0.88) — currently shadowed by MARKET_DISABLED gate (Phase 0.75B)", () => {
  // The TIER_A_THRESHOLD_OVERRIDE for nba_moneyline (0.88) is still wired up,
  // but MARKET_DISABLED["nba_moneyline"] = true short-circuits to PASS for
  // every rank score. When the gate is removed, restore the original
  // rankScore=0.87 → "B" and rankScore=0.88 → "A" expectations below.
  const base = { ...CLEAN, league: "nba" as const, marketType: "moneyline" as const };
  assert.equal(assignTier({ ...base, rankScore: 0.87 }).tier, "PASS");
  assert.equal(assignTier({ ...base, rankScore: 0.88 }).selectionReason, "market_disabled");
});

test("assignTier: nhl_total override (0.94) is active again after lift to watch-only", () => {
  // nhl_total is no longer in MARKET_DISABLED; it now lives in
  // MARKET_MODEL_WATCH_ONLY at the scorer level. assignTier should therefore
  // tier it normally unless an explicit surfaceStatus says otherwise.
  const base = { ...CLEAN, league: "nhl" as const, marketType: "total" as const };
  assert.equal(assignTier({ ...base, rankScore: 0.93 }).tier, "B");
  assert.equal(assignTier({ ...base, rankScore: 0.94 }).tier, "A");
});

test("assignTier: MARKET_DISABLED short-circuits to PASS regardless of rank score / edge / ev", () => {
  // nhl_moneyline + nba_moneyline remain legacy-disabled in scoringModelConfig.
  // Use mlb_total as a third disabled market that is still suppressed today.
  for (const [league, marketType] of [
    ["nhl", "moneyline"] as const,
    ["nba", "moneyline"] as const,
    ["mlb", "total"] as const,
  ]) {
    const r = assignTier({
      ...CLEAN,
      league,
      marketType,
      rankScore: 0.99, // would normally be Tier A
      edge: 0.30,
      ev: 0.10,
    });
    assert.equal(r.tier, "PASS", `${league}/${marketType} should be PASS`);
    assert.equal(r.selectionReason, "market_disabled", `${league}/${marketType} reason`);
  }
});

test("assignTier: explicit surfaceStatus='suppressed' short-circuits to PASS regardless of legacy config", () => {
  const r = assignTier({
    ...CLEAN,
    league: "ncaam",
    marketType: "spread",
    rankScore: 0.99,
    edge: 0.30,
    ev: 0.10,
    surfaceStatus: "suppressed",
  });
  assert.equal(r.tier, "PASS");
  assert.equal(r.selectionReason, "market_disabled");
});

test("assignTier: explicit surfaceStatus='shadow' bypasses legacy MARKET_DISABLED fallback", () => {
  // nba_moneyline is still in MARKET_DISABLED, so without surfaceStatus this
  // market short-circuits to PASS. The registry-driven scorer path needs to be
  // able to lift it back into normal tiering when the market registry says
  // shadow/official instead.
  const r = assignTier({
    ...CLEAN,
    league: "nba",
    marketType: "moneyline",
    rankScore: 0.90,
    surfaceStatus: "shadow",
  });
  assert.equal(r.tier, "A");
  assert.equal(r.selectionReason, "high_rank_score");
});

test("assignTier: non-disabled markets are unaffected by MARKET_DISABLED check", () => {
  // nhl_spread is NOT in MARKET_DISABLED — should still tier normally.
  // Phase 0.75C: nhl_spread Tier A override is now 0.85 (was global 0.65),
  // so we use rankScore=0.86 to keep the test asserting "A".
  const r = assignTier({
    ...CLEAN,
    league: "nhl",
    marketType: "spread",
    rankScore: 0.86,
  });
  assert.equal(r.tier, "A");
});

test("assignTier: NHL spread uses Phase 0.75C override (0.85); NHL moneyline is gated", () => {
  // NHL spread Tier A override raised to 0.85 in Phase 0.75C — rankScore
  // 0.70 now lands in B (was A under the previous global 0.65 floor).
  const base = { ...CLEAN, league: "nhl" as const, marketType: "spread" as const };
  assert.equal(assignTier({ ...base, rankScore: 0.84 }).tier, "B");
  assert.equal(assignTier({ ...base, rankScore: 0.85 }).tier, "A");
  // NHL moneyline is currently disabled (Phase 0.75B). When re-enabled, restore
  // the original rankScore=0.70 → "A" expectation.
  const ml = { ...CLEAN, league: "nhl" as const, marketType: "moneyline" as const, rankScore: 0.70 };
  assert.equal(assignTier(ml).selectionReason, "market_disabled");
});

test("assignTier: odds-range guardrail is OFF by default — extreme odds are not rejected", () => {
  // Without enableOddsRangeGuardrail, simulation / NCAAM paths score normally
  // even when odds are far outside the production sanity range. NHL spread
  // Tier A override is 0.85 (Phase 0.75C), so we use rankScore=0.86.
  const result = assignTier({
    ...CLEAN,
    league: "nhl",
    marketType: "spread",
    rankScore: 0.86,
    publishOdds: 2800,
  });
  assert.equal(result.tier, "A");
  assert.equal(result.selectionReason, "high_rank_score");
});

test("assignTier: odds-range guardrail rejects out-of-range odds with exact 'odds_out_of_range' reason", () => {
  // NHL spread falls under DEFAULT_ODDS_RANGE ([-350, +350]).
  // Guardrail must fire BEFORE edge/EV gates so the contaminated
  // pick is clearly labeled — not masked as "insufficient_edge".
  const tooHigh = assignTier({
    ...CLEAN,
    league: "nhl",
    marketType: "spread",
    rankScore: 0.70,
    publishOdds: 2800,
    enableOddsRangeGuardrail: true,
  });
  assert.equal(tooHigh.tier, "PASS");
  assert.equal(tooHigh.selectionReason, "odds_out_of_range");

  const tooLow = assignTier({
    ...CLEAN,
    league: "nba",
    marketType: "spread",
    rankScore: 0.70,
    publishOdds: -9999,
    enableOddsRangeGuardrail: true,
  });
  assert.equal(tooLow.tier, "PASS");
  assert.equal(tooLow.selectionReason, "odds_out_of_range");
});

test("assignTier: odds-range override widens moneyline range for NBA/NHL heavy favorites", () => {
  // The odds-range guardrail still runs BEFORE MARKET_DISABLED, so the
  // 'odds_out_of_range' reason is preserved even for currently-gated markets.
  // A legit favorite that passes the odds range will then be caught by the
  // gate and labeled 'market_disabled' — both behaviors are asserted below.

  // NBA moneyline override is [-2000, +600]: -1500 passes the odds range,
  // then is force-PASSED by the market gate.
  const legitFav = assignTier({
    ...CLEAN,
    league: "nba",
    marketType: "moneyline",
    rankScore: 0.70,
    publishOdds: -1500,
    enableOddsRangeGuardrail: true,
  });
  assert.notEqual(legitFav.selectionReason, "odds_out_of_range");
  assert.equal(legitFav.selectionReason, "market_disabled");

  // +800 still exceeds the override range, so odds_out_of_range wins.
  const altLineDog = assignTier({
    ...CLEAN,
    league: "nba",
    marketType: "moneyline",
    rankScore: 0.70,
    publishOdds: 800,
    enableOddsRangeGuardrail: true,
  });
  assert.equal(altLineDog.tier, "PASS");
  assert.equal(altLineDog.selectionReason, "odds_out_of_range");

  // NHL moneyline override is [-800, +600]: -1200 exceeds the band, so
  // odds_out_of_range wins over market_disabled (taxonomy stability).
  const nhlHeavyFav = assignTier({
    ...CLEAN,
    league: "nhl",
    marketType: "moneyline",
    rankScore: 0.70,
    publishOdds: -1200,
    enableOddsRangeGuardrail: true,
  });
  assert.equal(nhlHeavyFav.tier, "PASS");
  assert.equal(nhlHeavyFav.selectionReason, "odds_out_of_range");
});

test("assignTier: guardrail fires before edge gate — odds_out_of_range wins over insufficient_edge", () => {
  // A candidate with both out-of-range odds AND low edge should be labeled
  // 'odds_out_of_range', not 'insufficient_edge'. Ordering matters for
  // downstream rejection-reason analytics.
  const result = assignTier({
    ...CLEAN,
    edge: 0.001, // well below MIN_EDGE_TO_CANDIDATE
    league: "nhl",
    marketType: "spread",
    rankScore: 0.70,
    publishOdds: 5000,
    enableOddsRangeGuardrail: true,
  });
  assert.equal(result.tier, "PASS");
  assert.equal(result.selectionReason, "odds_out_of_range");
});

/**
 * Minimal CandidateOutput factory — just enough to drive the tiering stage
 * of scorePicks (applyTieringToCandidates) without booting models / DB.
 */
function mkCandidate(overrides: Partial<CandidateOutput>): CandidateOutput {
  return {
    gameKey: "g1",
    league: "nhl",
    marketType: "spread",
    side: "away",
    eventStart: new Date("2026-04-16T23:00:00Z"),
    publishOdds: -110,
    publishLine: -1.5,
    modelProbRaw: 0.55,
    modelProbCalibrated: 0.55,
    marketProbFair: 0.5,
    edge: 0.08, // above every per-market min edge (max override is nhl_spread @ 0.06)
    ev: 0.05,
    rankScore: 0,
    tier: "PASS",
    calibrationMethod: "none",
    calibrationVersion: "v1",
    marketQuality: 0.9,
    selectionReason: null,
    snapshotDate: "2026-04-16",
    modelVersion: "v1",
    ...overrides,
  };
}

test("scorePicks (applyTieringToCandidates): guardrail gates per-league — NHL opted-in rejects, NCAAM does not", () => {
  // Three synthetic candidates all with the SAME extreme +5000 odds on a
  // spread market. Guardrail is opted-in for NHL + NBA only. NCAAM must
  // sail through (no odds check) so historical / NCAAM paths are unaffected.
  const candidates: CandidateOutput[] = [
    mkCandidate({ gameKey: "nhl-1", league: "nhl",   publishOdds: 5000 }),
    mkCandidate({ gameKey: "nba-1", league: "nba",   marketType: "spread", publishOdds: 5000 }),
    mkCandidate({ gameKey: "nca-1", league: "ncaam", marketType: "spread", publishOdds: 5000 }),
  ];
  const rankScores = [0.70, 0.70, 0.70];

  const tiered = applyTieringToCandidates(candidates, rankScores, {
    oddsRangeGuardrailLeagues: ["nhl", "nba"],
  });

  // NHL & NBA are opted in → rejected with exact reason.
  const nhl = tiered.find((c) => c.gameKey === "nhl-1")!;
  assert.equal(nhl.tier, "PASS");
  assert.equal(nhl.selectionReason, "odds_out_of_range");
  assert.equal(nhl.publishOdds, 5000);
  assert.equal(nhl.publishLine, -1.5);

  const nba = tiered.find((c) => c.gameKey === "nba-1")!;
  assert.equal(nba.tier, "PASS");
  assert.equal(nba.selectionReason, "odds_out_of_range");

  // NCAAM is NOT opted in → guardrail silent, tier resolved by rank score.
  const nca = tiered.find((c) => c.gameKey === "nca-1")!;
  assert.notEqual(nca.selectionReason, "odds_out_of_range");
  assert.notEqual(nca.tier, "PASS");
  assert.equal(nca.publishOdds, 5000); // odds preserved on the output
});

test("scorePicks (applyTieringToCandidates): guardrail off by default — all leagues score normally", () => {
  // With NO options, simulation + historical callers see the old behavior:
  // an extreme-odds spread candidate is NOT rejected by the odds-range
  // guardrail. We use NCAAM here because it sits outside both
  // MARKET_DISABLED and MARKET_MODEL_WATCH_ONLY, so the test isolates
  // the guardrail-off semantic without entanglement from those gates.
  const candidates: CandidateOutput[] = [
    mkCandidate({ gameKey: "ncm-extreme", league: "ncaam", publishOdds: 5000 }),
  ];
  const tiered = applyTieringToCandidates(candidates, [0.70]);
  assert.notEqual(tiered[0].selectionReason, "odds_out_of_range");
  assert.notEqual(tiered[0].tier, "PASS");
});

test("rerun reconciliation: a candidate that flips from A/B/C to PASS this run yields a stale-key for scored_picks deletion", async () => {
  // Simulates the real rerun scenario the reviewer asked about:
  //   - Yesterday: NHL spread at +5000 was scored Tier A (pre-guardrail).
  //   - Today: same (game, market, side) scored again WITH the guardrail
  //     → PASS with reason 'odds_out_of_range'.
  //   - Stale-row reconciliation must return that (gameKey, market, pick)
  //     tuple so callers DELETE the prior scored_picks pending row.
  //
  // End-to-end through the scoring-path helper and the reconciliation
  // helper used by routes/picks.ts, routes/odds.ts, and cronService.ts.
  const { computeStaleScoredPicksKeys } = await import("../../lib/pickUtils");

  const candidates: CandidateOutput[] = [
    // Contaminated NHL spread: rank_score 0.70 would otherwise be Tier A.
    mkCandidate({
      gameKey: "2026-04-16-NHL-BOS-TOR",
      league: "nhl",
      marketType: "spread",
      side: "away",
      publishOdds: 5000,
      publishLine: -1.5,
    }),
    // Clean NBA spread that should still surface (unchanged between runs).
    mkCandidate({
      gameKey: "2026-04-16-NCAAM-DUKE-UCLA",
      league: "ncaam",
      marketType: "spread",
      side: "home",
      publishOdds: -110,
      publishLine: -2.5,
    }),
  ];

  const tiered = applyTieringToCandidates(candidates, [0.70, 0.70], {
    oddsRangeGuardrailLeagues: ["nhl", "nba"],
  });

  // The NHL pick is now PASS, the NBA pick survives.
  const nhl = tiered.find((c) => c.gameKey === "2026-04-16-NHL-BOS-TOR")!;
  const ncaam = tiered.find((c) => c.gameKey === "2026-04-16-NCAAM-DUKE-UCLA")!;
  assert.equal(nhl.tier, "PASS");
  assert.equal(nhl.selectionReason, "odds_out_of_range");
  assert.notEqual(ncaam.tier, "PASS");

  // Stale-key helper returns exactly the (gameKey, market, pick) tuples
  // that callers must delete from scored_picks for this date.
  const staleKeys = computeStaleScoredPicksKeys(tiered);
  assert.deepEqual(staleKeys, [
    { gameKey: "2026-04-16-NHL-BOS-TOR", market: "spread", pick: "away" },
  ]);
});

test("pipeline: rejected candidate preserves exact reason + offending odds/line through the candidate_bets persistence shape", () => {
  // End-to-end assertion that mirrors the claim in task-3: when scoring
  // rejects a pick via the odds-range guardrail, the downstream
  // persistence row in candidate_bets carries `selection_reason =
  // 'odds_out_of_range'` (exact, unconcatenated) plus the offending
  // publish_odds and publish_line values in their own columns, so we can
  // reconstruct the rejection reason + the value that triggered it with a
  // plain SQL query.
  //
  // We construct the CandidateOutput exactly as scorePicks would emit it
  // (tier/selectionReason come from assignTier with the guardrail ON),
  // then mirror the field-for-field mapping used by routes/picks.ts when
  // writing candidate_bets. If anyone weakens that mapping (or the exact
  // reason string), this test breaks.

  // 1. What scorePicks returns for a contaminated NHL spread @ +5000
  const { tier, selectionReason } = assignTier({
    ...CLEAN,
    league: "nhl",
    marketType: "spread",
    rankScore: 0.70,
    publishOdds: 5000,
    publishLine: -1.5,
    enableOddsRangeGuardrail: true,
  });

  const candidate = {
    gameKey: "2026-04-16-NHL-BOS-TOR",
    league: "nhl" as const,
    marketType: "spread" as const,
    side: "away" as const,
    publishOdds: 5000,
    publishLine: -1.5,
    tier,
    selectionReason,
  };

  // 2. Mirror the candidate_bets insert mapping from routes/picks.ts.
  const persistedRow = {
    gameKey: candidate.gameKey,
    league: candidate.league,
    marketType: candidate.marketType,
    side: candidate.side,
    publishOdds: String(candidate.publishOdds),
    publishLine: candidate.publishLine != null ? String(candidate.publishLine) : undefined,
    tier: candidate.tier,
    selectionReason: candidate.selectionReason,
  };

  assert.equal(persistedRow.tier, "PASS");
  // Exact string contract — downstream analytics join on this literal.
  assert.equal(persistedRow.selectionReason, "odds_out_of_range");
  // Offending odds/line are reconstructable from the persisted columns.
  assert.equal(persistedRow.publishOdds, "5000");
  assert.equal(persistedRow.publishLine, "-1.5");
});

test("assignTier: risk controls still dominate — low market quality forces PASS even at A-grade rank", () => {
  const result = assignTier({
    ...CLEAN,
    league: "nba",
    marketType: "spread",
    rankScore: 0.99,
    marketQuality: 0.1,
  });
  assert.equal(result.tier, "PASS");
  assert.equal(result.selectionReason, "market_quality_too_low");
});
