import { useState } from "react";
import { useListPicks, getListPicksQueryKey, League, MarketType, Tier } from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PickCard } from "@/components/PickCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function History() {
  const [league, setLeague] = useState<League | "ALL">("ALL");
  const [market, setMarket] = useState<MarketType | "ALL">("ALL");
  const [tier, setTier] = useState<Tier | "ALL">("ALL");
  
  const params = {
    ...(league !== "ALL" ? { league } : {}),
    ...(market !== "ALL" ? { market } : {}),
    ...(tier !== "ALL" ? { tier } : {}),
    limit: 100
  };

  const { data, isLoading } = useListPicks(
    params,
    { query: { queryKey: getListPicksQueryKey(params) } }
  );

  const picks = data?.picks || [];

  return (
    <PageLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">Pick History</h1>
          <p className="text-muted-foreground mt-2">Filter and review past performance.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Select value={league} onValueChange={(v) => setLeague(v as any)}>
            <SelectTrigger className="w-[140px] bg-card">
              <SelectValue placeholder="League" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Leagues</SelectItem>
              <SelectItem value="nba">NBA</SelectItem>
              <SelectItem value="nhl">NHL</SelectItem>
              <SelectItem value="ncaam">NCAAM</SelectItem>
            </SelectContent>
          </Select>

          <Select value={market} onValueChange={(v) => setMarket(v as any)}>
            <SelectTrigger className="w-[140px] bg-card">
              <SelectValue placeholder="Market" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Markets</SelectItem>
              <SelectItem value="moneyline">Moneyline</SelectItem>
              <SelectItem value="spread">Spread</SelectItem>
              <SelectItem value="total">Total</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tier} onValueChange={(v) => setTier(v as any)}>
            <SelectTrigger className="w-[140px] bg-card">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Tiers</SelectItem>
              <SelectItem value="A">Tier A</SelectItem>
              <SelectItem value="B">Tier B</SelectItem>
              <SelectItem value="C">Tier C</SelectItem>
              <SelectItem value="PASS">Pass</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="h-[180px] w-full rounded-xl bg-card" />
          ))}
        </div>
      ) : picks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-500">
          {picks.map((pick, i) => (
            <div key={pick.id}>
              <PickCard pick={pick} />
            </div>
          ))}
        </div>
      ) : (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <p className="text-muted-foreground">No picks found matching your filters.</p>
        </div>
      )}
    </PageLayout>
  );
}
