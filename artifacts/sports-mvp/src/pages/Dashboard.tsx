import { useState } from "react";
import { useListPicks, useListCandidates, getListPicksQueryKey, getListCandidatesQueryKey } from "@workspace/api-client-react";
import type { ScoredPick, CandidateBet } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { PickCard } from "@/components/PickCard";
import { CandidateCard } from "@/components/CandidateCard";
import { NoOfficialPicksSection } from "@/components/NoOfficialPicksSection";
import { TopPickCallout } from "@/components/TopPickCallout";
import { AddBetPanel } from "@/components/AddBetPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/layout/PageLayout";
import { ChevronDown, ChevronUp, Lock, Crown } from "lucide-react";
import { addBet, LogPickData } from "@/lib/betTracker";
import { getSlateDayET } from "@/lib/slateDay";
import { parseGameMatchup } from "@/lib/teamLogos";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLaunchConfig } from "@/hooks/useLaunchConfig";
import { selectFallbackSection } from "@/lib/modelWatchBoard";
import { partitionCandidatesBySurfaceStatus } from "@/lib/candidateSurface";
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
  const line = pick.publishLine != null ? ` ${Number(pick.publishLine) > 0 ? '+' : ''}${pick.publishLine}` : '';
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

// Mirror of pickToLogData for the pre-score "candidate" surface so the
// "+ Add to Tracker" affordance produces the same prefilled panel whether
// the slate is in scored-picks mode (PickCard) or live-candidates mode
// (CandidateCard). Only the field-name shape differs (side/marketType).
function candidateToLogData(bet: CandidateBet): LogPickData {
  const matchup = parseGameMatchup(bet.gameKey, bet.league);
  const matchupStr = matchup ? `${matchup.awayAbbrev} @ ${matchup.homeAbbrev}` : bet.gameKey;
  const sideIsOver = bet.side === 'over';
  const sideIsUnder = bet.side === 'under';
  const sideIsHome = bet.side === 'home';
  const sideLabel = sideIsOver ? 'OVER'
    : sideIsUnder ? 'UNDER'
    : sideIsHome ? (matchup?.homeAbbrev ?? 'HOME')
    : (matchup?.awayAbbrev ?? 'AWAY');
  const line = bet.publishLine != null ? ` ${Number(bet.publishLine) > 0 ? '+' : ''}${bet.publishLine}` : '';
  return {
    league: bet.league,
    matchup: matchupStr,
    gameKey: bet.gameKey,
    market: bet.marketType,
    pick: `${sideLabel}${line}`,
    odds: Number(bet.publishOdds),
    tier: bet.tier,
    edge: Number(bet.edge),
    ev: Number(bet.ev),
    sourcePickId: bet.id,
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
            <p>Picks are ranked <strong className="text-foreground">A, B, or C</strong> based on the model's composite rank score. Tier A reflects the strongest signal on the current slate, with B and C trailing behind it.</p>
          </div>
          <div>
            <div className="text-[#4ADE80] font-bold font-display mb-1 uppercase text-xs tracking-wider">Edge &amp; EV</div>
            <p><strong className="text-foreground">Edge</strong> is the gap between our calibrated probability and the book's true fair probability (after removing the vig). <strong className="text-foreground">EV</strong> is the estimated profit per $100 wagered. Both should be positive to bet.</p>
          </div>
          <div>
            <div className="text-[#FFC107] font-bold font-display mb-1 uppercase text-xs tracking-wider">Matchup</div>
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
        <div className="h-9 w-9 rounded-full bg-[#FFC107]/15 border border-[#FFC107]/40 flex items-center justify-center">
          <Lock size={16} className="text-[#FFC107]" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#FFC107]/70">MVP Required</span>
      </div>
    </div>
  );
}

function UpgradeBanner({ pickCount, betaMode }: { pickCount: number; betaMode: boolean }) {
  return (
    <div className="rounded-sm border border-[#FFC107]/40 bg-gradient-to-r from-[#0D1B3E] to-[#112454] p-5 flex flex-col md:flex-row items-center gap-4 mt-2">
      <div className="flex items-center gap-3 flex-1">
        <div className="h-10 w-10 rounded-full bg-[#FFC107]/15 border border-[#FFC107]/40 flex items-center justify-center shrink-0">
          <Crown size={18} className="text-[#FFC107]" />
        </div>
        <div>
          <div className="text-white font-bold text-sm">
            {betaMode
              ? `${pickCount - 1} more pick${pickCount - 1 !== 1 ? 's' : ''} reserved for Members`
              : `${pickCount - 1} more pick${pickCount - 1 !== 1 ? 's' : ''} available today`}
          </div>
          <div className="text-white/55 text-xs mt-0.5">
            {betaMode
              ? "Paid Membership opens when the first market sustains Official status with a clean public record. Join the waitlist and we’ll email you when that happens."
              : "MVP adds the full slate and the supporting edge, EV, and CLV context behind each pick."}
          </div>
        </div>
      </div>
      <Link
        href="/subscribe"
        className="shrink-0 inline-flex items-center gap-2 bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F] text-xs font-bold uppercase tracking-[0.2em] px-5 py-2.5 rounded-sm transition-colors whitespace-nowrap"
      >
        {betaMode ? "Join the Waitlist" : "Upgrade to MVP — $19.99/mo"}
      </Link>
    </div>
  );
}

