import { ScoredPick } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatOdds, formatPercentage, getLeagueColor, getMarketColorClass, getTierColorClass, getResultColorClass, cn } from "@/lib/utils";

export function PickCard({ pick }: { pick: ScoredPick }) {
  return (
    <Card className="p-4 border-border bg-card/80 hover:bg-card transition-colors flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" style={{ color: getLeagueColor(pick.league), borderColor: getLeagueColor(pick.league) }} className="bg-transparent uppercase">
            {pick.league}
          </Badge>
          <Badge className={getMarketColorClass(pick.market)}>
            {pick.market.toUpperCase()}
          </Badge>
        </div>
        <Badge className={getTierColorClass(pick.tier)}>
          TIER {pick.tier}
        </Badge>
      </div>

      <div className="mt-2">
        <div className="text-sm text-muted-foreground mb-1">{pick.gameKey}</div>
        <div className="text-xl font-bold font-display tracking-tight flex items-baseline gap-2">
          <span>{pick.pick.toUpperCase()}</span>
          {pick.publishLine !== undefined && pick.publishLine !== null && (
            <span className="text-muted-foreground">{pick.publishLine > 0 ? `+${pick.publishLine}` : pick.publishLine}</span>
          )}
          <span className="text-primary">{formatOdds(pick.publishOdds)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2 pt-3 border-t border-border">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Edge</div>
          <div className={cn("font-bold text-sm", pick.edge > 0 ? "text-[#388E3C]" : "text-foreground")}>
            {formatPercentage(pick.edge)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">EV</div>
          <div className={cn("font-bold text-sm", pick.ev > 0 ? "text-[#388E3C]" : "text-foreground")}>
            {formatPercentage(pick.ev)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Result</div>
          <div className={cn("font-bold uppercase text-sm", getResultColorClass(pick.result))}>
            {pick.result}
          </div>
        </div>
      </div>
    </Card>
  );
}
