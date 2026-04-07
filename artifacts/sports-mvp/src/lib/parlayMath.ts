import type { ScoredPick } from "@workspace/api-client-react";

export function americanToDecimal(odds: number): number {
  if (odds >= 100) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export interface ParlayResult {
  probability: number;
  decimalOdds: number;
  americanOdds: number;
  ev: number;
  payout: number;
  hasCorrelation: boolean;
}

export function calcParlay(legs: ScoredPick[]): ParlayResult {
  if (legs.length === 0) {
    return { probability: 0, decimalOdds: 1, americanOdds: 0, ev: 0, payout: 100, hasCorrelation: false };
  }

  const decimalOdds = legs.reduce(
    (acc, leg) => acc * americanToDecimal(Number(leg.publishOdds)),
    1
  );
  const probability = legs.reduce(
    (acc, leg) => acc * Number(leg.modelProbCalibrated),
    1
  );
  const americanOdds = decimalToAmerican(decimalOdds);
  const payout = decimalOdds * 100;
  const ev = probability * payout - 100;

  const gameKeys = legs.map((l) => l.gameKey);
  const hasCorrelation = new Set(gameKeys).size < gameKeys.length;

  return { probability, decimalOdds, americanOdds, ev, payout, hasCorrelation };
}

export function autoBuildParlay(picks: ScoredPick[], legCount: number): ScoredPick[] {
  const sorted = [...picks].sort((a, b) => Number(b.ev) - Number(a.ev));
  const selected: ScoredPick[] = [];
  const usedGames = new Set<string>();

  for (const pick of sorted) {
    if (selected.length >= legCount) break;
    if (!usedGames.has(pick.gameKey)) {
      selected.push(pick);
      usedGames.add(pick.gameKey);
    }
  }

  return selected;
}
