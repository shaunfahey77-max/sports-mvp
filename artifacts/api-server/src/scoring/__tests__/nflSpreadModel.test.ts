/**
 * NFL Spread Model — v2 unit tests (2026-04-21 redesign pass).
 *
 * The model is branch-only and gated (MARKET_DISABLED.nfl_spread = true);
 * these tests exercise the math directly so the next backtest harness can
 * rely on stable behavior before the production gate is lifted.
 *
 * v2 semantics differ from v1 in two observable ways the tests pin:
 *   1. There is NO additive HFA on top of the vig-free moneyline. At a
 *      neutral market (-110/-110, spread 0) with no features, the model
 *      returns 0.5 exactly — not 0.5 + HFA.
 *   2. Real independent features (ATS form, points-for/against
 *      differential, rest) can shift expected margin by up to ~±9 pts
 *      combined, vs ~±0.6 pts in v1. Each feature is sample-gated and
 *      magnitude-clamped to prevent extreme inputs from blowing up the
 *      market-derived prior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  predict,
  MARGIN_STD_DEV,
  REST_ADV_POINTS_PER_DAY,
  ATS_FORM_MAX_ADJ,
  ATS_MIN_SAMPLE,
  PPG_DIFF_WEIGHT,
  PPG_DIFF_MAX_ADJ,
  PPG_MIN_SAMPLE,
} from "../../prediction/nflSpreadModel";
import type { GameMarketInput, GameFeatures } from "../scorePicks";

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

function featureRow(o: Partial<GameFeatures> = {}): GameFeatures {
  return {
    homeTeamAbbrev: "buf",
    awayTeamAbbrev: "kc",
    homeTeamRestDays: 7,
    awayTeamRestDays: 7,
    homeTeamB2B: false,
    awayTeamB2B: false,
    homeTeamHomeATS: 0.5,
    awayTeamRoadATS: 0.5,
    homeTeamOverRate: 0.5,
    awayTeamOverRate: 0.5,
    restAdvantage: 0,
    atsSampleSize: 0,
    scoredGamesSampleSize: 0,
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

// ---------------------------------------------------------------------------
// Baseline / contract tests (preserved from v1, semantics unchanged)
// ---------------------------------------------------------------------------

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

test("favored home (negative spread) shrinks home cover prob below the moneyline implied", async () => {
  // Heavy home favorite at -7 — ML implies ~70% to win, but covering -7
  // is harder. v2 still expects this because the math (probToMargin →
  // normalCdf around the line) is unchanged from v1.
  const heavyFavorite = await predict(
    game({ homePublishMl: -300, awayPublishMl: 240, publishSpread: -7 })
  );
  assert.ok(heavyFavorite.rawProbHome! < 0.7, "covering -7 must be harder than winning outright");
  assert.ok(heavyFavorite.rawProbHome! > 0.4, "but still better than coin flip when heavy fav");
});

test("returns marginStdDev for downstream consumers", async () => {
  const out = await predict(game());
  assert.equal(out.marginStdDev, MARGIN_STD_DEV);
});

test("probability output is clamped to [0.05, 0.95]", async () => {
  const out = await predict(
    game({ homePublishMl: -10000, awayPublishMl: 5000, publishSpread: -1 })
  );
  assert.ok(out.rawProbHome! <= 0.95);
  assert.ok(out.rawProbAway! >= 0.05);
});

// ---------------------------------------------------------------------------
// v2 semantic changes — HFA double-count removed
// ---------------------------------------------------------------------------

test("v2: at neutral market and zero features, prob = 0.5 exactly (no HFA double-count)", async () => {
  // -110/-110 ML → vig-free home prob = 0.5 → probToMargin(0.5) = 0.
  // No features, spread = 0 → home covers iff actual margin > 0 →
  // model says exactly 50%. v1 returned ~0.518 here because of the
  // additive HFA term on top of the vig-free prior.
  const out = await predict(game({ publishSpread: 0 }));
  assert.ok(
    Math.abs(out.rawProbHome! - 0.5) < 1e-9,
    `expected exactly 0.5 at neutral market (HFA must not be double-counted), got ${out.rawProbHome}`
  );
  assert.ok(Math.abs(out.expectedMargin! - 0) < 1e-9);
});

test("v2: at neutral market with home-favoring features, prob > 0.5 (features express signal)", async () => {
  // Same neutral market as above but now home has a real ATS edge AND
  // a real points-differential edge. Prob should rise above 0.5
  // strictly because of features, not HFA.
  const out = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        atsSampleSize: 12,
        homeTeamHomeATS: 0.7,
        awayTeamRoadATS: 0.4,
        homeGoalsForAvg: 28,
        homeGoalsAgainstAvg: 18,
        awayGoalsForAvg: 22,
        awayGoalsAgainstAvg: 24,
      }),
    })
  );
  assert.ok(
    out.rawProbHome! > 0.5,
    `expected home > 0.5 with home-favoring features, got ${out.rawProbHome}`
  );
});

// ---------------------------------------------------------------------------
// Feature: real rest (preserved weight from v1)
// ---------------------------------------------------------------------------

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

test("negative rest advantage (away rested more) shifts expected margin away", async () => {
  const out = await predict(
    game({ features: featureRow({ restAdvantage: -4 }) })
  );
  const baseline = await predict(game({ features: featureRow() }));
  assert.ok(out.expectedMargin! < baseline.expectedMargin!);
});

// ---------------------------------------------------------------------------
// Feature: home/road ATS form (new in v2)
// ---------------------------------------------------------------------------

test("ATS form: home covering recently shifts expected margin home", async () => {
  const baseline = await predict(
    game({
      features: featureRow({
        atsSampleSize: 12,
        homeTeamHomeATS: 0.5,
        awayTeamRoadATS: 0.5,
      }),
    })
  );
  const homeHot = await predict(
    game({
      features: featureRow({
        atsSampleSize: 12,
        homeTeamHomeATS: 0.7,
        awayTeamRoadATS: 0.5,
      }),
    })
  );
  assert.ok(homeHot.expectedMargin! > baseline.expectedMargin!);
});

test("ATS form: sample below ATS_MIN_SAMPLE has no effect", async () => {
  const small = await predict(
    game({
      features: featureRow({
        atsSampleSize: ATS_MIN_SAMPLE - 1,
        homeTeamHomeATS: 0.9, // huge ATS edge but sample too small
        awayTeamRoadATS: 0.1,
      }),
    })
  );
  const enough = await predict(
    game({
      features: featureRow({
        atsSampleSize: ATS_MIN_SAMPLE,
        homeTeamHomeATS: 0.9,
        awayTeamRoadATS: 0.1,
      }),
    })
  );
  // Below threshold: ATS contributes nothing. The PPG feature is also
  // gated to PPG_MIN_SAMPLE which IS satisfied at ATS_MIN_SAMPLE-1=9,
  // but we kept PPG values at 0 so it doesn't fire either.
  assert.ok(Math.abs(small.expectedMargin! - 0) < 1e-9);
  // At threshold: ATS fires and pushes margin home.
  assert.ok(enough.expectedMargin! > 0);
});

test("ATS form: contribution is clamped to ATS_FORM_MAX_ADJ", async () => {
  // Extreme: home covers 100% home, away covers 0% road → raw shift
  // would be (1.0 - 0.5)*5 - (0.0 - 0.5)*5 = 2.5 - (-2.5) = 5.0 pts,
  // but the clamp caps at ATS_FORM_MAX_ADJ = 2.5.
  const out = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        atsSampleSize: 50,
        homeTeamHomeATS: 1.0,
        awayTeamRoadATS: 0.0,
      }),
    })
  );
  // With no other features the entire expectedMargin should be the
  // clamped ATS contribution (rest=0, PPG=0 because GoalsFor=0 gates).
  assert.ok(
    Math.abs(out.expectedMargin! - ATS_FORM_MAX_ADJ) < 1e-9,
    `expected clamped ATS shift ${ATS_FORM_MAX_ADJ}, got ${out.expectedMargin}`
  );
});

// ---------------------------------------------------------------------------
// Feature: recent points-for / points-against differential (new in v2)
// ---------------------------------------------------------------------------

test("PPG differential: home stronger net-PPG shifts expected margin home", async () => {
  const baseline = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        scoredGamesSampleSize: PPG_MIN_SAMPLE,
        homeGoalsForAvg: 24,
        awayGoalsForAvg: 24,
        homeGoalsAgainstAvg: 24,
        awayGoalsAgainstAvg: 24,
      }),
    })
  );
  const homeStronger = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        scoredGamesSampleSize: PPG_MIN_SAMPLE,
        homeGoalsForAvg: 28, // +4 PF
        awayGoalsForAvg: 24,
        homeGoalsAgainstAvg: 18, // -6 PA → net +10
        awayGoalsAgainstAvg: 24, // net 0
      }),
    })
  );
  // Net diff = +10 → expected shift = 10 * 0.30 = 3.0 pts
  const expectedShift = 10 * PPG_DIFF_WEIGHT;
  assert.ok(
    Math.abs(homeStronger.expectedMargin! - baseline.expectedMargin! - expectedShift) < 1e-9,
    `expected shift ${expectedShift}, got ${homeStronger.expectedMargin! - baseline.expectedMargin!}`
  );
});

test("PPG differential: home weaker net-PPG shifts expected margin away (sign handling)", async () => {
  const out = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        scoredGamesSampleSize: PPG_MIN_SAMPLE,
        homeGoalsForAvg: 18,
        homeGoalsAgainstAvg: 28, // home net = -10
        awayGoalsForAvg: 28,
        awayGoalsAgainstAvg: 18, // away net = +10
      }),
    })
  );
  // Net diff = -20 → raw shift = -20 * 0.30 = -6.0 pts → clamped to -5.0
  assert.ok(out.expectedMargin! < 0, `expected negative margin, got ${out.expectedMargin}`);
  assert.ok(
    Math.abs(out.expectedMargin! - -PPG_DIFF_MAX_ADJ) < 1e-9,
    `expected clamped to ${-PPG_DIFF_MAX_ADJ}, got ${out.expectedMargin}`
  );
});

test("PPG differential: contribution is clamped to ±PPG_DIFF_MAX_ADJ", async () => {
  // Extreme: home net +30 vs away net -30 → raw shift = 60 * 0.30 = 18 pts
  // → clamped to +5.0.
  const out = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        scoredGamesSampleSize: PPG_MIN_SAMPLE,
        homeGoalsForAvg: 35,
        homeGoalsAgainstAvg: 5,
        awayGoalsForAvg: 5,
        awayGoalsAgainstAvg: 35,
      }),
    })
  );
  assert.ok(
    Math.abs(out.expectedMargin! - PPG_DIFF_MAX_ADJ) < 1e-9,
    `expected clamped to ${PPG_DIFF_MAX_ADJ}, got ${out.expectedMargin}`
  );
});

test("PPG differential: gated off when scoredGamesSampleSize < PPG_MIN_SAMPLE (Week-1 case)", async () => {
  // Massive PPG edge but only 1-2 games played with finals → no signal yet.
  const out = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        scoredGamesSampleSize: PPG_MIN_SAMPLE - 1,
        homeGoalsForAvg: 35,
        homeGoalsAgainstAvg: 5,
        awayGoalsForAvg: 5,
        awayGoalsAgainstAvg: 35,
      }),
    })
  );
  // Below sample threshold: PPG must not contribute.
  // ATS is also off (atsSampleSize=0, default), rest is 0.
  // Result must be exactly 0.
  assert.ok(Math.abs(out.expectedMargin! - 0) < 1e-9);
});

test("PPG differential: PPG_MIN_SAMPLE gate is decoupled from atsSampleSize (live-pipeline integration)", async () => {
  // Mirrors exactly what `featureEngine.computeAllFeatures` produces in
  // the live pipeline today: ATS data is stubbed at 0.5/0.5 with
  // atsSampleSize=0 (pending a real ATS feed), but PPG averages and
  // scoredGamesSampleSize ARE real because they come from actual
  // historical scores. PPG must fire in this configuration; if it
  // didn't, the v2 redesign would be effectively no-op against the
  // backtest harness.
  const out = await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        atsSampleSize: 0, // stubbed (real-pipeline state today)
        homeTeamHomeATS: 0.5, // stubbed
        awayTeamRoadATS: 0.5, // stubbed
        scoredGamesSampleSize: 8, // real
        homeGoalsForAvg: 28,
        homeGoalsAgainstAvg: 18, // home net = +10
        awayGoalsForAvg: 22,
        awayGoalsAgainstAvg: 24, // away net = -2
      }),
    })
  );
  // v2.1: Net diff = +12 → shift = 12 * 0.15 = +1.8 pts (within ±2.5 cap).
  // ATS dormant, rest = 0, so this is the entire expected margin.
  assert.ok(
    Math.abs(out.expectedMargin! - 1.8) < 1e-9,
    `PPG must fire even when ATS is stubbed; expected 1.8, got ${out.expectedMargin}`
  );
});

// ---------------------------------------------------------------------------
// Combined-feature behavior (calibration sanity)
// ---------------------------------------------------------------------------

test("combined features compose additively and prob-sum invariant holds", async () => {
  const out = await predict(
    game({
      publishSpread: -3,
      features: featureRow({
        restAdvantage: 3,
        atsSampleSize: 12,
        scoredGamesSampleSize: 8,
        homeTeamHomeATS: 0.7,
        awayTeamRoadATS: 0.4,
        homeGoalsForAvg: 28,
        homeGoalsAgainstAvg: 18, // net +10
        awayGoalsForAvg: 22,
        awayGoalsAgainstAvg: 24, // net -2
      }),
    })
  );
  // Expected components (v2.1 calibration shrink):
  //   probToMargin(0.5, 13.45) = 0   (since -110/-110 ML)
  //   rest:  3 * 0.20 = +0.6
  //   ATS:   ((0.7-0.5)*2.5) - ((0.4-0.5)*2.5) = 0.5 - (-0.25) = +0.75  (within ±1.25 cap)
  //   PPG:   (10 - (-2)) * 0.15 = +1.8  (within ±2.5 cap)
  //   total: 0 + 0.6 + 0.75 + 1.8 = +3.15 pts
  assert.ok(
    Math.abs(out.expectedMargin! - 3.15) < 1e-6,
    `expected combined margin ~3.15, got ${out.expectedMargin}`
  );
  // Prob-sum invariant must always hold regardless of feature stack.
  assert.ok(Math.abs(out.rawProbHome! + out.rawProbAway! - 1) < 1e-9);
});

test("v2 expressiveness: combined max feature shift can move prob meaningfully (>5pp)", async () => {
  // Calibration sanity: v1's only feature path was rest at 0.20 pt/day,
  // capped by realistic rest deltas — typical max shift was ~±0.6 pts =
  // ~±2pp on cover prob. v2 with ATS + PPG + rest must be able to move
  // cover prob by more than 5 percentage points at a fixed market line.
  const baselineProb = (await predict(
    game({ publishSpread: 0, features: featureRow() })
  )).rawProbHome!;
  const maxHomeProb = (await predict(
    game({
      publishSpread: 0,
      features: featureRow({
        restAdvantage: 7,
        atsSampleSize: 50,
        scoredGamesSampleSize: 16,
        homeTeamHomeATS: 1.0,
        awayTeamRoadATS: 0.0,
        homeGoalsForAvg: 32,
        homeGoalsAgainstAvg: 14,
        awayGoalsForAvg: 14,
        awayGoalsAgainstAvg: 32,
      }),
    })
  )).rawProbHome!;
  assert.ok(
    maxHomeProb - baselineProb > 0.05,
    `expected v2 features to move cover prob by >5pp, got ${maxHomeProb - baselineProb}`
  );
});
