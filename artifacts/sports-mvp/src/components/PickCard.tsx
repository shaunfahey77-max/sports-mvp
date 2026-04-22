import { useState } from "react";
import { ScoredPick } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { WhyThisPickPopover } from "@/components/WhyThisPickPopover";
import { formatOdds, formatPercentage, getLeagueColor, getMarketColorClass, getTierColorClass, getResultColorClass, cn } from "@/lib/utils";
import { parseGameMatchup, getLeagueLogoUrl } from "@/lib/teamLogos";

const SERIF = "'Playfair Display', serif";

function TeamLogo({ src, abbrev, size = 28 }: { src: string | null; abbrev: string; size?: number }) {
  const [imgError, setImgError] = useState(false);

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={abbrev}
        width={size}
        height={size}
        className="object-contain drop-shadow"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded text-[10px] font-black font-display text-[#FFC107] bg-[#1A3066] border border-[#FFC107]/20"
      style={{ width: size, height: size }}
    >
      {abbrev.slice(0, 3)}
    </div>
  );
}

export function PickCard({ pick, highlight = false, onLogPick }: { pick: ScoredPick; highlight?: boolean; onLogPick?: () => void }) {
  const matchup = parseGameMatchup(pick.gameKey, pick.league);
  const leagueLogo = getLeagueLogoUrl(pick.league);

  const pickIsHome = pick.pick === 'home';
  const pickIsAway = pick.pick === 'away';
  const pickIsOver = pick.pick === 'over';
  const pickIsUnder = pick.pick === 'under';
  const isSidesPick = pickIsHome || pickIsAway;

  return (
    <Card className={cn(
      "p-4 border flex flex-col gap-3 transition-colors",
      highlight
        ? "bg-[#0D1B3E] border-[#FFC107]/40 shadow-[0_0_20px_rgba(255,193,7,0.1)]"
        : "bg-card/80 border-border hover:bg-card"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" style={{ color: getLeagueColor(pick.league), borderColor: getLeagueColor(pick.league) }} className="bg-transparent uppercase text-[10px] px-1.5 py-0">
            {pick.league}
          </Badge>
          <Badge className={cn(getMarketColorClass(pick.market), "text-[10px] px-1.5 py-0")}>
            {pick.market.toUpperCase()}
          </Badge>
        </div>
        <Badge className={cn(getTierColorClass(pick.tier), "text-[10px] px-1.5 py-0")}>
          TIER {pick.tier}
          <InfoTooltip content={
            pick.tier === 'A' ? 'Tier A — Strongest edge. Model confidence is highest.' :
            pick.tier === 'B' ? 'Tier B — Solid play. Good edge with strong market quality.' :
            pick.tier === 'C' ? 'Tier C — Marginal edge. Bet smaller if at all.' :
            'PASS — No actionable edge found.'
          } />
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        {matchup ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className={cn("flex items-center gap-1 flex-1", isSidesPick && pickIsAway && "opacity-100", isSidesPick && pickIsHome && "opacity-40")}>
              <TeamLogo src={matchup.awayLogo} abbrev={matchup.awayAbbrev} size={26} />
              <span className={cn("text-[11px] font-bold font-display", isSidesPick && pickIsAway ? "text-foreground" : "text-muted-foreground")}>
                {matchup.awayAbbrev}
              </span>
            </div>
            <span className="text-muted-foreground text-[10px] font-medium px-0.5">@</span>
            <div className={cn("flex items-center gap-1 flex-1 justify-end", isSidesPick && pickIsHome && "opacity-100", isSidesPick && pickIsAway && "opacity-40")}>
              <span className={cn("text-[11px] font-bold font-display", isSidesPick && pickIsHome ? "text-foreground" : "text-muted-foreground")}>
                {matchup.homeAbbrev}
              </span>
              <TeamLogo src={matchup.homeLogo} abbrev={matchup.homeAbbrev} size={26} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {leagueLogo && <img src={leagueLogo} alt={pick.league} className="h-6 w-6 object-contain opacity-60" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
            <span className="text-xs text-muted-foreground truncate">{pick.gameKey}</span>
          </div>
        )}
      </div>

      <div>
        <div className="text-xl font-bold font-display tracking-tight flex items-baseline gap-2">
          <span className={cn(
            pickIsOver || pickIsUnder ? "text-[#7FD4C5]" : "text-white"
          )} style={{ fontFamily: SERIF }}>
            {pick.pick.toUpperCase()}
          </span>
          {pick.publishLine !== undefined && pick.publishLine !== null && (
            <span className="text-white/50">{Number(pick.publishLine) > 0 ? `+${pick.publishLine}` : pick.publishLine}</span>
          )}
          <span className="text-[#FFC107]">{formatOdds(Number(pick.publishOdds))}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center">
            Edge
            <InfoTooltip content="How much our probability exceeds the true market probability after removing the book's margin. Higher edge = more value." />
          </div>
          <div className={cn("font-bold text-sm", Number(pick.edge) > 0 ? "text-[#4ADE80]" : "text-white/70")}>
            {formatPercentage(Number(pick.edge))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center">
            EV
            <InfoTooltip content="Expected Value — estimated profit per $100 wagered based on our calibrated win probability vs. the offered odds." />
          </div>
          <div className={cn("font-bold text-sm", Number(pick.ev) > 0 ? "text-[#4ADE80]" : "text-white/70")}>
            {formatPercentage(Number(pick.ev))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Result</div>
          <div className={cn("font-bold uppercase text-sm", getResultColorClass(pick.result))}>
            {pick.result}
          </div>
        </div>
      </div>

      {(pick.clvImpliedDelta !== null && pick.clvImpliedDelta !== undefined && Number(pick.clvImpliedDelta) !== 0) && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <span>CLV:</span>
          <span className={Number(pick.clvImpliedDelta) > 0 ? "text-[#4ADE80]" : "text-[#F87171]"}>
            {Number(pick.clvImpliedDelta) > 0 ? '+' : ''}{(Number(pick.clvImpliedDelta) * 100).toFixed(1)}%
          </span>
          <InfoTooltip content="Closing Line Value — how much the market moved in our favor after we published the pick. Positive CLV = we beat the closing line." />
        </div>
      )}

      {pick.result === 'pending' && Number(pick.edge) > 0 && (
        <div className="pt-1">
          <WhyThisPickPopover input={{
            modelProb: Number(pick.modelProbCalibrated),
            marketProb: Number(pick.marketProbFair),
            edge: Number(pick.edge),
            ev: Number(pick.ev),
            tier: pick.tier,
            rankScore: Number(pick.rankScore),
            market: pick.market,
            league: pick.league,
            pick: pick.pick,
            publishOdds: Number(pick.publishOdds),
            publishLine: pick.publishLine !== null && pick.publishLine !== undefined ? Number(pick.publishLine) : null,
          }} />
        </div>
      )}

      {onLogPick && (
        <button
          onClick={onLogPick}
          className="w-full text-[10px] font-bold uppercase tracking-[0.2em] text-[#FFC107]/70 hover:text-[#FFC107] border-t border-[#1A3066] pt-2.5 transition-colors text-center"
        >
          + Log This Pick
        </button>
      )}
    </Card>
  );
}
