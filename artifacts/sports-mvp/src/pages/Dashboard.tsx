import { useState } from "react";
import { useListPicks, useListCandidates, getListPicksQueryKey, getListCandidatesQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { PickCard } from "@/components/PickCard";
import { CandidateCard } from "@/components/CandidateCard";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLayout } from "@/components/layout/PageLayout";

export function Dashboard() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  
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

  return (
    <PageLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">Today's Action</h1>
          <p className="text-muted-foreground mt-2">{format(new Date(), "EEEE, MMMM do, yyyy")}</p>
        </div>
      </div>

      {(loadingPicks || loadingCandidates) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-[180px] w-full rounded-xl bg-card" />
          ))}
        </div>
      ) : picks.length > 0 ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {picks.map((pick, i) => (
              <div key={pick.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: `${i * 50}ms` }}>
                <PickCard pick={pick} />
              </div>
            ))}
          </div>
        </div>
      ) : candidates.length > 0 ? (
        <div className="space-y-6">
          <div className="bg-secondary/50 p-4 rounded-lg border border-border">
            <h2 className="text-lg font-bold text-accent mb-1 flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-accent"></span>
              </span>
              Pending Finalization
            </h2>
            <p className="text-sm text-muted-foreground">Games are available but closing lines are not yet finalized. Displaying un-scored candidate bets.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {candidates.map((bet, i) => (
              <div key={bet.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" style={{ animationDelay: `${i * 50}ms` }}>
                <CandidateCard bet={bet} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <h3 className="text-2xl font-display font-bold mb-2">No Action Today</h3>
          <p className="text-muted-foreground">The model hasn't found any edges worth betting. Check back later.</p>
        </div>
      )}
    </PageLayout>
  );
}