export function Dashboard() {
  // Slate day is the ET calendar date — the same bucket the server
  // stores games under. Using the browser's local-tz date here would
  // silently roll over a day early for any user east of ET, causing
  // tomorrow's slate to render as "Today's Picks". See
  // `src/lib/slateDay.ts`.
  const todayStr = getSlateDayET();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelData, setPanelData] = useState<LogPickData | undefined>(undefined);
  const { tier, isMvp } = useCurrentUser();
  const { betaMode } = useLaunchConfig();

  function handleLogPick(pick: ScoredPick) {
    setPanelData(pickToLogData(pick));
    setPanelOpen(true);
  }

  function handleLogCandidate(bet: CandidateBet) {
    setPanelData(candidateToLogData(bet));
    setPanelOpen(true);
  }

  const picksParams = { date: todayStr, result: 'pending' as const };
  const { data: scoredPicksData, isLoading: loadingPicks } = useListPicks(
    picksParams,
    { query: { queryKey: getListPicksQueryKey(picksParams) } }
  );

  const { data: candidatesData, isLoading: loadingCandidates } = useListCandidates(
    { gameDate: todayStr },
    { query: { queryKey: getListCandidatesQueryKey({ gameDate: todayStr }) } }
  );

  const allPicks = scoredPicksData?.picks || [];
  const candidates = candidatesData || [];

  // Product-layer separation:
  //  - "live candidates" = candidates that cleared the scoring gates (non-PASS).
  //    These are real picks waiting for closing lines and behave like official picks
  //    in the UI (top-pick callout, full grid).
  //  - "fallback candidates" = PASS-tier rows. These never enter scored_picks and
  //    therefore never enter /api/performance. They are shown ONLY when there are
  //    zero qualifying picks/candidates today, and ONLY as the single highest-ranked
  //    row, clearly labeled as Model Watch / Not an Official Pick.
  const { liveCandidates, passCandidates } =
    partitionCandidatesBySurfaceStatus(candidates);
  // Pure render-decision for the no-Official-day section. Returning a
  // discriminated union here keeps Dashboard.tsx free of the branching
  // logic and makes case (a)-(e) of the spec independently testable in
  // selectFallbackSection's unit tests, without standing up a React
  // rendering harness.
  const fallbackSection = selectFallbackSection({ passCandidates, isMvp });

  const topPickId = allPicks.length > 0
    ? allPicks.reduce((best, p) => Number(p.rankScore) > Number(best.rankScore) ? p : best).id
    : null;
  const topCandidateId = !topPickId && liveCandidates.length > 0
    ? liveCandidates.reduce((best, c) => Number(c.rankScore) > Number(best.rankScore) ? c : best).id
    : null;

  // Tier gating: free users only see the top pick
  const visiblePicks = isMvp ? allPicks : allPicks.slice(0, 1);
  const lockedCount = isMvp ? 0 : Math.max(0, allPicks.length - 1);

  return (
    <PageLayout
      title="Today's Picks"
      subtitle={format(parseISO(todayStr), "EEEE, MMMM do, yyyy")}
      tagline="TODAY'S ACTION"
    >
      <HowItWorks open={howItWorksOpen} onToggle={() => setHowItWorksOpen(v => !v)} />

      {/* Free tier upgrade banner at top */}
      {!isMvp && tier === 'free' && allPicks.length > 1 && (
        <div className="mb-6 rounded-lg border border-[#FFC107]/25 bg-[#FFC107]/5 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Lock size={14} className="text-[#FFC107] shrink-0" />
            {betaMode ? (
              <span className="text-sm text-white/70">
                <span className="text-[#FFC107] font-bold">Open Beta</span> — Free Guest Pass shows 1 of {allPicks.length} picks today.
                <Link href="/subscribe" className="ml-1 text-[#FFC107] hover:underline font-medium">Join the waitlist</Link> for full-slate access when paid opens.
              </span>
            ) : (
              <span className="text-sm text-white/70">
                <span className="text-[#FFC107] font-bold">Free plan</span> — showing 1 of {allPicks.length} picks today.
                <Link href="/subscribe" className="ml-1 text-[#FFC107] hover:underline font-medium">See MVP access</Link> for the full slate and supporting detail.
              </span>
            )}
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
            <UpgradeBanner pickCount={allPicks.length} betaMode={betaMode} />
          )}
        </div>
      ) : liveCandidates.length > 0 ? (
        <div className="space-y-6">
          <div className="bg-[#112454]/60 px-4 py-3 rounded-lg border border-[#1A3066] flex items-start gap-3">
            <span className="relative flex h-2.5 w-2.5 mt-0.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4ADE80] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4ADE80]"></span>
            </span>
            <div>
              <div className="text-sm font-bold text-[#4ADE80] mb-0.5">Live Candidates — Evaluation in Progress</div>
              <p className="text-xs text-muted-foreground">These markets have surfaced candidates, but final grading depends on settlement and close-line capture. They are shown here for transparency, not as settled track record.</p>
            </div>
          </div>
          <TopPickCallout candidates={liveCandidates} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {liveCandidates.map((bet, i) => (
              <div key={bet.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: `${i * 50}ms` }}>
                <CandidateCard bet={bet} highlight={bet.id === topCandidateId} onLogPick={() => handleLogCandidate(bet)} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <NoOfficialPicksSection
          section={fallbackSection}
          onLogPick={handleLogCandidate}
        />
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
