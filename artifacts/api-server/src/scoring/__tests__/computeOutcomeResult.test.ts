import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOutcomeResult } from "../validatePicks";

/**
 * Spread settlement tests. `homeSpread` is the canonical home-team spread:
 *   negative = home is favorite (laying points)
 *   positive = home is underdog (getting points)
 * Pick side is the team that was bet on ("home" or "away").
 *
 * Cover math: homeMargin = (homeScore - awayScore) + homeSpread
 *   homeMargin > 0  → home covered
 *   homeMargin < 0  → away covered
 *   homeMargin == 0 → push
 */

test("spread: home favorite covers — home pick wins, away pick loses", () => {
  const base = { market: "spread", homeScore: 110, awayScore: 100, homeSpread: -7.5 };
  assert.equal(computeOutcomeResult({ ...base, pick: "home" }), "win");
  assert.equal(computeOutcomeResult({ ...base, pick: "away" }), "loss");
});

test("spread: home favorite fails to cover — home pick loses, away pick wins", () => {
  const base = { market: "spread", homeScore: 105, awayScore: 100, homeSpread: -7.5 };
  assert.equal(computeOutcomeResult({ ...base, pick: "home" }), "loss");
  assert.equal(computeOutcomeResult({ ...base, pick: "away" }), "win");
});

test("spread: home underdog covers (wins outright) — home pick wins, away pick loses", () => {
  const base = { market: "spread", homeScore: 102, awayScore: 100, homeSpread: 3.5 };
  assert.equal(computeOutcomeResult({ ...base, pick: "home" }), "win");
  assert.equal(computeOutcomeResult({ ...base, pick: "away" }), "loss");
});

test("spread: home underdog covers (loses by less than the spread) — home pick wins", () => {
  const base = { market: "spread", homeScore: 100, awayScore: 102, homeSpread: 3.5 };
  assert.equal(computeOutcomeResult({ ...base, pick: "home" }), "win");
  assert.equal(computeOutcomeResult({ ...base, pick: "away" }), "loss");
});

test("spread: home underdog fails (loses by more than the spread) — away pick wins", () => {
  const base = { market: "spread", homeScore: 90, awayScore: 100, homeSpread: 3.5 };
  assert.equal(computeOutcomeResult({ ...base, pick: "home" }), "loss");
  assert.equal(computeOutcomeResult({ ...base, pick: "away" }), "win");
});

test("spread: integer line with exact margin — push on both sides", () => {
  const base = { market: "spread", homeScore: 107, awayScore: 100, homeSpread: -7 };
  assert.equal(computeOutcomeResult({ ...base, pick: "home" }), "push");
  assert.equal(computeOutcomeResult({ ...base, pick: "away" }), "push");
});

test("spread: pick-em (homeSpread=0) — winner covers, tie pushes", () => {
  assert.equal(
    computeOutcomeResult({ market: "spread", pick: "home", homeScore: 101, awayScore: 100, homeSpread: 0 }),
    "win",
  );
  assert.equal(
    computeOutcomeResult({ market: "spread", pick: "away", homeScore: 101, awayScore: 100, homeSpread: 0 }),
    "loss",
  );
  assert.equal(
    computeOutcomeResult({ market: "spread", pick: "home", homeScore: 100, awayScore: 100, homeSpread: 0 }),
    "push",
  );
});

test("moneyline: straightforward win/loss/push", () => {
  assert.equal(
    computeOutcomeResult({ market: "moneyline", pick: "home", homeScore: 101, awayScore: 100 }),
    "win",
  );
  assert.equal(
    computeOutcomeResult({ market: "moneyline", pick: "away", homeScore: 101, awayScore: 100 }),
    "loss",
  );
  assert.equal(
    computeOutcomeResult({ market: "moneyline", pick: "home", homeScore: 100, awayScore: 100 }),
    "push",
  );
});

test("total: over/under resolve correctly and exact total pushes", () => {
  assert.equal(
    computeOutcomeResult({ market: "total", pick: "over", homeScore: 110, awayScore: 111, total: 220.5 }),
    "win",
  );
  assert.equal(
    computeOutcomeResult({ market: "total", pick: "under", homeScore: 100, awayScore: 100, total: 220.5 }),
    "win",
  );
  assert.equal(
    computeOutcomeResult({ market: "total", pick: "over", homeScore: 110, awayScore: 110, total: 220 }),
    "push",
  );
});
