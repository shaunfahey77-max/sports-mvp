import { useState } from "react";
import { Eye, AlertTriangle } from "lucide-react";
import { CandidateBet } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { WhyThisPickPopover } from "@/components/WhyThisPickPopover";
import { formatOdds, formatPercentage, getLeagueColor, getMarketColorClass, cn } from "@/lib/utils";
import { parseGameMatchup, getLeagueLogoUrl } from "@/lib/teamLogos";

const SERIF = "'Playfair Display', serif";

const REASON_COPY: Record<string, string> = {
  insufficient_edge: "Edge below our minimum threshold to publish.",
  negative_ev: "Expected value is negative at current odds.",
  market_disabled: "Market disabled in current model config.",
  market_quality_too_low: "Market liquidity or data quality too low to trust.",
  odds_out_of_range: "Odds fall outside the acceptable range for this league.",
  rank_score_below_threshold: "Composite rank score below the qualifying threshold.",
  model_watch_only: "Shown for transparency only — this market is not yet promoted to an Official pick while we collect more settled-result evidence.",
};

function friendlyReason(reason: string | null | undefined): string {
  if (!reason) return "Did not clear the model's scoring gates.";
  return REASON_COPY[reason] ?? reason.replace(/_/g, " ");
}

function TeamLogo({ src, abbrev, size = 28 }: { src: string | null; abbrev: string; size?: number }) {
  const [imgError, setImgError] = useState(false);
  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={abbrev}
        width={size}
        height={size}
        className="object-contain drop-shadow opacity-80"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded text-[10px] font-black font-display text-white/60 bg-[#1A3066]/60 border border-white/10"
      style={{ width: size, height: size }}
    >
      {abbrev.slice(0, 3)}
    </div>
  );
}

interface FallbackCandidateCardProps {
  bet: CandidateBet;
  onLogPick?: () => void;
}

export function FallbackCandidateCard({ bet, onLogPick }: FallbackCandidateCardProps) {
  const matchup = parseGameMatchup(bet.gameKey, bet.league);
  const leagueLogo = getLeagueLogoUrl(bet.league);

  const sideIsHome = bet.side === 'home';
  const sideIsAway = bet.side === 'away';
  const sideIsOver = bet.side === 'over';
  const sideIsUnder = bet.side === 'under';
  const isSidesPick = sideIsHome || sideIsAway;

  const reason = friendlyReason(bet.selectionReason);

  return (
    <Card
      data-testid="fallback-candidate-card"
      className="p-4 border border-dashed border-white/15 bg-[#0B142E]/70 flex flex-col gap-3 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" style={{ color: getLeagueColor(bet.league), borderColor: getLeagueColor(bet.league) }} className="bg-transparent uppercase text-[10px] px-1.5 py-0 opacity-80">
            {bet.league}
          </Badge>
          <Badge className={cn(getMarketColorClass(bet.marketType), "text-[10px] px-1.5 py-0 opacity-80")}>
            {bet.marketType.toUpperCase()}
          </Badge>
        </div>
        <Badge
          variant="outline"
          className="border-white/25 text-white/70 bg-white/5 text-[10px] px-1.5 py-0 inline-flex items-center gap-1"
        >
          <Eye size={10} className="opacity-80" />
          MODEL WATCH
          <InfoTooltip content="A 'Model Watch' candidate did not clear the model's scoring gates. It is shown as a transparency lean only — not an official pick, not counted in performance." />
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        {matchup ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className={cn("flex items-center gap-1 flex-1", isSidesPick && sideIsAway ? "opacity-90" : isSidesPick ? "opacity-40" : "opacity-70")}>
              <TeamLogo src={matchup.awayLogo} abbrev={matchup.awayAbbrev} size={26} />
              <span className={cn("text-[11px] font-bold font-display", isSidesPick && sideIsAway ? "text-white/90" : "text-muted-foreground")}>
                {matchup.awayAbbrev}
              </span>
            </div>
            <span className="text-muted-foreground text-[10px] font-medium px-0.5">@</span>
            <div className={cn("flex items-center gap-1 flex-1 justify-end", isSidesPick && sideIsHome ? "opacity-90" : isSidesPick ? "opacity-40" : "opacity-70")}>
              <span className={cn("text-[11px] font-bold font-display", isSidesPick && sideIsHome ? "text-white/90" : "text-muted-foreground")}>
                {matchup.homeAbbrev}
              </span>
              <TeamLogo src={matchup.homeLogo} abbrev={matchup.homeAbbrev} size={26} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {leagueLogo && <img src={leagueLogo} alt={bet.league} className="h-6 w-6 object-contain opacity-50" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
            <span className="text-xs text-muted-foreground truncate">{bet.gameKey}</span>
          </div>
        )}
      </div>

      <div>
        <div className="text-xl font-bold font-display tracking-tight flex items-baseline gap-2 opacity-90">
          <span className={cn(sideIsOver || sideIsUnder ? "text-[#7FD4C5]/80" : "text-white/85")} style={{ fontFamily: SERIF }}>
            {bet.side.toUpperCase()}
          </span>
          {bet.publishLine !== undefined && bet.publishLine !== null && (
            <span className="text-white/40">{Number(bet.publishLine) > 0 ? `+${bet.publishLine}` : bet.publishLine}</span>
          )}
          <span className="text-[#FFC107]/80">{formatOdds(Number(bet.publishOdds))}</span>
        </div>
        <div className="mt-2 flex items-start gap-1.5 rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
          <AlertTriangle size={11} className="text-[#FFC107]/70 mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="text-white/70 font-semibold">Lean only.</span> {reason}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/10">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center">
            Edge
            <InfoTooltip content="Our probability minus the market's fair probability. Shown for transparency only on watch candidates." />
          </div>
          <div className={cn("font-bold text-sm", Number(bet.edge) > 0 ? "text-[#4ADE80]/80" : "text-white/60")}>
            {formatPercentage(Number(bet.edge))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider flex items-center">
            EV
            <InfoTooltip content="Expected value per $100. Shown for transparency only on watch candidates." />
          </div>
          <div className={cn("font-bold text-sm", Number(bet.ev) > 0 ? "text-[#4ADE80]/80" : "text-white/60")}>
            {formatPercentage(Number(bet.ev))}
          </div>
        </div>
      </div>

      <div className="pt-1">
        <WhyThisPickPopover input={{
          modelProb: Number(bet.modelProbCalibrated),
          marketProb: Number(bet.marketProbFair),
          edge: Number(bet.edge),
          ev: Number(bet.ev),
          tier: bet.tier,
          rankScore: Number(bet.rankScore),
          market: bet.marketType,
          league: bet.league,
          pick: bet.side,
          publishOdds: Number(bet.publishOdds),
          publishLine: bet.publishLine !== null && bet.publishLine !== undefined ? Number(bet.publishLine) : null,
        }} />
      </div>

      {onLogPick && (
        <button
          onClick={onLogPick}
          className="mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded border border-white/20 bg-white/5 text-white/70 text-xs font-bold font-display uppercase tracking-[0.18em] hover:bg-white/10 hover:border-white/40 transition-colors"
          aria-label="Track this watch candidate (not an official pick)"
        >
          Track Anyway
        </button>
      )}
    </Card>
  );
}
