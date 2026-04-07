import { useState } from "react";
import { useListPicks, useListCandidates, getListPicksQueryKey, getListCandidatesQueryKey } from "@workspace/api-client-react";
import type { ScoredPick } from "@workspace/api-client-react";
import { format } from "date-fns";
import { PickCard } from "@/components/PickCard";
import { CandidateCard } from "@/components/CandidateCard";
import { TopPickCallout } from "@/components/TopPickCallout";
import { AddBetPanel } from "@/components/AddBetPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/layout/PageLayout";
import { ChevronDown, ChevronUp, Lock, Crown } from "lucide-react";
import { addBet, LogPickData } from "@/lib/betTracker";
import { parseGameMatchup } from "@/lib/teamLogos";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Link } from "wouter";

function pickToLogData(pick: ScoredPick): LogPickData {
  const matchup = parseGameMatchup(pick.gameKey, pick.league);
  const matchupStr = matchup ? `${matchup.awayAbbrev} @ ${matchup.homeAbbrev}` : pick.gameKey;
  const pickIsOver = pick.pick === 'over';
  const pickIsUnder = pick.pick === 'under';
  const pickIsHome = pick.pick === 'home';
  const pickLabel = pickIsOver ? 'OVER'
    : pickIsUnder ? 'UNDER'
    : pickIsHome ? (matchup?.homeAbbrev ?? 'HOME')
    : (matchup?.awayAbbrev ?? 'AWAY');
  const line = pick.publishLine != null && pick.publishLine !== '' ? ` ${Number(pick.publishLine) > 0 ? '+' : ''}${pick.publishLine}` : '';
  return {
    league: pick.league,
    matchup: matchupStr,
    gameKey: pick.gameKey,
    market: pick.market,
    pick: `${pickLabel}${line}`,
    odds: Number(pick.publishOdds),
    tier: pick.tier,
    edge: Number(pick.edge),
    ev: Number(pick.ev),
    sourcePickId: pick.id,
  };
}

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
            <div className="text-[#4488FF] font-bold font-display mb-1 uppercase text-xs tracking-wider">Matchup</div>
            <p>The highlighted team or side is our pick. <strong className="text-foreground">HOME</strong> = home team, <strong className="text-foreground">AWAY</strong> = away team. For totals, <strong className="text-foreground">OVER/UNDER</strong> refers to the posted total. Odds are shown in American format.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function LockedPickCard() {
  return (
    <div className="relative rounded-xl border border-[#1A3066] bg-[#0D1B3E] overflow-hidden select-none">
      {/* Blurred content placeholder */}
      <div className="p-4 blur-sm pointer-events-none">
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1.5">
            <div className="h-5 w-10 rounded bg-[#1A3066]" />
            <div className="h-5 w-14 rounded bg-[#1A3066]" />
          </div>
          <div className="h-5 w-12 rounded bg-[#1A3066]" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-full bg-[#1A3066]" />
          <div className="h-4 w-8 rounded bg-[#1A3066]" />
          <div className="h-4 w-4 rounded bg-[#112454]" />
          <div className="h-7 w-7 rounded-full bg-[#1A3066]" />
          <div className="h-4 w-8 rounded bg-[#1A3066]" />
        </div>
        <div className="h-8 w-36 rounded bg-[#112454] mb-3" />
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#1A3066]">
          <div className="h-8 rounded bg-[#112454]" />
          <div className="h-8 rounded bg-[#112454]" />
          <div className="h-8 rounded bg-[#112454]" />
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#060D1F]/70 backdrop-blur-[1px]">
        <div className="h-9 w-9 rounded-full bg-[#0033A0]/20 border border-[#0033A0]/40 flex items-center justify-center">
          <Lock size={16} className="text-[#4488FF]" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">MVP Required</span>
      </div>
    </div>
  );
}

function UpgradeBanner({ pickCount }: { pickCount: number }) {
  return (
    <div className="rounded-xl border border-[#0033A0]/50 bg-gradient-to-r from-[#0D1B3E] to-[#112454] p-5 flex flex-col md:flex-row items-center gap-4 mt-2">
      <div className="flex items-center gap-3 flex-1">
        <div className="h-10 w-10 rounded-full bg-[#0033A0]/30 flex items-center justify-center shrink-0">
          <Crown size={18} className="text-[#4488FF]" />
        </div>
        <div>
          <div className="text-white font-bold text-sm">
            {pickCount - 1} more pick{pickCount - 1 !== 1 ? 's' : ''} available today
          </div>
          <div className="text-white/50 text-xs mt-0.5">
            Upgrade to MVP for all Tier A, B, and C picks with full edge, EV, and CLV data.
          </div>
        </div>
      </div>
      <Link
        href="/subscribe"
        className="shrink-0 inline-flex items-center gap-2 bg-[#0033A0] hover:bg-[#0041cc] text-white text-xs font-black uppercase tracking-wider px-5 py-2.5 rounded-lg transition-colors whitespace-nowrap"
      >
        Upgrade to MVP — $19.99/mo
      </Link>
    </div>
  );
}

export function Dashboard() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelData, setPanelData] = useState<LogPickData | undefined>(undefined);
  const { tier, isMvp } = useCurrentUser();

  function handleLogPick(pick: ScoredPick) {
    setPanelData(pickToLogData(pick));
    setPanelOpen(true);
  }

  const { data: scoredPicksData, isLoading: loadingPicks } = useListPicks(
    { date: todayStr },
    { query: { queryKey: getListPicksQueryKey({ date: todayStr }) } }
  );

  const { data: candidatesData, isLoading: loadingCandidates } = useListCandidates(
    { date: todayStr },
    { query: { queryKey: getListCandidatesQueryKey({ date: todayStr }) } }
  );

  const allPicks = scoredPicksData?.picks || [];
  const candidates = candidatesData || [];

  const topPickId = allPicks.length > 0
    ? allPicks.reduce((best, p) => Number(p.rankScore) > Number(best.rankScore) ? p : best).id
    : null;
  const topCandidateId = !topPickId && candidates.length > 0
    ? candidates.reduce((best, c) => Number(c.rankScore) > Number(best.rankScore) ? c : best).id
    : null;

  // Tier gating: free users only see the top pick
  const visiblePicks = isMvp ? allPicks : allPicks.slice(0, 1);
  const lockedCount = isMvp ? 0 : Math.max(0, allPicks.length - 1);

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
        <div className="text-sm font-display font-bold uppercase tracking-widest text-[#4488FF]">
          Bet Like an MVP.
        </div>
      </div>

      <HowItWorks open={howItWorksOpen} onToggle={() => setHowItWorksOpen(v => !v)} />

      {/* Free tier upgrade banner at top */}
      {!isMvp && tier === 'free' && allPicks.length > 1 && (
        <div className="mb-6 rounded-lg border border-[#FFC107]/25 bg-[#FFC107]/5 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Lock size={14} className="text-[#FFC107] shrink-0" />
            <span className="text-sm text-white/70">
              <span className="text-[#FFC107] font-bold">Free plan</span> — showing 1 of {allPicks.length} picks today.
              <Link href="/subscribe" className="ml-1 text-[#4488FF] hover:underline font-medium">Upgrade to MVP</Link> to unlock all picks.
            </span>
          </div>
        </div>
      )}

      {(loadingPicks || loadingCandidates) ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl bg-card" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[200px] w-full rounded-xl bg-card" />
            ))}
          </div>
        </div>
      ) : allPicks.length > 0 ? (
        <div className="space-y-6">
          <TopPickCallout picks={allPicks} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {visiblePicks.map((pick, i) => (
              <div key={pick.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: `${i * 50}ms` }}>
                <PickCard pick={pick} highlight={pick.id === topPickId} onLogPick={() => handleLogPick(pick)} />
              </div>
            ))}
            {/* Locked placeholder cards for free users */}
            {Array.from({ length: Math.min(lockedCount, 7) }).map((_, i) => (
              <LockedPickCard key={`locked-${i}`} />
            ))}
          </div>
          {/* Upgrade CTA after locked cards */}
          {!isMvp && allPicks.length > 1 && (
            <UpgradeBanner pickCount={allPicks.length} />
          )}
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

      <AddBetPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSubmit={(bet) => { addBet(bet); setPanelOpen(false); }}
        initialData={panelData}
      />
    </PageLayout>
  );
}
