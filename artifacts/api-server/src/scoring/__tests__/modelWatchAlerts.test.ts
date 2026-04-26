import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateModelWatchAlerts,
  type AlertCandidate,
} from "../modelWatchAlerts";
import {
  aggregateByLeagueMarket,
  type AggregatorRow,
} from "../modelWatchAggregator";
import type { ModelWatchAlertThresholds } from "../../config/scoringModelConfig";

/**
 * The pure threshold-evaluation step is the only Model-Watch-alert
 * logic that lives in JS — everything else is a thin DB read/write.
 * Locking the threshold math here keeps the nightly cron from
 * silently changing what it considers a "promotable" market.
 *
 * Test inputs are built by feeding raw rows through the same
 * aggregator the live runner uses, so the behaviour under test
 * matches what the cron would actually see.
 */

const T: ModelWatchAlertThresholds = {
  minResolved: 50,
  minRoi: 0.04,
  minAvgClv: 0.005,
};

const baseRow = (over: Partial<AggregatorRow>): AggregatorRow => ({
  league: "nhl",
  market: "spread",
  tier: "A",
  publishOdds: -110,
  edge: 0.05,
  ev: 0.02,
  result: "win",
  clvImpliedDelta: 0.01,
  ...over,
});

/** Build N resolved rows: `wins` wins at +200 then losses at -110. */
function bucketRows(opts: {
  league?: string;
  market?: string;
  wins: number;
  losses: number;
  pushes?: number;
  pending?: number;
  clvDelta?: number | null;
}): AggregatorRow[] {
  const rows: AggregatorRow[] = [];
  const league = opts.league ?? "nhl";
  const market = opts.market ?? "spread";
  // Use `in` so an EXPLICIT null clvDelta is honoured (?? would coerce
  // null back to the default 0.01 and silently break the zero-CLV test).
  const clvDelta: number | null = "clvDelta" in opts ? opts.clvDelta ?? null : 0.01;
  for (let i = 0; i < opts.wins; i++) {
    rows.push(
      baseRow({
        league,
        market,
        result: "win",
        publishOdds: 200,
        clvImpliedDelta: clvDelta,
      })
    );
  }
  for (let i = 0; i < opts.losses; i++) {
    rows.push(
      baseRow({
        league,
        market,
        result: "loss",
        publishOdds: -110,
        clvImpliedDelta: clvDelta,
      })
    );
  }
  for (let i = 0; i < (opts.pushes ?? 0); i++) {
    rows.push(
      baseRow({
        league,
        market,
        result: "push",
        clvImpliedDelta: clvDelta,
      })
    );
  }
  for (let i = 0; i < (opts.pending ?? 0); i++) {
    rows.push(
      baseRow({
        league,
        market,
        result: "pending",
        clvImpliedDelta: null,
      })
    );
  }
  return rows;
}

test("evaluateModelWatchAlerts: no buckets -> no alerts", () => {
  assert.deepEqual(evaluateModelWatchAlerts([], T), []);
});

test("evaluateModelWatchAlerts: bucket below resolved-sample floor does NOT fire", () => {
  // 49 resolved rows, ROI well above 4%, CLV well above 0.5pp
  const rows = bucketRows({ wins: 30, losses: 19, clvDelta: 0.02 });
  assert.equal(rows.length, 49);
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 0);
});

test("evaluateModelWatchAlerts: bucket clearing all three thresholds fires once", () => {
  // 60 resolved: 30 wins at +200 (+2u each = +60u), 30 losses (-30u) → +30u/60 = 50% ROI.
  // CLV +1pp on every row → mean CLV 0.01 (above 0.005 floor).
  const rows = bucketRows({ wins: 30, losses: 30, clvDelta: 0.01 });
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 1);
  const a = alerts[0] as AlertCandidate;
  assert.equal(a.league, "nhl");
  assert.equal(a.market, "spread");
  assert.equal(a.resolved, 60);
  assert.ok(a.roi > 0.04, `ROI ${a.roi} should clear floor`);
  assert.ok(a.avgClv > 0.005, `avgClv ${a.avgClv} should clear floor`);
  assert.equal(a.clvSampleSize, 60);
});

