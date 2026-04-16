import { test } from "node:test";
import assert from "node:assert/strict";
import { assignTier, type TierInput } from "../assignTiers";

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
