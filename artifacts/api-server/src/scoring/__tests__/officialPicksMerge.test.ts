import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOfficialPickRows } from "../officialPicksMerge";

type CandidateRowInput = NonNullable<
  Parameters<typeof mergeOfficialPickRows>[0]["candidateRows"]
>[number];

function makeEvaluationRow(
  overrides: Partial<Parameters<typeof mergeOfficialPickRows>[0]["evaluationRows"][number]> = {},
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
    modelProbRaw: "0.56",
    modelProbCalibrated: "0.57",
    marketProbFair: "0.52",
    edge: "0.05",
    ev: "0.03",
    rankScore: "0.88",
    tier: "A",
    clvLineDelta: "0.5",
    clvImpliedDelta: "0.011",
    modelVersion: "v1",
    scoringVersion: "v1",
    ...overrides,
  };
}

function makeScoredPickRow(
  overrides: Partial<Parameters<typeof mergeOfficialPickRows>[0]["scoredPickRows"][number]> = {},
) {
  return {
    id: 101,
    eventStart: "2026-05-01T23:10:00.000Z",
    createdAt: "2026-05-01T12:00:00.000Z",
    ...makeEvaluationRow(),
    ...overrides,
  };
}

function makeCandidateRow(
  overrides: Partial<CandidateRowInput> = {},
) {
  return {
    date: "2026-05-01",
    gameKey: "nba_2026-05-01_bos_nyk",
    market: "spread",
    pick: "home",
    eventStart: "2026-05-01T23:10:00.000Z",
    createdAt: "2026-05-01T11:30:00.000Z",
    ...overrides,
  };
}

test("mergeOfficialPickRows: evaluation row wins while retaining scored eventStart on overlap", () => {
  const merged = mergeOfficialPickRows({
    evaluationRows: [makeEvaluationRow()],
    scoredPickRows: [makeScoredPickRow()],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 101);
  assert.equal(merged[0]?.eventStart, "2026-05-01T23:10:00.000Z");
  assert.equal(merged[0]?.publishOdds, -110);
  assert.equal(merged[0]?.rankScore, 0.88);
});

test("mergeOfficialPickRows: eval-only row can source eventStart from candidate history", () => {
  const merged = mergeOfficialPickRows({
    evaluationRows: [makeEvaluationRow()],
    scoredPickRows: [],
    candidateRows: [makeCandidateRow()],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, -1);
  assert.equal(merged[0]?.eventStart, "2026-05-01T23:10:00.000Z");
  assert.equal(merged[0]?.createdAt, "2026-05-01T11:30:00.000Z");
});

test("mergeOfficialPickRows: historical scored row is preserved when no evaluation row overlaps", () => {
  const merged = mergeOfficialPickRows({
    evaluationRows: [],
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

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 202);
  assert.equal(merged[0]?.pick, "away");
});
