import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOfficialPerformanceRows } from "../officialPerformanceMerge";

function makeEvaluationRow(
  overrides: Partial<Parameters<typeof mergeOfficialPerformanceRows>[0]["evaluationRows"][number]> = {},
) {
  return {
    date: "2026-05-01",
    gameKey: "nba_2026-05-01_bos_nyk",
    league: "nba",
    market: "spread",
    pick: "home",
    result: "win",
    publishOdds: "-110",
    publishLine: "-4.5",
    closeOdds: "-115",
    closeLine: "-5.0",
    modelProbCalibrated: "0.57",
    edge: "0.05",
    ev: "0.03",
    clvImpliedDelta: "0.011",
    tier: "A",
    ...overrides,
  };
}

function makeScoredPickRow(
  overrides: Partial<Parameters<typeof mergeOfficialPerformanceRows>[0]["scoredPickRows"][number]> = {},
) {
  return {
    id: 101,
    ...makeEvaluationRow(),
    ...overrides,
  };
}

test("mergeOfficialPerformanceRows: evaluation_results row wins over overlapping scored_picks row", () => {
  const merged = mergeOfficialPerformanceRows({
    evaluationRows: [makeEvaluationRow()],
    scoredPickRows: [makeScoredPickRow()],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, -1, "evaluation row should survive with synthetic negative id");
  assert.equal(merged[0]?.publishOdds, -110);
});

test("mergeOfficialPerformanceRows: non-overlapping scored_picks history is preserved", () => {
  const merged = mergeOfficialPerformanceRows({
    evaluationRows: [makeEvaluationRow()],
    scoredPickRows: [
      makeScoredPickRow({
        id: 202,
        date: "2026-04-18",
        gameKey: "nhl_2026-04-18_njd_nyr",
        league: "nhl",
        market: "moneyline",
        pick: "away",
      }),
    ],
  });

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((row) => row.id),
    [-1, 202],
  );
});

test("mergeOfficialPerformanceRows: overlap key includes pick, so opposite sides do not collapse", () => {
  const merged = mergeOfficialPerformanceRows({
    evaluationRows: [makeEvaluationRow({ pick: "home" })],
    scoredPickRows: [makeScoredPickRow({ id: 303, pick: "away" })],
  });

  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((row) => row.pick),
    ["home", "away"],
  );
});
