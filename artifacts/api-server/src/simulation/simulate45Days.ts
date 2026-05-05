/**
 * 45-Day Simulation Engine.
 * Provides an on-demand test harness for evaluating model/scoring versions
 * safely before production cutover.
 */

import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  candidateBetsTable,
  scoredPicksTable,
  simulationRunsTable,
} from "@workspace/db";
import { eq, and, between, gte, lte } from "drizzle-orm";
import {
  isOfficialCandidate,
  scorePicks,
  type GameMarketInput,
} from "../scoring/scorePicks";
import { computeClvImpliedDelta } from "../scoring/expectedValue";
import { computeValidationMetrics, type PickWithFullData } from "../scoring/validatePicks";
import { logger } from "../lib/logger";
import type { League, MarketType } from "../config/scoringModelConfig";
import { v4 as uuidv4 } from "uuid";

export interface SimulationConfig {
  startDate: string;
  days?: number;
  leagues?: League[];
  markets?: MarketType[];
  modelVersion?: string;
  scoringVersion?: string;
  calibrationVersion?: string;
}

export interface SimulationResults {
  totalPicks: number;
  picksPerDay: number;
  roi: number;
  winRate: number;
  unitsWon: number;
  avgEv: number;
  avgEdge: number;
  avgClv: number;
  clvHitRate: number;
  maxDrawdown: number;
  brierScore: number;
  logLoss: number;
  leagueBreakdown: Record<string, number>;
  marketBreakdown: Record<string, number>;
  tierBreakdown: Record<string, number>;
  dailyResults: Array<{
    date: string;
    picks: number;
    roi: number;
    winRate: number;
  }>;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Run the full 45-day simulation.
 * Creates a simulation run record and executes asynchronously.
 */
export async function runSimulation(config: SimulationConfig): Promise<string> {
  const runId = uuidv4();
  const days = config.days ?? 45;
  const leagues = config.leagues ?? ["nba", "nhl", "ncaam"];
  const markets = config.markets ?? ["moneyline", "spread", "total"];
  const modelVersion = config.modelVersion ?? "v1";
  const scoringVersion = config.scoringVersion ?? "v1";
  const calibrationVersion = config.calibrationVersion ?? "v1";
  const endDate = addDays(config.startDate, days - 1);

  await db.insert(simulationRunsTable).values({
    runId,
    startDate: config.startDate,
    endDate,
    days,
    leagues,
    markets,
    modelVersion,
    scoringVersion,
    calibrationVersion,
    status: "running",
  });

  executeSimulation({
    runId,
    startDate: config.startDate,
    days,
    leagues,
    markets,
    modelVersion,
    scoringVersion,
    calibrationVersion,
  }).catch((err) => {
    logger.error({ runId, err }, "Simulation failed");
    db.update(simulationRunsTable)
      .set({ status: "failed" })
      .where(eq(simulationRunsTable.runId, runId))
      .catch(() => {});
  });

  return runId;
}

async function executeSimulation(params: {
  runId: string;
  startDate: string;
  days: number;
  leagues: League[];
  markets: MarketType[];
  modelVersion: string;
  scoringVersion: string;
  calibrationVersion: string;
}): Promise<void> {
  const { runId, startDate, days, leagues, markets, modelVersion } = params;
  logger.info({ runId }, "Starting simulation execution");

  const allSimPicks: PickWithFullData[] = [];
  const dailyResults: Array<{ date: string; picks: number; roi: number; winRate: number }> = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);

    const snapshots = await db
      .select()
      .from(gameSnapshotsTable)
      .where(
        and(
          eq(gameSnapshotsTable.snapshotDate, date),
          // Only process leagues requested
        )
      );

    const leagueFiltered = snapshots.filter((s) =>
      (leagues as string[]).includes(s.league)
    );

    if (leagueFiltered.length === 0) {
      dailyResults.push({ date, picks: 0, roi: 0, winRate: 0 });
      continue;
    }