test("evaluateModelWatchAlerts: bucket with positive ROI but zero CLV sample does NOT fire", () => {
  // Plenty of resolved sample and great ROI, but every row has a null
  // CLV delta (pre-CLV writeback). We require at least one usable CLV
  // row before evaluating mean CLV — without it the leading indicator
  // is missing and an alert would be premature.
  const rows = bucketRows({ wins: 40, losses: 20, clvDelta: null });
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 0);
});

test("evaluateModelWatchAlerts: ROI above floor but CLV below floor does NOT fire", () => {
  // Strong ROI, but mean CLV is exactly at 0.001 — below 0.005 floor.
  const rows = bucketRows({ wins: 30, losses: 30, clvDelta: 0.001 });
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 0);
});

test("evaluateModelWatchAlerts: CLV above floor but ROI below floor does NOT fire", () => {
  // 60 resolved, but at -110 wins/losses and a 50/50 split → ROI < 0
  // (the vig). CLV is fine. Should still not fire.
  const rows: AggregatorRow[] = [];
  for (let i = 0; i < 30; i++)
    rows.push(baseRow({ result: "win", publishOdds: -110, clvImpliedDelta: 0.02 }));
  for (let i = 0; i < 30; i++)
    rows.push(baseRow({ result: "loss", publishOdds: -110, clvImpliedDelta: 0.02 }));
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 0);
});

test("evaluateModelWatchAlerts: pending rows do NOT count toward resolved-sample floor", () => {
  // 49 resolved + 100 pending → still below the floor of 50.
  const rows = bucketRows({
    wins: 30,
    losses: 19,
    pending: 100,
    clvDelta: 0.02,
  });
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 0);
});

test("evaluateModelWatchAlerts: pushes count toward resolved sample (matches aggregator)", () => {
  // 25 wins at +200 (+50u), 25 losses (-25u), 5 pushes (0u) = +25u/55 = 45.5% ROI
  // 55 resolved >= 50 floor.
  const rows = bucketRows({
    wins: 25,
    losses: 25,
    pushes: 5,
    clvDelta: 0.01,
  });
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].resolved, 55);
});

test("evaluateModelWatchAlerts: multiple eligible buckets each fire independently", () => {
  const rows = [
    ...bucketRows({
      league: "nhl",
      market: "spread",
      wins: 30,
      losses: 30,
      clvDelta: 0.01,
    }),
    ...bucketRows({
      league: "mlb",
      market: "moneyline",
      wins: 30,
      losses: 30,
      clvDelta: 0.01,
    }),
  ];
  const alerts = evaluateModelWatchAlerts(
    aggregateByLeagueMarket(rows, []),
    T
  );
  assert.equal(alerts.length, 2);
  assert.ok(alerts.some((a) => a.league === "nhl" && a.market === "spread"));
  assert.ok(alerts.some((a) => a.league === "mlb" && a.market === "moneyline"));
});

test("evaluateModelWatchAlerts: thresholds are honoured (stricter floor blocks an otherwise-firing bucket)", () => {
  const rows = bucketRows({ wins: 30, losses: 30, clvDelta: 0.01 });
  const buckets = aggregateByLeagueMarket(rows, []);
  // Default thresholds → 1 alert
  assert.equal(evaluateModelWatchAlerts(buckets, T).length, 1);
  // Raise ROI floor above what this bucket produces → 0 alerts
  const stricter: ModelWatchAlertThresholds = {
    minResolved: 50,
    minRoi: 0.99,
    minAvgClv: 0.005,
  };
  assert.equal(evaluateModelWatchAlerts(buckets, stricter).length, 0);
});
