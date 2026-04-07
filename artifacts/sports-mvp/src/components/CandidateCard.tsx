import { CandidateBet } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatOdds, formatPercentage, getLeagueColor, getMarketColorClass, getTierColorClass, cn } from "@/lib/utils";

export function CandidateCard({ bet }: { bet: CandidateBet }) {
  return (
    <Card className="p-4 border-border bg-card/80 hover:bg-card transition-colors flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" style={{ color: getLeagueColor(bet.league), borderColor: getLeagueColor(bet.league) }} className="bg-transparent uppercase">
            {bet.league}
          </Badge>
          <Badge className={getMarketColorClass(bet.marketType)}>
            {bet.marketType.toUpperCase()}
          </Badge>
        </div>
        <Badge className={getTierColorClass(bet.tier)}>
          TIER {bet.tier}
        </Badge>
      </div>

      <div className="mt-2">
        <div className="text-sm text-muted-foreground mb-1">{bet.gameKey}</div>
        <div className="text-xl font-bold font-display tracking-tight flex items-baseline gap-2">
          <span>{bet.side.toUpperCase()}</span>
          {bet.publishLine !== undefined && bet.publishLine !== null && (
            <span className="text-muted-foreground">{bet.publishLine > 0 ? `+${bet.publishLine}` : bet.publishLine}</span>
          )}
          <span className="text-primary">{formatOdds(bet.publishOdds)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2 pt-3 border-t border-border">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Edge</div>
          <div className={cn("font-bold text-sm", bet.edge > 0 ? "text-[#388E3C]" : "text-foreground")}>
            {formatPercentage(bet.edge)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">EV</div>
          <div className={cn("font-bold text-sm", bet.ev > 0 ? "text-[#388E3C]" : "text-foreground")}>
            {formatPercentage(bet.ev)}
          </div>
        </div>
      </div>
    </Card>
  );
}
