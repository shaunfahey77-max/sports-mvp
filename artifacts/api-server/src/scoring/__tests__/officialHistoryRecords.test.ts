import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficialHistoryRecords,
  mergeOfficialHistoryRows,
} from "../officialHistoryRecords";

function makeRow(overrides: Partial<Parameters<typeof buildOfficialHistoryRecords>[0]["rows"][number]> = {}) {
  return {
    id: 1,
    date: "2026-05-05",
    league: "nba",
    market: "spread",
    pick: "home",
    publishOdds: -110,
    closeOdds: -115,
    closeLine: -5,
    publishLine: -4.5,
    modelProbCalibrated: 0.57,
    result: "win" as const,
    ev: 0.03,
    edge: 0.05,
    clvImpliedDelta: 0.011,
    tier: "A",
    modelVersion: "v2",
    createdAt: "2026-05-05T12:00:00.000Z",
    ...overrides,
  };
}

test("buildOfficialHistoryRecords: groups rows by date and computes daily metrics", () => {
  const records = buildOfficialHistoryRecords({
    rows: [
      makeRow({ result: "win", publishOdds: -110 }),
      makeRow({ id: 2, pick: "away", result: "loss", publishOdds: -110 }),
    ],
    limit: 10,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.runDate, "2026-05-05");
  assert.equal(records[0]?.totalPicks, 2);
  assert.equal(records[0]?.winRate, 0.5);
});

test("buildOfficialHistoryRecords: returns newest dates first and respects limit", () => {
  const records = buildOfficialHistoryRecords({
    rows: [
      makeRow({ date: "2026-05-03", createdAt: "2026-05-03T12:00:00.000Z" }),
      makeRow({ date: "2026-05-05", createdAt: "2026-05-05T12:00:00.000Z" }),
      makeRow({ date: "2026-05-04", createdAt: "2026-05-04T12:00:00.000Z" }),
    ],
    limit: 2,
  });

  assert.deepEqual(
    records.map((r) => r.runDate),
    ["2026-05-05", "2026-05-04"],
  );
});

test("buildOfficialHistoryRecords: uses explicit filters when provided", () => {
  const records = buildOfficialHistoryRecords({
    rows: [makeRow({ league: "nhl", market: "moneyline" })],
    league: "nhl",
    market: "moneyline",
    limit: 10,
  });

  assert.equal(records[0]?.league, "nhl");
  assert.equal(records[0]?.market, "moneyline");
});

test("mergeOfficialHistoryRows: evaluation rows win only when a scored historical row exists", () => {
  const rows = mergeOfficialHistoryRows({
    evaluationRows: [
      {
        date: "2026-05-05",
        gameKey: "nba_2026-05-05_bos_nyk",
        league: "nba",
        market: "spread",
        pick: "home",
        result: "win",
        publishOdds: "-110",
        publishLine: "-4.5",
        closeOdds: "-115",
        closeLine: "-5",
        modelProbCalibrated: "0.57",
        edge: "0.05",
        ev: "0.03",
        clvImpliedDelta: "0.011",
        tier: "A",
      },
    ],
    scoredPickRows: [
      {
        id: 10,
        date: "2026-05-05",
        gameKey: "nba_2026-05-05_bos_nyk",
        league: "nba",
        market: "spread",
        pick: "home",
        result: "win",
        publishOdds: "-110",
        publishLine: "-4.5",
        closeOdds: "-115",
        closeLine: "-5",
        modelProbCalibrated: "0.57",
        edge: "0.05",
        ev: "0.03",
        clvImpliedDelta: "0.011",
        tier: "A",
        modelVersion: "v2",
        createdAt: "2026-05-05T12:00:00.000Z",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, 10);
  assert.equal(rows[0]?.modelVersion, "v2");
});
