export type BetResult = 'pending' | 'win' | 'loss' | 'push';

export interface UserBet {
  id: string;
  date: string;
  league: string;
  matchup: string;
  gameKey?: string;
  market: string;
  pick: string;
  odds: number;
  stake: number;
  sportsbook: string;
  result: BetResult;
  profit: number | null;
  notes?: string;
  sourcePickId?: number;
  tier?: string;
  edge?: number;
  ev?: number;
  createdAt: string;
}

export interface LogPickData {
  league?: string;
  matchup?: string;
  gameKey?: string;
  market?: string;
  pick?: string;
  odds?: number;
  tier?: string;
  edge?: number;
  ev?: number;
  sourcePickId?: number;
}

const STORAGE_KEY = 'sportsmvp_bets';
export const BANKROLL_KEY = 'sportsmvp_bankroll';

export const SPORTSBOOKS = [
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN Bet', 'PointsBet', 'Other',
];

export function americanToDecimalBet(odds: number): number {
  if (odds >= 100) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

export function calcProfit(stake: number, odds: number, result: BetResult): number | null {
  if (result === 'pending') return null;
  if (result === 'win') return Math.round(stake * (americanToDecimalBet(odds) - 1) * 100) / 100;
  if (result === 'loss') return -stake;
  if (result === 'push') return 0;
  return null;
}

export function loadBets(): UserBet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserBet[]) : [];
  } catch {
    return [];
  }
}

export function saveBets(bets: UserBet[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
}

export function addBet(bet: Omit<UserBet, 'id' | 'createdAt'>): UserBet {
  const newBet: UserBet = {
    ...bet,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const bets = loadBets();
  saveBets([newBet, ...bets]);
  return newBet;
}

export function updateBetResult(id: string, result: BetResult): UserBet[] {
  const bets = loadBets().map((b) => {
    if (b.id !== id) return b;
    return { ...b, result, profit: calcProfit(b.stake, b.odds, result) };
  });
  saveBets(bets);
  return bets;
}

export function deleteBet(id: string): UserBet[] {
  const bets = loadBets().filter((b) => b.id !== id);
  saveBets(bets);
  return bets;
}

export function loadBankroll(): number {
  try {
    return parseFloat(localStorage.getItem(BANKROLL_KEY) ?? '1000') || 1000;
  } catch {
    return 1000;
  }
}

export function saveBankroll(amount: number): void {
  localStorage.setItem(BANKROLL_KEY, String(amount));
}

export interface BetSummary {
  totalBets: number;
  settledBets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  totalStaked: number;
  totalProfit: number;
  winRate: number;
  roi: number;
  streak: { type: 'win' | 'loss' | null; count: number };
}

export function calcSummary(bets: UserBet[]): BetSummary {
  const settled = bets.filter((b) => b.result !== 'pending');
  const wins = settled.filter((b) => b.result === 'win').length;
  const losses = settled.filter((b) => b.result === 'loss').length;
  const pushes = settled.filter((b) => b.result === 'push').length;
  const pending = bets.filter((b) => b.result === 'pending').length;
  const totalStaked = bets.reduce((s, b) => s + b.stake, 0);
  const totalProfit = bets.reduce((s, b) => s + (b.profit ?? 0), 0);
  const winRate = wins + losses > 0 ? wins / (wins + losses) : 0;
  const roi = totalStaked > 0 ? totalProfit / totalStaked : 0;

  let streakCount = 0;
  let streakType: 'win' | 'loss' | null = null;
  const sorted = [...settled].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  for (const bet of sorted) {
    if (bet.result === 'push') continue;
    if (!streakType) { streakType = bet.result as 'win' | 'loss'; streakCount = 1; }
    else if (bet.result === streakType) streakCount++;
    else break;
  }

  return { totalBets: bets.length, settledBets: settled.length, wins, losses, pushes, pending, totalStaked, totalProfit, winRate, roi, streak: { type: streakType, count: streakCount } };
}

export interface PnLPoint {
  index: number;
  cumPnL: number;
  matchup: string;
  date: string;
}

export function calcPnLCurve(bets: UserBet[]): PnLPoint[] {
  const settled = bets
    .filter((b) => b.result !== 'pending' && b.profit !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let cum = 0;
  const points: PnLPoint[] = [{ index: 0, cumPnL: 0, matchup: 'Start', date: '' }];
  settled.forEach((b, i) => {
    cum += b.profit ?? 0;
    points.push({ index: i + 1, cumPnL: Math.round(cum * 100) / 100, matchup: b.matchup, date: b.date });
  });
  return points;
}
