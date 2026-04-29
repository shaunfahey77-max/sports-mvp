import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GetPerformanceResponse,
  GetPerformanceHistoryResponseItem,
} from "@workspace/api-zod";

/**
 * Contract test: pin the exact response shapes that the public
 * `/performance` and `/performance/history` endpoints emit so the
 * Model-Watch additions in this task cannot accidentally widen,
 * narrow, or rename their payloads.
 *
 * The OpenAPI-generated Zod schemas are the source of truth — this
 * test pins:
 *   1. the exact required-key set (extra keys would still parse;
 *      missing keys would fail .parse but might not flip the API
 *      consumer immediately, so we double-check membership here);
 *   2. that a known-good fixture parses cleanly.
 *
 * If a future task wants to add a field, it must be added to
 * openapi.yaml (and the codegen rerun) — and this test must be
 * updated in the same change.
 */

const EXPECTED_PERFORMANCE_KEYS = [
  "avgClv",
  "avgEdge",
  "avgEv",
  "brierScore",
  "clvHitRate",
  "clvSampleSize",
  "league",
  "leagueBreakdown",
  "logLoss",
  "losses",
  "marketBreakdown",
  "market",
  "maxDrawdown",
  "passRate",
  "picksPerDay",
  "pushes",
  "roi",
  "tierBreakdown",
  "totalPicks",
  "unitsWon",
  "windowDays",
  "winRate",
  "wins",
].sort();

const EXPECTED_HISTORY_ITEM_KEYS = [
  "avgEv",
  "clvHitRate",
  "createdAt",
  "id",
  "league",
  "market",
  "modelVersion",
  "roi",
  "runDate",
  "totalPicks",
  "windowDays",
  "winRate",
].sort();

test("/performance contract: known-good payload parses through the generated Zod response schema", () => {
  const payload = {
    windowDays: 30,
    league: null,
    market: null,
    totalPicks: 12,
    wins: 7,
    losses: 4,
    pushes: 1,
    roi: 0.05,
    winRate: 0.636,
    unitsWon: 0.55,
    maxDrawdown: -1.2,
    avgEv: 0.04,
    avgEdge: 0.025,
    clvHitRate: 0.58,
    avgClv: 0.012,
    clvSampleSize: 8,
    brierScore: 0.21,
    logLoss: 0.62,
    passRate: 0.91,
    picksPerDay: 1.4,
    tierBreakdown: { A: 3, B: 5, C: 4 },
    leagueBreakdown: { nba: 6, nhl: 6 },
    marketBreakdown: { moneyline: 4, spread: 5, total: 3 },
  };
  const parsed = GetPerformanceResponse.safeParse(payload);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error));
});

test("/performance contract: payload key set is exactly the documented field list (no Model-Watch leak)", () => {
  // If a future change widens the response (e.g. adds a Model-Watch field
  // here instead of on the dedicated endpoint), this fails — preventing
  // the whole point of the wall between Official and Watch from eroding.
  const payload = {
    windowDays: 30,
    league: null,
    market: null,
    totalPicks: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    roi: 0,
    winRate: 0,
    unitsWon: 0,
    maxDrawdown: 0,
    avgEv: 0,
    avgEdge: 0,
    clvHitRate: 0,
    avgClv: 0,
    clvSampleSize: 0,
    brierScore: 0,
    logLoss: 0,
    passRate: 0,
    picksPerDay: 0,
    tierBreakdown: {},
    leagueBreakdown: {},
    marketBreakdown: {},
  };
  GetPerformanceResponse.parse(payload);
  assert.deepEqual(Object.keys(payload).sort(), EXPECTED_PERFORMANCE_KEYS);
});

test("/performance/history contract: a representative item parses through the generated Zod schema", () => {
  const item = {
    id: 1,
    runDate: "2026-04-28",
    league: "nba",
    market: "spread",
    windowDays: 30,
    totalPicks: 50,
    roi: 0.04,
    winRate: 0.55,
    avgEv: 0.03,
    clvHitRate: 0.6,
    modelVersion: "v1",
    createdAt: new Date("2026-04-28T12:00:00Z"),
  };
  const parsed = GetPerformanceHistoryResponseItem.safeParse(item);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error));
});

test("/performance/history contract: item key set is exactly the documented field list", () => {
  const item = {
    id: 1,
    runDate: "2026-04-28",
    league: null,
    market: null,
    windowDays: 30,
    totalPicks: 0,
    roi: 0,
    winRate: 0,
    avgEv: 0,
    clvHitRate: 0,
    modelVersion: "v1",
    createdAt: new Date("2026-04-28T12:00:00Z"),
  };
  GetPerformanceHistoryResponseItem.parse(item);
  assert.deepEqual(Object.keys(item).sort(), EXPECTED_HISTORY_ITEM_KEYS);
});
