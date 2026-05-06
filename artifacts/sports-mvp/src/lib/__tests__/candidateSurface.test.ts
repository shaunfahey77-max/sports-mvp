import { test } from "node:test";
import assert from "node:assert/strict";
import type { CandidateBet } from "@workspace/api-client-react";
import {
  partitionCandidatesBySurfaceStatus,
  resolveCandidateSurfaceStatus,
} from "../candidateSurface";

function makeCandidate(
  overrides: Partial<CandidateBet> = {},
): CandidateBet {
  return {
    id: 1,
    gameKey: "nba_2026-05-06_bos_nyk",
    league: "nba",
    marketType: "spread",
    side: "home",
    eventStart: "2026-05-06T23:30:00Z",
    publishOdds: -110,
    publishLine: -4.5,
    modelProbRaw: 0.58,
    modelProbCalibrated: 0.57,
    marketProbFair: 0.52,
    edge: 0.05,
    ev: 0.03,
    rankScore: 0.8,
    tier: "A",
    calibrationMethod: "sigmoid",
    calibrationVersion: "v1",
    marketQuality: 0.9,
    selectionReason: "high_rank_score",
    surfaceStatus: "shadow",
    snapshotDate: "2026-05-06",
    modelVersion: "v1",
    createdAt: "2026-05-06T18:00:00Z",
    ...overrides,
  };
}

test("resolveCandidateSurfaceStatus: prefers persisted surfaceStatus", () => {
  assert.equal(
    resolveCandidateSurfaceStatus(
      makeCandidate({
        surfaceStatus: "suppressed",
        selectionReason: "model_watch_only",
      }),
    ),
    "suppressed",
  );
});

test("resolveCandidateSurfaceStatus: falls back from legacy selectionReason", () => {
  assert.equal(
    resolveCandidateSurfaceStatus(
      makeCandidate({
        surfaceStatus: undefined,
        selectionReason: "model_watch_only",
      }),
    ),
    "model_watch",
  );
  assert.equal(
    resolveCandidateSurfaceStatus(
      makeCandidate({
        surfaceStatus: undefined,
        selectionReason: "market_disabled",
      }),
    ),
    "suppressed",
  );
});

test("partitionCandidatesBySurfaceStatus: live candidates are non-PASS and not suppressed", () => {
  const { liveCandidates } = partitionCandidatesBySurfaceStatus([
    makeCandidate({ id: 1, tier: "A", surfaceStatus: "shadow" }),
    makeCandidate({ id: 2, tier: "B", surfaceStatus: "official" }),
    makeCandidate({ id: 3, tier: "C", surfaceStatus: "model_watch" }),
    makeCandidate({ id: 4, tier: "A", surfaceStatus: "suppressed" }),
    makeCandidate({ id: 5, tier: "PASS", surfaceStatus: "shadow" }),
  ]);

  assert.deepEqual(
    liveCandidates.map((c) => c.id),
    [1, 2, 3],
  );
});

test("partitionCandidatesBySurfaceStatus: fallback candidates are PASS plus model_watch only", () => {
  const { passCandidates } = partitionCandidatesBySurfaceStatus([
    makeCandidate({
      id: 10,
      tier: "PASS",
      surfaceStatus: "model_watch",
      selectionReason: "model_watch_only",
    }),
    makeCandidate({
      id: 11,
      tier: "PASS",
      surfaceStatus: "suppressed",
      selectionReason: "market_disabled",
    }),
    makeCandidate({
      id: 12,
      tier: "PASS",
      surfaceStatus: "shadow",
      selectionReason: "rank_score_below_threshold",
    }),
    makeCandidate({
      id: 13,
      tier: "A",
      surfaceStatus: "model_watch",
      selectionReason: "high_rank_score",
    }),
  ]);

  assert.deepEqual(
    passCandidates.map((c) => c.id),
    [10],
  );
});

test("partitionCandidatesBySurfaceStatus: legacy rows still group correctly without surfaceStatus", () => {
  const { liveCandidates, passCandidates } = partitionCandidatesBySurfaceStatus([
    makeCandidate({
      id: 20,
      tier: "PASS",
      surfaceStatus: undefined,
      selectionReason: "model_watch_only",
    }),
    makeCandidate({
      id: 21,
      tier: "A",
      surfaceStatus: undefined,
      selectionReason: null,
    }),
    makeCandidate({
      id: 22,
      tier: "A",
      surfaceStatus: undefined,
      selectionReason: "market_disabled",
    }),
  ]);

  assert.deepEqual(passCandidates.map((c) => c.id), [20]);
  assert.deepEqual(liveCandidates.map((c) => c.id), [21]);
});
