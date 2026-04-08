import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles } from "lucide-react";

export interface WhyPickInput {
  modelProb: number;
  marketProb: number;
  edge: number;
  ev: number;
  tier: string;
  rankScore: number;
  market: string;
  league: string;
  pick: string;
  publishOdds: number;
  publishLine: number | null;
}

const MARKET_NOTES: Record<string, string> = {
  nba_spread: "NBA spreads are high-liquidity markets — model calibration is strongest here.",
  nba_total: "NBA totals show recurring EV gaps when pace and rest factors diverge from public consensus.",
  nba_moneyline: "NBA moneyline models have deep historical data and strong predictive accuracy.",
  nhl_spread: "NHL puck lines (±1.5) are lower-liquidity — only published when edge clears a strict 8% minimum.",
  nhl_total: "NHL totals are reliable in low-scoring pace matchups; model accounts for goaltender data.",
  nhl_moneyline: "NHL moneylines have strong model calibration driven by historical goaltender and shot-quality metrics.",
};

const TIER_CONTEXT: Record<string, string> = {
  A: "Rank score ≥ 0.65 — top percentile across all markets scored today.",
  B: "Rank score ≥ 0.50 — solid play with above-threshold edge and EV.",
  C: "Rank score ≥ 0.35 — marginal edge; consider half-size bet.",
};

export function buildWhyPoints(p: WhyPickInput): string[] {
  const bullets: string[] = [];

  const modelPct = Math.round(p.modelProb * 100);
  const marketPct = Math.round(p.marketProb * 100);
  bullets.push(`Model probability: ${modelPct}% vs. market's fair ${marketPct}%`);

  const edgePct = (p.edge * 100).toFixed(1);
  bullets.push(`+${edgePct}% edge over the true market price (after removing the book's vig)`);

  const evPct = (p.ev * 100).toFixed(1);
  const oddsStr = p.publishOdds > 0 ? `+${p.publishOdds}` : `${p.publishOdds}`;
  bullets.push(`At ${oddsStr} odds → +${evPct}% expected return per unit wagered`);

  const tierNote = TIER_CONTEXT[p.tier];
  if (tierNote) bullets.push(tierNote);

  const marketNote = MARKET_NOTES[`${p.league}_${p.market}`];
  if (marketNote) bullets.push(marketNote);

  return bullets;
}

export function WhyThisPickPopover({ input }: { input: WhyPickInput }) {
  const points = buildWhyPoints(input);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#4488FF] hover:text-[#FFC107] transition-colors border border-[#1A3066] hover:border-[#FFC107]/40 rounded px-2 py-1 bg-[#0D1B3E] hover:bg-[#112454]"
          onClick={(e) => e.stopPropagation()}
        >
          <Sparkles size={10} />
          Why this pick?
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 bg-[#0D1B3E] border border-[#1A3066] p-0 shadow-[0_0_30px_rgba(0,51,160,0.3)]"
        align="start"
        side="top"
      >
        <div className="px-4 py-3 border-b border-[#1A3066] flex items-center gap-2">
          <Sparkles size={13} className="text-[#FFC107]" />
          <span className="text-white text-xs font-black uppercase tracking-widest">Why this is a premium pick</span>
        </div>
        <ul className="px-4 py-3 flex flex-col gap-2.5">
          {points.map((point, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#FFC107] font-bold text-[11px] mt-0.5 shrink-0">•</span>
              <span className="text-[#E8EDF5] text-[12px] leading-snug">{point}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
