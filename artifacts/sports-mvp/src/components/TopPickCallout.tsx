import { ScoredPick, CandidateBet } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatOdds, formatPercentage, getLeagueColor, getMarketColorClass, cn } from "@/lib/utils";
import { parseGameMatchup, getTeamLogoUrl } from "@/lib/teamLogos";
import { Star } from "lucide-react";

const SERIF = "'Playfair Display', serif";

function findTopCandidate(candidates: CandidateBet[]): CandidateBet | null {
  const eligible = candidates.filter(c => c.tier === 'A' || c.tier === 'B');
  if (!eligible.length) return candidates[0] ?? null;
  return eligible.reduce((best, c) => Number(c.rankScore) > Number(best.rankScore) ? c : best);
}

function findTopPick(picks: ScoredPick[]): ScoredPick | null {
  const eligible = picks.filter(p => p.tier === 'A' || p.tier === 'B');
  if (!eligible.length) return picks[0] ?? null;
  return eligible.reduce((best, p) => Number(p.rankScore) > Number(best.rankScore) ? p : best);
}

interface TopPickCalloutProps {
  picks?: ScoredPick[];
  candidates?: CandidateBet[];
}

export function TopPickCallout({ picks = [], candidates = [] }: TopPickCalloutProps) {
  const topPick = picks.length > 0 ? findTopPick(picks) : null;
  const topCandidate = !topPick && candidates.length > 0 ? findTopCandidate(candidates) : null;
  const item = topPick || topCandidate;

  if (!item) return null;

  const isCandidate = !topPick;
  const league = item.league;
  const gameKey = item.gameKey;
  const publishOdds = Number(item.publishOdds);
  const rankScore = Number(item.rankScore);
  const edge = Number(item.edge);
  const ev = Number(item.ev);
  const tier = item.tier;

  let side: string, publishLine: number | null | undefined, market: string;
  if (isCandidate) {
    const c = item as CandidateBet;
    side = c.side;
    publishLine = c.publishLine ? Number(c.publishLine) : null;
    market = c.marketType;
  } else {
    const p = item as ScoredPick;
    side = p.pick;
    publishLine = p.publishLine ? Number(p.publishLine) : null;
    market = p.market;
  }

  const matchup = parseGameMatchup(gameKey, league);

  return (
    <div className="relative rounded-xl border border-[#FFC107]/30 bg-gradient-to-br from-[#0D1B3E] via-[#112454] to-[#0D1B3E] p-5 shadow-[0_0_40px_rgba(255,193,7,0.08)] overflow-hidden mb-8">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, #FFC107 0, #FFC107 1px, transparent 0, transparent 50%)', backgroundSize: '12px 12px' }}
      />

      <div className="relative flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <Star size={14} className="text-[#FFC107] fill-[#FFC107]" />
            <span className="text-[#FFC107] text-[11px] font-bold tracking-[0.25em] uppercase">Top Pick of the Day</span>
            <Badge className="bg-[#FFC107] text-[#060D1F] text-[10px] font-bold border-transparent px-1.5 py-0">
              TIER {tier}
            </Badge>
          </div>

          {matchup ? (
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-1.5">
                {matchup.awayLogo && (
                  <img src={matchup.awayLogo} alt={matchup.awayAbbrev} className="h-8 w-8 object-contain drop-shadow" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className={cn("text-base font-bold font-display", side === 'away' ? "text-white" : "text-muted-foreground")}>{matchup.awayAbbrev}</span>
              </div>
              <span className="text-muted-foreground text-sm">@</span>
              <div className="flex items-center gap-1.5">
                {matchup.homeLogo && (
                  <img src={matchup.homeLogo} alt={matchup.homeAbbrev} className="h-8 w-8 object-contain drop-shadow" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className={cn("text-base font-bold font-display", side === 'home' ? "text-white" : "text-muted-foreground")}>{matchup.homeAbbrev}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" style={{ color: getLeagueColor(league), borderColor: getLeagueColor(league) }} className="bg-transparent uppercase text-[10px] px-1.5 py-0">
              {league}
            </Badge>
            <Badge className={cn(getMarketColorClass(market), "text-[10px] px-1.5 py-0")}>
              {market.toUpperCase()}
            </Badge>
            <div className="text-2xl font-black tracking-tight flex items-baseline gap-2" style={{ fontFamily: SERIF }}>
              <span className="text-white">{side.toUpperCase()}</span>
              {publishLine !== null && publishLine !== undefined && (
                <span className="text-white/50 text-xl">{publishLine > 0 ? `+${publishLine}` : publishLine}</span>
              )}
              <span className="text-[#FFC107] text-xl">{formatOdds(publishOdds)}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-4 md:gap-6 shrink-0">
          <div className="text-center">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
              Edge <InfoTooltip content="Our probability minus the market's fair probability, after vig removal." />
            </div>
            <div className="text-2xl font-black text-[#4ADE80]" style={{ fontFamily: SERIF }}>{formatPercentage(edge)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center justify-center gap-0.5">
              EV <InfoTooltip content="Expected profit per $100 wagered at this pick's calibrated probability." />
            </div>
            <div className="text-2xl font-black text-[#4ADE80]" style={{ fontFamily: SERIF }}>{formatPercentage(ev)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Rank</div>
            <div className="text-2xl font-black text-white" style={{ fontFamily: SERIF }}>{rankScore.toFixed(2)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