    const gameInputs: GameMarketInput[] = leagueFiltered.map((s) => ({
      gameKey: s.gameKey,
      league: s.league as League,
      eventStart: s.eventStart,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      homePublishMl: parseFloat(s.homePublishMl),
      awayPublishMl: parseFloat(s.awayPublishMl),
      publishSpread: s.publishSpread ? parseFloat(s.publishSpread) : null,
      publishSpreadLine: s.publishSpreadLine ? parseFloat(s.publishSpreadLine) : null,
      publishTotal: s.publishTotal ? parseFloat(s.publishTotal) : null,
      publishOverLine: s.publishOverLine ? parseFloat(s.publishOverLine) : null,
      publishUnderLine: s.publishUnderLine ? parseFloat(s.publishUnderLine) : null,
      snapshotDate: date,
    }));

    const candidates = await scorePicks(gameInputs, markets, modelVersion);

    const picks: PickWithFullData[] = require("../lib/pickUtils").capAndSort(
      candidates
        .filter((c) => isOfficialCandidate(c))
        .sort((a, b) => b.rankScore - a.rankScore)
    ).map((c: Awaited<ReturnType<typeof scorePicks>>[number]) => {
        const snap = leagueFiltered.find((s) => s.gameKey === c.gameKey);
        let result: "win" | "loss" | "push" | "pending" = "pending";

        if (snap && snap.homeScore != null && snap.awayScore != null) {
          const { computeOutcomeResult } = require("../scoring/validatePicks");
          // Canonical home spread and total come from the snapshot, not the
          // team-signed candidate.publishLine, so away picks grade correctly.
          result = computeOutcomeResult({
            market: c.marketType,
            pick: c.side,
            homeScore: snap.homeScore,
            awayScore: snap.awayScore,
            homeSpread: snap.publishSpread != null ? parseFloat(String(snap.publishSpread)) : null,
            total: snap.publishTotal != null ? parseFloat(String(snap.publishTotal)) : null,
          });
        }

        const closeOdds =
          c.marketType === "moneyline"
            ? c.side === "home"
              ? snap?.homeCloseMl
                ? parseFloat(snap.homeCloseMl)
                : null
              : snap?.awayCloseMl
              ? parseFloat(snap.awayCloseMl)
              : null
            : null;

        const clvImplied = computeClvImpliedDelta(c.publishOdds, closeOdds);

        return {
          id: 0,
          league: c.league,
          market: c.marketType,
          pick: c.side,
          publishOdds: c.publishOdds,
          closeOdds,
          closeLine: null,
          publishLine: c.publishLine ?? null,
          modelProbCalibrated: c.modelProbCalibrated,
          result,
          ev: c.ev,
          edge: c.edge,
          clvImpliedDelta: clvImplied,
          tier: c.tier,
        };
      });

    const dayMetrics = computeValidationMetrics(picks, 1);
    dailyResults.push({
      date,
      picks: picks.length,
      roi: dayMetrics.roi,
      winRate: dayMetrics.winRate,
    });

    allSimPicks.push(...picks);
  }

  const totalMetrics = computeValidationMetrics(allSimPicks, days);

  await db
    .update(simulationRunsTable)
    .set({
      status: "complete",
      totalPicks: totalMetrics.totalPicks,
      picksPerDay: String(totalMetrics.picksPerDay),
      roi: String(totalMetrics.roi),
      winRate: String(totalMetrics.winRate),
      unitsWon: String(totalMetrics.unitsWon),
      avgEv: String(totalMetrics.avgEv),
      avgEdge: String(totalMetrics.avgEdge),
      avgClv: String(totalMetrics.avgClv),
      clvHitRate: String(totalMetrics.clvHitRate),
      maxDrawdown: String(totalMetrics.maxDrawdown),
      results: {
        ...totalMetrics,
        dailyResults,
      },
      completedAt: new Date(),
    })
    .where(eq(simulationRunsTable.runId, runId));

  logger.info({ runId, totalPicks: totalMetrics.totalPicks }, "Simulation complete");
}
