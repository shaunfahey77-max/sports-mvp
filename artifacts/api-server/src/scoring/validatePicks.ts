/**
 * Validation pipeline.
 * Scores outcomes and computes performance metrics for a set of scored picks.
 */

import { americanToDecimal, americanToImplied } from "./marketProb";

export interface PickForValidation {
  id: number;
  league: string;
  market: string;
  pick: string;
  publishOdds: number;
  closeOdds: number | null;
  closeLine: number | null;
  publishLine: number | null;
  modelProbCalibrated: number;
  result: "win" | "loss" | "push" | "pending";
}

export interface ValidationOutput {
  totalPicks: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number;
  roi: number;
  unitsWon: number;
  maxDrawdown: number;
  avgEv: number;
  avgEdge: number;
  clvHitRate: number;
  avgClv: number;
  brierScore: number;
  logLoss: number;
  passRate: number;
  picksPerDay: number;
  tierBreakdown: Record<string, number>;
  leagueBreakdown: Record<string, number>;
  marketBreakdown: Record<string, number>;
}

export interface PickWithFullData extends PickForValidation {
  ev: number;
  edge: number;
  clvImpliedDelta: number | null;
  tier: string;
}

export function computeOutcomeResult(params: {
  market: string;
  pick: string;
  homeScore: number;
  awayScore: number;
  spread?: number | null;
  total?: number | null;
}): "win" | "loss" | "push" {
  const { market, pick, homeScore, awayScore, spread, total } = params;

  if (market === "moneyline") {
    if (homeScore === awayScore) return "push";
    if (pick === "home") return homeScore > awayScore ? "win" : "loss";
    if (pick === "away") return awayScore > homeScore ? "win" : "loss";
  }

  if (market === "spread" && spread != null) {
    const margin = homeScore - awayScore;
    if (pick === "home") {
      const adjusted = margin + spread;
      if (adjusted === 0) return "push";
      return adjusted > 0 ? "win" : "loss";
    }
    if (pick === "away") {
      const adjusted = awayScore - homeScore + spread;
      if (adjusted === 0) return "push";
      return adjusted > 0 ? "win" : "loss";
    }
  }

  if (market === "total" && total != null) {
    const combined = homeScore + awayScore;
    if (combined === total) return "push";
    if (pick === "over") return combined > total ? "win" : "loss";
    if (pick === "under") return combined < total ? "win" : "loss";
  }

  return "push";
}

export function computeValidationMetrics(picks: PickWithFullData[], days: number): ValidationOutput {
  const resolved = picks.filter((p) => p.result !== "pending");
  const wins = resolved.filter((p) => p.result === "win").length;
  const losses = resolved.filter((p) => p.result === "loss").length;
  const pushes = resolved.filter((p) => p.result === "push").length;

  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;

  let totalUnits = 0;
  let runningUnits = 0;
  let peakUnits = 0;
  let maxDrawdown = 0;

  for (const pick of resolved) {
    if (pick.result === "win") {
      const decimal = americanToDecimal(pick.publishOdds);
      runningUnits += decimal - 1;
      totalUnits += decimal - 1;
    } else if (pick.result === "loss") {
      runningUnits -= 1;
      totalUnits -= 1;
    }
    peakUnits = Math.max(peakUnits, runningUnits);
    const drawdown = peakUnits - runningUnits;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  const roi = resolved.length > 0 ? totalUnits / resolved.length : 0;
  const unitsWon = totalUnits;

  const avgEv =
    picks.length > 0 ? picks.reduce((s, p) => s + p.ev, 0) / picks.length : 0;
  const avgEdge =
    picks.length > 0 ? picks.reduce((s, p) => s + p.edge, 0) / picks.length : 0;

  const picksWithClv = picks.filter((p) => p.clvImpliedDelta != null);
  const clvHitRate =
    picksWithClv.length > 0
      ? picksWithClv.filter((p) => (p.clvImpliedDelta ?? 0) > 0).length /
        picksWithClv.length
      : 0;
  const avgClv =
    picksWithClv.length > 0
      ? picksWithClv.reduce((s, p) => s + (p.clvImpliedDelta ?? 0), 0) /
        picksWithClv.length
      : 0;

  let brierSum = 0;
  let logLossSum = 0;
  for (const pick of resolved) {
    const outcome = pick.result === "win" ? 1 : 0;
    const p = Math.max(0.001, Math.min(0.999, pick.modelProbCalibrated));
    brierSum += Math.pow(p - outcome, 2);
    logLossSum += -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p));
  }
  const brierScore = resolved.length > 0 ? brierSum / resolved.length : 0;
  const logLoss = resolved.length > 0 ? logLossSum / resolved.length : 0;

  const tierBreakdown: Record<string, number> = {};
  const leagueBreakdown: Record<string, number> = {};
  const marketBreakdown: Record<string, number> = {};

  for (const pick of picks) {
    tierBreakdown[pick.tier] = (tierBreakdown[pick.tier] ?? 0) + 1;
    leagueBreakdown[pick.league] = (leagueBreakdown[pick.league] ?? 0) + 1;
    marketBreakdown[pick.market] = (marketBreakdown[pick.market] ?? 0) + 1;
  }

  const picksPerDay = days > 0 ? picks.length / days : 0;

  return {
    totalPicks: picks.length,
    wins,
    losses,
    pushes,
    pending: picks.filter((p) => p.result === "pending").length,
    winRate,
    roi,
    unitsWon,
    maxDrawdown,
    avgEv,
    avgEdge,
    clvHitRate,
    avgClv,
    brierScore,
    logLoss,
    passRate: 0,
    picksPerDay,
    tierBreakdown,
    leagueBreakdown,
    marketBreakdown,
  };
}
