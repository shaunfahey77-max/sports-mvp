type IsoDateish = string | Date | null | undefined;

export type OfficialPickLike = {
  id: number;
  date: string;
  gameKey: string;
  eventStart: IsoDateish;
  league: string;
  market: string;
  pick: string;
  result: string;
  publishOdds: string;
  publishLine: string | null;
  closeOdds: string | null;
  closeLine: string | null;
  modelProbRaw: string;
  modelProbCalibrated: string;
  marketProbFair: string;
  edge: string;
  ev: string;
  rankScore: string;
  tier: string;
  clvLineDelta: string | null;
  clvImpliedDelta: string | null;
  modelVersion: string;
  scoringVersion: string;
  createdAt: IsoDateish;
};

export type OfficialEvaluationPickRow = Omit<
  OfficialPickLike,
  "id" | "eventStart" | "createdAt"
>;

export type OfficialCandidateEventRow = {
  date: string;
  gameKey: string;
  market: string;
  pick: string;
  eventStart: IsoDateish;
  createdAt: IsoDateish;
};

function keyOf(row: {
  date: string;
  gameKey: string;
  market: string;
  pick: string;
}): string {
  return `${row.date}|${row.gameKey}|${row.market}|${row.pick}`;
}

function isoOrFallback(value: IsoDateish, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function numOrNull(value: string | null): number | null {
  return value == null ? null : parseFloat(value);
}

function num(value: string): number {
  return parseFloat(value);
}

export function mergeOfficialPickRows(args: {
  evaluationRows: readonly OfficialEvaluationPickRow[];
  scoredPickRows: readonly OfficialPickLike[];
  candidateRows?: readonly OfficialCandidateEventRow[];
}): Array<{
  id: number;
  date: string;
  gameKey: string;
  eventStart: string;
  league: string;
  market: string;
  pick: string;
  result: "win" | "loss" | "push" | "pending";
  publishOdds: number;
  publishLine: number | null;
  closeOdds: number | null;
  closeLine: number | null;
  modelProbRaw: number;
  modelProbCalibrated: number;
  marketProbFair: number;
  edge: number;
  ev: number;
  rankScore: number;
  tier: string;
  clvLineDelta: number | null;
  clvImpliedDelta: number | null;
  modelVersion: string;
  scoringVersion: string;
  createdAt: string;
}> {
  const { evaluationRows, scoredPickRows, candidateRows = [] } = args;
  const scoredByKey = new Map(scoredPickRows.map((row) => [keyOf(row), row]));
  const candidateByKey = new Map(
    candidateRows.map((row) => [keyOf(row), row]),
  );

  const mergedEvaluationRows = evaluationRows.map((row, index) => {
    const key = keyOf(row);
    const historical = scoredByKey.get(key);
    const candidate = candidateByKey.get(key);
    const fallbackInstant = `${row.date}T00:00:00.000Z`;

    return {
      id: historical?.id ?? -1 - index,
      date: row.date,
      gameKey: row.gameKey,
      eventStart: isoOrFallback(
        historical?.eventStart ?? candidate?.eventStart,
        fallbackInstant,
      ),
      league: row.league,
      market: row.market,
      pick: row.pick,
      result: row.result as "win" | "loss" | "push" | "pending",
      publishOdds: num(row.publishOdds),
      publishLine: numOrNull(row.publishLine),
      closeOdds: numOrNull(row.closeOdds),
      closeLine: numOrNull(row.closeLine),
      modelProbRaw: num(row.modelProbRaw),
      modelProbCalibrated: num(row.modelProbCalibrated),
      marketProbFair: num(row.marketProbFair),
      edge: num(row.edge),
      ev: num(row.ev),
      rankScore: num(row.rankScore),
      tier: row.tier,
      clvLineDelta: numOrNull(row.clvLineDelta),
      clvImpliedDelta: numOrNull(row.clvImpliedDelta),
      modelVersion: row.modelVersion,
      scoringVersion: row.scoringVersion,
      createdAt: isoOrFallback(
        historical?.createdAt ?? candidate?.createdAt,
        fallbackInstant,
      ),
    };
  });

  const evaluationKeys = new Set(evaluationRows.map((row) => keyOf(row)));
  const historicalFallbackRows = scoredPickRows
    .filter((row) => !evaluationKeys.has(keyOf(row)))
    .map((row) => ({
      id: row.id,
      date: row.date,
      gameKey: row.gameKey,
      eventStart: isoOrFallback(row.eventStart, `${row.date}T00:00:00.000Z`),
      league: row.league,
      market: row.market,
      pick: row.pick,
      result: row.result as "win" | "loss" | "push" | "pending",
      publishOdds: num(row.publishOdds),
      publishLine: numOrNull(row.publishLine),
      closeOdds: numOrNull(row.closeOdds),
      closeLine: numOrNull(row.closeLine),
      modelProbRaw: num(row.modelProbRaw),
      modelProbCalibrated: num(row.modelProbCalibrated),
      marketProbFair: num(row.marketProbFair),
      edge: num(row.edge),
      ev: num(row.ev),
      rankScore: num(row.rankScore),
      tier: row.tier,
      clvLineDelta: numOrNull(row.clvLineDelta),
      clvImpliedDelta: numOrNull(row.clvImpliedDelta),
      modelVersion: row.modelVersion,
      scoringVersion: row.scoringVersion,
      createdAt: isoOrFallback(row.createdAt, `${row.date}T00:00:00.000Z`),
    }));

  return [...mergedEvaluationRows, ...historicalFallbackRows];
}
