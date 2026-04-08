import { useState } from "react";
import { useListPicks, getListPicksQueryKey, League, MarketType, Tier } from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PickCard } from "@/components/PickCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";

function HowItWorks({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg border border-[#1A3066] bg-[#0D1B3E] overflow-hidden mb-8">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        onClick={onToggle}
      >
        <span className="text-xs font-bold font-display uppercase tracking-widest text-muted-foreground">How to Use Pick History</span>
        {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground border-t border-[#1A3066] pt-4">
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">Filtering</div>
            <p>Use the dropdowns to filter picks by league, market type, or tier. This lets you analyze performance in specific segments — for example, how Tier A NHL moneyline picks have performed vs. NCAAM spreads.</p>
          </div>
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">Reading Results</div>
            <p><span className="text-[#388E3C] font-bold">WIN</span> and <span className="text-[#D32F2F] font-bold">LOSS</span> are settled outcomes. <span className="text-[#FFC107] font-bold">PUSH</span> means the bet was a draw and your stake was returned. Only completed picks appear here — today's pending picks are on the Today's Picks page.</p>
          </div>
          <div>
            <div className="text-white font-bold font-display mb-1 uppercase text-xs tracking-wider">CLV Tracking</div>
            <p>When available, each pick shows its <strong className="text-foreground">Closing Line Value (CLV)</strong> — how much the odds moved in our favor after publishing. Consistently positive CLV is the strongest proof of genuine edge.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function History() {
  const [league, setLeague] = useState<League | "ALL">("ALL");
  const [market, setMarket] = useState<MarketType | "ALL">("ALL");
  const [tier, setTier] = useState<Tier | "ALL">("ALL");
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

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

  const picks = (data?.picks || []).filter(p => p.result !== 'pending');

  return (
    <PageLayout>
      <div className="mb-6 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/logo-shield.png" alt="SportsMVP" className="h-12 w-auto drop-shadow-lg" />
          <div>
            <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">Pick History</h1>
            <p className="text-muted-foreground mt-1">Full record of all published picks and outcomes.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <Select value={league} onValueChange={(v) => setLeague(v as any)}>
            <SelectTrigger className="w-[130px] bg-card border-border">
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
            <SelectTrigger className="w-[130px] bg-card border-border">
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
            <SelectTrigger className="w-[120px] bg-card border-border">
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

      <HowItWorks open={howItWorksOpen} onToggle={() => setHowItWorksOpen(v => !v)} />

      {picks.length > 0 && !isLoading && (
        <div className="mb-4 flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            Showing <span className="text-foreground font-bold">{picks.length}</span> picks
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#388E3C] inline-block" /> Wins: {picks.filter(p => p.result === 'win').length}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#D32F2F] inline-block" /> Losses: {picks.filter(p => p.result === 'loss').length}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#FFC107] inline-block" /> Pushes: {picks.filter(p => p.result === 'push').length}</span>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="h-[200px] w-full rounded-xl bg-card" />
          ))}
        </div>
      ) : picks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-500">
          {picks.map((pick) => (
            <PickCard key={pick.id} pick={pick} />
          ))}
        </div>
      ) : (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <img src="/logo-shield.png" alt="" className="h-14 w-auto mx-auto mb-4 opacity-20" />
          <p className="text-muted-foreground">No picks found matching your filters.</p>
        </div>
      )}
    </PageLayout>
  );
}
