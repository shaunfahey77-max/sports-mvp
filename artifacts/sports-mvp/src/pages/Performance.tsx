import { useState } from "react";
import { useGetPerformance, getGetPerformanceQueryKey, GetPerformanceWindow } from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { formatPercentage, formatDecimal } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function Performance() {
  const [window, setWindow] = useState<GetPerformanceWindow>(30);
  
  const { data: metrics, isLoading } = useGetPerformance(
    { window },
    { query: { queryKey: getGetPerformanceQueryKey({ window }) } }
  );

  return (
    <PageLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">Model Performance</h1>
          <p className="text-muted-foreground mt-2">Rolling analytics and ROI track record.</p>
        </div>
        <div className="flex gap-4">
          <Select value={window.toString()} onValueChange={(v) => setWindow(Number(v) as GetPerformanceWindow)}>
            <SelectTrigger className="w-[180px] bg-card">
              <SelectValue placeholder="Time Window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="14">Last 14 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="45">Last 45 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl bg-card" />
          ))}
        </div>
      ) : metrics ? (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Win Rate" value={formatPercentage(metrics.winRate)} trend={metrics.winRate > 0.52 ? "positive" : "neutral"} />
            <StatCard label="ROI" value={formatPercentage(metrics.roi)} trend={metrics.roi > 0 ? "positive" : "negative"} />
            <StatCard label="Units Won" value={`${metrics.unitsWon > 0 ? '+' : ''}${formatDecimal(metrics.unitsWon)}U`} trend={metrics.unitsWon > 0 ? "positive" : "negative"} />
            <StatCard label="CLV Hit Rate" value={formatPercentage(metrics.clvHitRate)} />
            <StatCard label="Total Picks" value={metrics.totalPicks.toString()} />
            <StatCard label="Avg EV" value={formatPercentage(metrics.avgEv)} />
            <StatCard label="Max Drawdown" value={`${formatDecimal(metrics.maxDrawdown)}U`} trend="negative" />
            <StatCard label="Brier Score" value={formatDecimal(metrics.brierScore, 3)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-bold font-display uppercase mb-4">By Tier</h3>
              <div className="space-y-3">
                {Object.entries(metrics.tierBreakdown || {}).map(([tier, count]) => (
                  <div key={tier} className="flex justify-between items-center">
                    <span className="font-medium">Tier {tier}</span>
                    <span className="text-muted-foreground">{count} picks</span>
                  </div>
                ))}
              </div>
            </Card>
            
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-bold font-display uppercase mb-4">By League</h3>
              <div className="space-y-3">
                {Object.entries(metrics.leagueBreakdown || {}).map(([league, count]) => (
                  <div key={league} className="flex justify-between items-center">
                    <span className="font-medium uppercase">{league}</span>
                    <span className="text-muted-foreground">{count} picks</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-bold font-display uppercase mb-4">By Market</h3>
              <div className="space-y-3">
                {Object.entries(metrics.marketBreakdown || {}).map(([market, count]) => (
                  <div key={market} className="flex justify-between items-center">
                    <span className="font-medium capitalize">{market}</span>
                    <span className="text-muted-foreground">{count} picks</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <p className="text-muted-foreground">Failed to load performance metrics.</p>
        </div>
      )}
    </PageLayout>
  );
}

function StatCard({ label, value, trend }: { label: string, value: string, trend?: "positive" | "negative" | "neutral" }) {
  return (
    <Card className="p-5 flex flex-col justify-center bg-card hover:bg-secondary/50 transition-colors border-border">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={`text-3xl font-display font-black ${trend === 'positive' ? 'text-[#388E3C]' : trend === 'negative' ? 'text-[#D32F2F]' : 'text-foreground'}`}>
        {value}
      </div>
    </Card>
  );
}
