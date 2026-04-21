/**
 * NFL Spread Model — v1 unit tests.
 *
 * The model is branch-only and gated (MARKET_DISABLED.nfl_spread = true);
 * these tests exercise the math directly so a future backtest harness
 * can rely on stable behavior before the production gate is lifted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { predict, MARGIN_STD_DEV, REST_ADV_POINTS_PER_DAY } from "../../prediction/nflSpreadModel";
import { HOME_ADVANTAGE } from "../../config/scoringModelConfig";
import type { GameMarketInput } from "../scorePicks";

function game(o: Partial<GameMarketInput> = {}): GameMarketInput {
  return {
    gameKey: "nfl_2026-09-13_kc_buf",
    league: "nfl",
    eventStart: new Date("2026-09-13T17:00:00Z"),
    homeTeam: "Buffalo Bills",
    awayTeam: "Kansas City Chiefs",
    homePublishMl: -110,
    awayPublishMl: -110,
    publishSpread: -3,
    ...o,
  } as GameMarketInput;
}

test("returns empty output when publishSpread is missing", async () => {
  const out = await predict(game({ publishSpread: undefined }));
  assert.deepEqual(out, {});
  const out2 = await predict(game({ publishSpread: null }));
  assert.deepEqual(out2, {});
});

test("rawProbHome + rawProbAway sum to 1 within numerical tolerance", async () => {
  const out = await predict(game());
  assert.ok(out.rawProbHome != null && out.rawProbAway != null);
  assert.ok(Math.abs(out.rawProbHome! + out.rawProbAway! - 1) < 1e-9);
});

test("at pick'em with no rest delta, home cover prob > 0.5 (HFA)", async () => {
  const out = await predict(game({ publishSpread: 0 }));
  assert.ok(out.rawProbHome! > 0.5, `expected home > 0.5, got ${out.rawProbHome}`);
});

test("favored home (negative spread) shrinks home cover prob below the moneyline implied", async () => {
  // Heavy home favorite at -7 — ML implies ~70% to win, but covering -7 is harder
  const heavyFavorite = await predict(
    game({ homePublishMl: -300, awayPublishMl: 240, publishSpread: -7 })
  );
  assert.ok(heavyFavorite.rawProbHome! < 0.7, "covering -7 must be harder than winning outright");
  assert.ok(heavyFavorite.rawProbHome! > 0.4, "but still better than coin flip when heavy fav");
});

test("home rest advantage shifts expected margin in the home direction", async () => {
  const noRest = await predict(
    game({ features: featureRow({ restAdvantage: 0 }) })
  );
  const homeRested = await predict(
    game({ features: featureRow({ restAdvantage: 4 }) }) // bye week vs no bye
  );
  assert.ok(homeRested.expectedMargin! > noRest.expectedMargin!);
  const expectedShift = 4 * REST_ADV_POINTS_PER_DAY;
  assert.ok(
    Math.abs(homeRested.expectedMargin! - noRest.expectedMargin! - expectedShift) < 1e-9
  );
});

test("home advantage is applied in points form (HOME_ADVANTAGE * MARGIN_STD_DEV)", async () => {
  // Pick'em (vig-free home prob = 0.5) → probToMargin(0.5) = 0
  // → expectedMargin should equal exactly the points-form HFA
  const out = await predict(game({ publishSpread: 0 }));
  const expectedHfaPoints = HOME_ADVANTAGE.nfl * MARGIN_STD_DEV;
  assert.ok(Math.abs(out.expectedMargin! - expectedHfaPoints) < 1e-9);
});

test("returns marginStdDev for downstream consumers", async () => {
  const out = await predict(game());
  assert.equal(out.marginStdDev, MARGIN_STD_DEV);
});

test("probability output is clamped to [0.05, 0.95]", async () => {
  // Extreme favorite, large spread cover possible
  const out = await predict(
    game({ homePublishMl: -10000, awayPublishMl: 5000, publishSpread: -1 })
  );
  assert.ok(out.rawProbHome! <= 0.95);
  assert.ok(out.rawProbAway! >= 0.05);
});

function featureRow(o: Partial<{ restAdvantage: number }> = {}) {
  return {
    homeTeamAbbrev: "buf",
    awayTeamAbbrev: "kc",
    homeTeamRestDays: 7,
    awayTeamRestDays: 7,
    homeTeamB2B: false,
    awayTeamB2B: false,
    homeTeamHomeATS: 0,
    awayTeamRoadATS: 0,
    homeTeamOverRate: 0,
    awayTeamOverRate: 0,
    restAdvantage: 0,
    atsSampleSize: 0,
    homeGoalsForAvg: 0,
    awayGoalsForAvg: 0,
    homeGoalsAgainstAvg: 0,
    awayGoalsAgainstAvg: 0,
    homeLast5TotalAvg: 0,
    awayLast5TotalAvg: 0,
    homeLast10TotalAvg: 0,
    awayLast10TotalAvg: 0,
    ...o,
  };
}
