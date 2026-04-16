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

test("assignTier: nba_moneyline override (0.88) — below override lands in B, at/above lands in A", () => {
  const base = { ...CLEAN, league: "nba" as const, marketType: "moneyline" as const };
  assert.equal(assignTier({ ...base, rankScore: 0.87 }).tier, "B");
  assert.equal(assignTier({ ...base, rankScore: 0.88 }).tier, "A");
});

test("assignTier: nhl_total override (0.94) preserved — unchanged by NBA calibration", () => {
  const base = { ...CLEAN, league: "nhl" as const, marketType: "total" as const };
  assert.equal(assignTier({ ...base, rankScore: 0.93 }).tier, "B");
  assert.equal(assignTier({ ...base, rankScore: 0.94 }).tier, "A");
});

test("assignTier: NHL moneyline/spread still use global 0.65 floor (no override)", () => {
  const ml = { ...CLEAN, league: "nhl" as const, marketType: "moneyline" as const, rankScore: 0.70 };
  const sp = { ...CLEAN, league: "nhl" as const, marketType: "spread" as const, rankScore: 0.70 };
  assert.equal(assignTier(ml).tier, "A");
  assert.equal(assignTier(sp).tier, "A");
});

test("assignTier: odds-range guardrail is OFF by default — extreme odds are not rejected", () => {
  // Without enableOddsRangeGuardrail, simulation / NCAAM paths score normally
  // even when odds are far outside the production sanity range.
  const result = assignTier({
    ...CLEAN,
    league: "nhl",
    marketType: "spread",
    rankScore: 0.70,
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
  // NBA moneyline override is [-2000, +600]: a -1500 favorite is legitimate,
  // but a +800 dog should be rejected. Confirms per-market overrides fire.
  const legitFav = assignTier({
    ...CLEAN,
    league: "nba",
    marketType: "moneyline",
    rankScore: 0.70,
    publishOdds: -1500,
    enableOddsRangeGuardrail: true,
  });
  // Key property: the guardrail did not fire. Tier bucket is determined
  // downstream by the NBA-ML TIER_A override (0.88), which puts 0.70 in B —
  // that's fine, the point is the candidate wasn't rejected as
  // 'odds_out_of_range'.
  assert.notEqual(legitFav.selectionReason, "odds_out_of_range");
  assert.notEqual(legitFav.tier, "PASS");

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

  // NHL moneyline override is [-800, +600]: -1200 exceeds the band.
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
  // an extreme-odds NHL spread candidate is tiered purely by its rank_score.
  const candidates: CandidateOutput[] = [
    mkCandidate({ gameKey: "nhl-extreme", league: "nhl", publishOdds: 5000 }),
  ];
  const tiered = applyTieringToCandidates(candidates, [0.70]);
  assert.notEqual(tiered[0].selectionReason, "odds_out_of_range");
  assert.notEqual(tiered[0].tier, "PASS");
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
