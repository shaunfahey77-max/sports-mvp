import { CandidateBet } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { formatOdds, formatPercentage, getLeagueColor, getMarketColorClass, getTierColorClass, cn } from "@/lib/utils";
import { parseGameMatchup, getLeagueLogoUrl } from "@/lib/teamLogos";

function TeamLogo({ src, abbrev, size = 28 }: { src: string | null; abbrev: string; size?: number }) {
  if (src) {
    return (
      <img
        src={src}
        alt={abbrev}
        width={size}
        height={size}
        className="object-contain drop-shadow"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded text-[10px] font-bold font-display text-muted-foreground bg-[#112454]"
      style={{ width: size, height: size }}
    >
      {abbrev.slice(0, 3)}
    </div>
  );
}

export function CandidateCard({ bet, highlight = false }: { bet: CandidateBet; highlight?: boolean }) {
  const matchup = parseGameMatchup(bet.gameKey, bet.league);
  const leagueLogo = getLeagueLogoUrl(bet.league);

  const sideIsHome = bet.side === 'home';
  const sideIsAway = bet.side === 'away';
  const sideIsOver = bet.side === 'over';
  const sideIsUnder = bet.side === 'under';
  const isSidesPick = sideIsHome || sideIsAway;

  return (
    <Card className={cn(
      "p-4 border flex flex-col gap-3 transition-colors",
      highlight
        ? "bg-[#0D1B3E] border-[#FFC107]/40 shadow-[0_0_20px_rgba(255,193,7,0.1)]"
        : "bg-card/80 border-border hover:bg-card"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" style={{ color: getLeagueColor(bet.league), borderColor: getLeagueColor(bet.league) }} className="bg-transparent uppercase text-[10px] px-1.5 py-0">
            {bet.league}
          </Badge>
          <Badge className={cn(getMarketColorClass(bet.marketType), "text-[10px] px-1.5 py-0")}>
            {bet.marketType.toUpperCase()}
          </Badge>
        </div>
        <Badge className={cn(getTierColorClass(bet.tier), "text-[10px] px-1.5 py-0")}>
          TIER {bet.tier}
          <InfoTooltip content={
            bet.tier === 'A' ? 'Tier A — Strongest edge. Highest priority bet.' :
            bet.tier === 'B' ? 'Tier B — Solid play. Good risk/reward.' :
            bet.tier === 'C' ? 'Tier C — Marginal edge. Use reduced sizing.' :
            'PASS — No actionable edge.'
          } />
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        {matchup ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className={cn("flex items-center gap-1 flex-1", isSidesPick && sideIsAway ? "opacity-100" : isSidesPick ? "opacity-40" : "opacity-80")}>
              <TeamLogo src={matchup.awayLogo} abbrev={matchup.awayAbbrev} size={26} />
              <span className={cn("text-[11px] font-bold font-display", isSidesPick && sideIsAway ? "text-foreground" : "text-muted-foreground")}>
                {matchup.awayAbbrev}
              </span>
            </div>
            <span className="text-muted-foreground text-[10px] font-medium px-0.5">@</span>
            <div className={cn("flex items-center gap-1 flex-1 justify-end", isSidesPick && sideIsHome ? "opacity-100" : isSidesPick ? "opacity-40" : "opacity-80")}>
              <span className={cn("text-[11px] font-bold font-display", isSidesPick && sideIsHome ? "text-foreground" : "text-muted-foreground")}>
                {matchup.homeAbbrev}
              </span>
              <TeamLogo src={matchup.homeLogo} abbrev={matchup.homeAbbrev} size={26} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {leagueLogo && <img src={leagueLogo} alt={bet.league} className="h-6 w-6 object-contain opacity-60" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
            <span className="text-xs text-muted-foreground truncate">{bet.gameKey}</span>
          </div>
        )}
      </div>

      <div>
        <div className="text-xl font-bold font-display tracking-tight flex items-baseline gap-2">
          <span className={cn(sideIsOver || sideIsUnder ? "text-[#00897B]" : "text-foreground")}>
            {bet.side.toUpperCase()}
          </span>
          {bet.publishLine !== undefined && bet.publishLine !== null && (
            <span className="text-muted-foreground">{Number(bet.publishLine) > 0 ? `+${bet.publishLine}` : bet.publishLine}</span>
          )}
          <span className="text-primary">{formatOdds(Number(bet.publishOdds))}</span>
        </div>
        {bet.selectionReason && (
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{bet.selectionReason}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center">
            Edge
            <InfoTooltip content="Our probability minus the market's fair probability. Represents the true value we see vs. what the book implies." />
          </div>
          <div className={cn("font-bold text-sm", Number(bet.edge) > 0 ? "text-[#388E3C]" : "text-foreground")}>
            {formatPercentage(Number(bet.edge))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center">
            EV
            <InfoTooltip content="Expected Value — projected profit per $100 wagered if this bet were placed repeatedly at these odds." />
          </div>
          <div className={cn("font-bold text-sm", Number(bet.ev) > 0 ? "text-[#388E3C]" : "text-foreground")}>
            {formatPercentage(Number(bet.ev))}
          </div>
        </div>
      </div>
    </Card>
  );
}
