import { computeValidationMetrics, type PickWithFullData } from "./validatePicks";

export type OfficialHistoryInputRow = PickWithFullData & {
  date: string;
  modelVersion: string;
  createdAt: string;
};

export type OfficialHistoryEvaluationRow = {
  date: string;
  gameKey: string;
  league: string;
  market: string;
  pick: string;
  result: string;
  publishOdds: string;
  publishLine: string | null;
  closeOdds: string | null;
  closeLine: string | null;
  modelProbCalibrated: string;
  edge: string;
  ev: string;
  clvImpliedDelta: string | null;
  tier: string;
};

export type OfficialHistoryScoredRow = OfficialHistoryEvaluationRow & {
  id: number;
  modelVersion: string;
  createdAt: string | Date;
};

export type OfficialHistoryRecord = {
  id: number;
  runDate: string;
  league: string | null;
  market: string | null;
  windowDays: number;
  totalPicks: number;
  roi: number;
  winRate: number;
  avgEv: number;
  clvHitRate: number;
  modelVersion: string;
  createdAt: string;
};

function keyOf(row: {
  date: string;
  gameKey: string;
  market: string;
  pick: string;
}): string {
  return `${row.date}|${row.gameKey}|${row.market}|${row.pick}`;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toNumOrNull(value: string | null): number | null {
  return value == null ? null : parseFloat(value);
}

export function mergeOfficialHistoryRows(args: {
  evaluationRows: readonly OfficialHistoryEvaluationRow[];
  scoredPickRows: readonly OfficialHistoryScoredRow[];
}): OfficialHistoryInputRow[] {
  const { evaluationRows, scoredPickRows } = args;
  const evaluationKeys = new Set(evaluationRows.map((row) => keyOf(row)));
  const scoredByKey = new Map(scoredPickRows.map((row) => [keyOf(row), row]));

  const mergedEvaluationRows: OfficialHistoryInputRow[] = evaluationRows
    .map((row, index) => {
      const scoredMatch = scoredByKey.get(keyOf(row));
      if (!scoredMatch) return null;

      return {
        id: scoredMatch.id ?? -1 - index,
        date: row.date,
        league: row.league,
        market: row.market,
        pick: row.pick,
        publishOdds: parseFloat(row.publishOdds),
        closeOdds: toNumOrNull(row.closeOdds),
        closeLine: toNumOrNull(row.closeLine),
        publishLine: toNumOrNull(row.publishLine),
        modelProbCalibrated: parseFloat(row.modelProbCalibrated),
        result: row.result as "win" | "loss" | "push" | "pending",
        ev: parseFloat(row.ev),
        edge: parseFloat(row.edge),
        clvImpliedDelta: toNumOrNull(row.clvImpliedDelta),
        tier: row.tier,
        modelVersion: scoredMatch.modelVersion,
        createdAt: toIsoString(scoredMatch.createdAt),
      };
    })
    .filter((row): row is OfficialHistoryInputRow => row !== null);

  const historicalFallbackRows: OfficialHistoryInputRow[] = scoredPickRows
    .filter((row) => !evaluationKeys.has(keyOf(row)))
    .map((row) => ({
      id: row.id,
      date: row.date,
      league: row.league,
      market: row.market,
      pick: row.pick,
      publishOdds: parseFloat(row.publishOdds),
      closeOdds: toNumOrNull(row.closeOdds),
      closeLine: toNumOrNull(row.closeLine),
      publishLine: toNumOrNull(row.publishLine),
      modelProbCalibrated: parseFloat(row.modelProbCalibrated),
      result: row.result as "win" | "loss" | "push" | "pending",
      ev: parseFloat(row.ev),
      edge: parseFloat(row.edge),
      clvImpliedDelta: toNumOrNull(row.clvImpliedDelta),
      tier: row.tier,
      modelVersion: row.modelVersion,
      createdAt: toIsoString(row.createdAt),
    }));

  return [...mergedEvaluationRows, ...historicalFallbackRows];
}

export function buildOfficialHistoryRecords(args: {
  rows: readonly OfficialHistoryInputRow[];
  league?: string;
  market?: string;
  limit: number;
}): OfficialHistoryRecord[] {
  const { rows, league, market, limit } = args;
  const grouped = new Map<string, OfficialHistoryInputRow[]>();

  for (const row of rows) {
    const bucket = grouped.get(row.date);
    if (bucket) bucket.push(row);
    else grouped.set(row.date, [row]);
  }

  const orderedDates = [...grouped.keys()].sort((a, b) => b.localeCompare(a));
  return orderedDates.slice(0, limit).map((runDate, index) => {
    const dayRows = grouped.get(runDate) ?? [];
    const metrics = computeValidationMetrics(dayRows, 1);
    const latestRow = [...dayRows].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];

    return {
      id: -1 - index,
      runDate,
      league: league ?? latestRow?.league ?? null,
      market: market ?? latestRow?.market ?? null,
      windowDays: 1,
      totalPicks: metrics.totalPicks,
      roi: metrics.roi,
      winRate: metrics.winRate,
      avgEv: metrics.avgEv,
      clvHitRate: metrics.clvHitRate,
      modelVersion: latestRow?.modelVersion ?? "v1",
      createdAt: latestRow?.createdAt ?? `${runDate}T00:00:00.000Z`,
    };
  });
}
