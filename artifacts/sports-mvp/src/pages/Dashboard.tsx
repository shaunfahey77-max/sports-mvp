import { useState } from "react";
import { useListPicks, useListCandidates, getListPicksQueryKey, getListCandidatesQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { PickCard } from "@/components/PickCard";
import { CandidateCard } from "@/components/CandidateCard";
import { TopPickCallout } from "@/components/TopPickCallout";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/layout/PageLayout";
import { ChevronDown, ChevronUp } from "lucide-react";

function HowItWorks({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg border border-[#1A3066] bg-[#0D1B3E] overflow-hidden mb-8">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        onClick={onToggle}
      >
        <span className="text-xs font-bold font-display uppercase tracking-widest text-muted-foreground">How to Read Today's Picks</span>
        {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground border-t border-[#1A3066] pt-4">
          <div>
            <div className="text-[#FFC107] font-bold font-display mb-1 uppercase text-xs tracking-wider">Tier</div>
            <p>Picks are ranked <strong className="text-foreground">A, B, or C</strong> based on the model's composite rank score. Tier A carries the strongest edge and highest confidence. Size your bets accordingly — A gets full units, B gets half, C gets quarter.</p>
          </div>
          <div>
            <div className="text-[#388E3C] font-bold font-display mb-1 uppercase text-xs tracking-wider">Edge &amp; EV</div>
            <p><strong className="text-foreground">Edge</strong> is the gap between our calibrated probability and the book's true fair probability (after removing the vig). <strong className="text-foreground">EV</strong> is the estimated profit per $100 wagered. Both should be positive to bet.</p>
          </div>
          <div>
            <div className="text-[#0033A0] font-bold font-display mb-1 uppercase text-xs tracking-wider">Matchup</div>
            <p>The highlighted team or side is our pick. <strong className="text-foreground">HOME</strong> = home team, <strong className="text-foreground">AWAY</strong> = away team. For totals, <strong className="text-foreground">OVER/UNDER</strong> refers to the posted total. Odds are shown in American format.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const { data: scoredPicksData, isLoading: loadingPicks } = useListPicks(
    { date: todayStr },
    { query: { queryKey: getListPicksQueryKey({ date: todayStr }) } }
  );

  const { data: candidatesData, isLoading: loadingCandidates } = useListCandidates(
    { date: todayStr },
    { query: { queryKey: getListCandidatesQueryKey({ date: todayStr }) } }
  );

  const picks = scoredPicksData?.picks || [];
  const candidates = candidatesData || [];

  const topPickId = picks.length > 0
    ? picks.reduce((best, p) => Number(p.rankScore) > Number(best.rankScore) ? p : best).id
    : null;
  const topCandidateId = !topPickId && candidates.length > 0
    ? candidates.reduce((best, c) => Number(c.rankScore) > Number(best.rankScore) ? c : best).id
    : null;

  return (
    <PageLayout>
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/logo-shield.png" alt="SportsMVP" className="h-12 w-auto drop-shadow-lg" />
          <div>
            <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">Today's Action</h1>
            <p className="text-muted-foreground mt-1">{format(new Date(), "EEEE, MMMM do, yyyy")}</p>
          </div>
        </div>
        <div className="text-sm font-display font-bold uppercase tracking-widest text-[#0033A0]">
          Bet Like an MVP.
        </div>
      </div>

      <HowItWorks open={howItWorksOpen} onToggle={() => setHowItWorksOpen(v => !v)} />

      {(loadingPicks || loadingCandidates) ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl bg-card" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[200px] w-full rounded-xl bg-card" />
            ))}
          </div>
        </div>
      ) : picks.length > 0 ? (
        <div className="space-y-6">
          <TopPickCallout picks={picks} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {picks.map((pick, i) => (
              <div key={pick.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: `${i * 50}ms` }}>
                <PickCard pick={pick} highlight={pick.id === topPickId} />
              </div>
            ))}
          </div>
        </div>
      ) : candidates.length > 0 ? (
        <div className="space-y-6">
          <div className="bg-[#112454]/60 px-4 py-3 rounded-lg border border-[#1A3066] flex items-start gap-3">
            <span className="relative flex h-2.5 w-2.5 mt-0.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#388E3C] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#388E3C]"></span>
            </span>
            <div>
              <div className="text-sm font-bold text-[#388E3C] mb-0.5">Live Candidates — Closing Lines Pending</div>
              <p className="text-xs text-muted-foreground">Picks are generated. Final scoring happens once closing lines are posted. These are pre-score candidates using opening probabilities.</p>
            </div>
          </div>
          <TopPickCallout candidates={candidates} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {candidates.map((bet, i) => (
              <div key={bet.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: `${i * 50}ms` }}>
                <CandidateCard bet={bet} highlight={bet.id === topCandidateId} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <img src="/logo-shield.png" alt="" className="h-14 w-auto mx-auto mb-4 opacity-20" />
          <h3 className="text-2xl font-display font-bold mb-2">No Action Today</h3>
          <p className="text-muted-foreground">The model hasn't found any edges worth betting. Sharp bettors wait for the right spots — check back later.</p>
        </div>
      )}
    </PageLayout>
  );
}
