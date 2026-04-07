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
    case 'nba': return '#C9082A';
    case 'nhl': return '#006BB6';
    case 'ncaam': return '#CC8800';
    default: return '#0033A0';
  }
}

export function getMarketColorClass(market: string): string {
  switch (market.toLowerCase()) {
    case 'moneyline': return 'bg-[#0033A0] text-white border-transparent';
    case 'spread': return 'bg-[#5C35CC] text-white border-transparent';
    case 'total': return 'bg-[#00897B] text-white border-transparent';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function getTierColorClass(tier: string): string {
  switch (tier.toUpperCase()) {
    case 'A': return 'bg-[#FFC107] text-[#060D1F] border-transparent font-bold';
    case 'B': return 'bg-[#0033A0] text-white border-transparent font-bold';
    case 'C': return 'bg-[#424242] text-white border-transparent font-bold';
    case 'PASS': return 'bg-[#1A3066] text-[#8899CC] border-[#1A3066] font-medium';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function getResultColorClass(result?: string | null): string {
  if (!result) return 'text-[#424242]';
  switch (result.toLowerCase()) {
    case 'win': return 'text-[#388E3C]';
    case 'loss': return 'text-[#D32F2F]';
    case 'push': return 'text-[#FFC107]';
    case 'pending': return 'text-[#424242]';
    default: return 'text-muted-foreground';
  }
}
