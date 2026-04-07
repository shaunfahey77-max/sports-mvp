import { americanToDecimalBet } from './betTracker';

export function kellyFraction(odds: number, modelProb: number): number {
  const b = americanToDecimalBet(odds) - 1;
  const p = Math.min(Math.max(modelProb, 0), 1);
  const q = 1 - p;
  if (b <= 0) return 0;
  return Math.max(0, (b * p - q) / b);
}

export function halfKellyStake(odds: number, modelProb: number, bankroll: number): number {
  const full = kellyFraction(odds, modelProb);
  return Math.round(bankroll * full * 0.5 * 100) / 100;
}
