import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatOdds(odds?: number | null): string {
  if (odds === undefined || odds === null) return "";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function formatPercentage(val?: number | null): string {
  if (val === undefined || val === null) return "0.0%";
  return `${(val * 100).toFixed(1)}%`;
}

export function formatDecimal(val?: number | null, decimals = 2): string {
  if (val === undefined || val === null) return "0";
  return val.toFixed(decimals);
}

export function getLeagueColor(league: string): string {
  switch (league.toLowerCase()) {
    case 'nba': return '#E0526A';
    case 'nhl': return '#7FB7E0';
    case 'ncaam': return '#FFC107';
    case 'ncaaf': return '#FFC107';
    case 'nfl': return '#E0526A';
    case 'mlb': return '#7FB7E0';
    default: return '#FFC107';
  }
}

export function getMarketColorClass(market: string): string {
  switch (market.toLowerCase()) {
    case 'moneyline': return 'bg-[#1A3066] text-[#FFD54F] border-transparent';
    case 'spread': return 'bg-[#2A1F4A] text-[#C4B5E8] border-transparent';
    case 'total': return 'bg-[#1A3D38] text-[#7FD4C5] border-transparent';
    default: return 'bg-[#1A3066] text-white/70 border-transparent';
  }
}

export function getTierColorClass(tier: string): string {
  switch (tier.toUpperCase()) {
    case 'A': return 'bg-[#FFC107] text-[#060D1F] border-transparent font-bold';
    case 'B': return 'bg-[#3D4A6B] text-white border-transparent font-bold';
    case 'C': return 'bg-[#1A3066] text-white/80 border-transparent font-bold';
    case 'PASS': return 'bg-[#0D1B3E] text-[#8899CC] border-[#1A3066] font-medium';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function getResultColorClass(result?: string | null): string {
  if (!result) return 'text-white/40';
  switch (result.toLowerCase()) {
    case 'win': return 'text-[#4ADE80]';
    case 'loss': return 'text-[#F87171]';
    case 'push': return 'text-[#FFC107]';
    case 'pending': return 'text-white/40';
    default: return 'text-muted-foreground';
  }
}
