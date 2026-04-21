/**
 * NCAAF Spread Model — v1 unit tests.
 *
 * The model is branch-only and gated (MARKET_DISABLED.ncaaf_spread = true);
 * these tests exercise the math directly so a future backtest harness
 * can rely on stable behavior before the production gate is lifted.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  predict,
  MARGIN_STD_DEV,
  REST_ADV_POINTS_PER_DAY,
} from "../../prediction/ncaafSpreadModel";
import { HOME_ADVANTAGE } from "../../config/scoringModelConfig";
import type { GameMarketInput } from "../scorePicks";

function game(o: Partial<GameMarketInput> = {}): GameMarketInput {
  return {
    gameKey: "ncaaf_2026-09-05_uga_clem",
    league: "ncaaf",
    eventStart: new Date("2026-09-05T20:00:00Z"),
    homeTeam: "Clemson Tigers",
    awayTeam: "Georgia Bulldogs",
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

test("rawProbHome + rawProbAway sum to 1 within tolerance", async () => {
  const out = await predict(game());
  assert.ok(out.rawProbHome != null && out.rawProbAway != null);
  assert.ok(Math.abs(out.rawProbHome! + out.rawProbAway! - 1) < 1e-9);
});

test("at pick'em with no rest delta, home cover prob > 0.5 (HFA)", async () => {
  const out = await predict(game({ publishSpread: 0 }));
  assert.ok(out.rawProbHome! > 0.5);
});

test("HFA is applied in points form (HOME_ADVANTAGE.ncaaf * MARGIN_STD_DEV)", async () => {
  const out = await predict(game({ publishSpread: 0 }));
  const expectedHfaPoints = HOME_ADVANTAGE.ncaaf * MARGIN_STD_DEV;
  assert.ok(Math.abs(out.expectedMargin! - expectedHfaPoints) < 1e-9);
});

test("rest advantage shifts expected margin in the home direction", async () => {
  const noRest = await predict(game({ features: featureRow({ restAdvantage: 0 }) }));
  const homeRested = await predict(game({ features: featureRow({ restAdvantage: 4 }) }));
  assert.ok(homeRested.expectedMargin! > noRest.expectedMargin!);
  const expectedShift = 4 * REST_ADV_POINTS_PER_DAY;
  assert.ok(
    Math.abs(homeRested.expectedMargin! - noRest.expectedMargin! - expectedShift) < 1e-9
  );
});

test("returns marginStdDev for downstream consumers", async () => {
  const out = await predict(game());
  assert.equal(out.marginStdDev, MARGIN_STD_DEV);
});

test("output is clamped to [0.05, 0.95]", async () => {
  const out = await predict(
    game({ homePublishMl: -100000, awayPublishMl: 50000, publishSpread: -1 })
  );
  assert.ok(out.rawProbHome! <= 0.95);
  assert.ok(out.rawProbAway! >= 0.05);
});

test("massive home favorite at large spread covers less often than wins outright", async () => {
  // 35-point college mismatch: ML implies ~95% to win, covering -35 is much harder
  const out = await predict(
    game({ homePublishMl: -10000, awayPublishMl: 4000, publishSpread: -35 })
  );
  assert.ok(out.rawProbHome! < 0.85, "covering -35 must be harder than winning outright");
});

function featureRow(o: Partial<{ restAdvantage: number }> = {}) {
  return {
    homeTeamAbbrev: "clem",
    awayTeamAbbrev: "uga",
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
