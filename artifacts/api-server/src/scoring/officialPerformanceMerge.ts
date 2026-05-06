import type { PickWithFullData } from "./validatePicks";

export type OfficialPerformanceRow = {
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

export function mergeOfficialPerformanceRows(args: {
  evaluationRows: readonly OfficialPerformanceRow[];
  scoredPickRows: readonly (OfficialPerformanceRow & { id: number })[];
}): PickWithFullData[] {
  const { evaluationRows, scoredPickRows } = args;
  const evaluationKeys = new Set(
    evaluationRows.map((row) => `${row.date}|${row.gameKey}|${row.market}|${row.pick}`),
  );
  const historicalFallbackRows = scoredPickRows.filter((row) => {
    const key = `${row.date}|${row.gameKey}|${row.market}|${row.pick}`;
    return !evaluationKeys.has(key);
  });

  return [
    ...evaluationRows.map((p, index) => ({
      id: -1 - index,
      league: p.league,
      market: p.market,
      pick: p.pick,
      publishOdds: parseFloat(p.publishOdds),
      closeOdds: p.closeOdds ? parseFloat(p.closeOdds) : null,
      closeLine: p.closeLine ? parseFloat(p.closeLine) : null,
      publishLine: p.publishLine ? parseFloat(p.publishLine) : null,
      modelProbCalibrated: parseFloat(p.modelProbCalibrated),
      result: p.result as "win" | "loss" | "push" | "pending",
      ev: parseFloat(p.ev),
      edge: parseFloat(p.edge),
      clvImpliedDelta: p.clvImpliedDelta ? parseFloat(p.clvImpliedDelta) : null,
      tier: p.tier,
    })),
    ...historicalFallbackRows.map((p) => ({
      id: p.id,
      league: p.league,
      market: p.market,
      pick: p.pick,
      publishOdds: parseFloat(p.publishOdds),
      closeOdds: p.closeOdds ? parseFloat(p.closeOdds) : null,
      closeLine: p.closeLine ? parseFloat(p.closeLine) : null,
      publishLine: p.publishLine ? parseFloat(p.publishLine) : null,
      modelProbCalibrated: parseFloat(p.modelProbCalibrated),
      result: p.result as "win" | "loss" | "push" | "pending",
      ev: parseFloat(p.ev),
      edge: parseFloat(p.edge),
      clvImpliedDelta: p.clvImpliedDelta ? parseFloat(p.clvImpliedDelta) : null,
      tier: p.tier,
    })),
  ];
}
