import { useState } from "react";
import { useLocation } from "wouter";
import { useListPicks, getListPicksQueryKey, League, MarketType, Tier, ScoredPick } from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PickCard } from "@/components/PickCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Archive } from "lucide-react";
import { LogPickData, stashPrefillPick } from "@/lib/betTracker";
import { parseGameMatchup } from "@/lib/teamLogos";

// Mirrors Dashboard's pickToLogData so prefill formatting is consistent across
// the two entry points into AddBetPanel. Resolves home/away to team abbrevs
// and includes the spread/total line on the pick label.
function pickToLogData(pick: ScoredPick): LogPickData {
  const matchup = parseGameMatchup(pick.gameKey, pick.league);
  const matchupStr = matchup ? `${matchup.awayAbbrev} @ ${matchup.homeAbbrev}` : pick.gameKey;
  const pickIsOver = pick.pick === "over";
  const pickIsUnder = pick.pick === "under";
  const pickIsHome = pick.pick === "home";
  const pickLabel = pickIsOver
    ? "OVER"
    : pickIsUnder
    ? "UNDER"
    : pickIsHome
    ? matchup?.homeAbbrev ?? "HOME"
    : matchup?.awayAbbrev ?? "AWAY";
  const line =
    pick.publishLine != null
      ? ` ${Number(pick.publishLine) > 0 ? "+" : ""}${pick.publishLine}`
      : "";
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

const SERIF = "'Playfair Display', serif";

function HistoryGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-sm border border-[#1A3066] bg-[#0D1B3E] overflow-hidden mb-10">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#FFC107]">
          <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
          Reading the Record
        </span>
        {open ? <ChevronUp size={14} className="text-white/50" /> : <ChevronDown size={14} className="text-white/50" />}
      </button>
      {open && (
        <div className="px-5 pb-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-white/70 border-t border-[#1A3066] pt-6">
          {[
            {
              title: "Filtering",
              body: "Filter by league, market, or tier to analyze segments — for example, Tier-A picks within a single league or market.",
            },
            {
              title: "Reading Results",
              body: (<><span className="text-[#4ADE80] font-bold">WIN</span> and <span className="text-[#F87171] font-bold">LOSS</span> are settled. <span className="text-[#FFC107] font-bold">PUSH</span> means draw and stake returned. Pending picks live on Today's Picks.</>),
            },
            {
              title: "CLV Tracking",
              body: (<>Closing Line Value (CLV) shows how much the line moved in our favor after publish. Consistently positive CLV is the strongest proof of genuine edge.</>),
            },
          ].map((item, i) => (
            <div key={i}>
              <div className="text-white font-bold mb-2 text-sm" style={{ fontFamily: SERIF }}>
                {item.title}
              </div>
              <p className="leading-relaxed text-white/55">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function History() {
  const [, setLocation] = useLocation();
  const [league, setLeague] = useState<League | "ALL">("ALL");
  const [market, setMarket] = useState<MarketType | "ALL">("ALL");
  const [tier, setTier] = useState<Tier | "ALL">("ALL");
  const [guideOpen, setGuideOpen] = useState(false);

  const params = {
    ...(league !== "ALL" ? { league } : {}),
    ...(market !== "ALL" ? { market } : {}),
    ...(tier !== "ALL" ? { tier } : {}),
    limit: 100,
  };

  const { data, isLoading } = useListPicks(
    params,
    { query: { queryKey: getListPicksQueryKey(params) } }
  );

  // Show all picks the API returns, including pending ones — they're part of
  // the historical record and let the user "Add to Tracker" from this page.
  // Users who only want graded results can filter via the Result dropdown.
  const picks = data?.picks || [];
  const wins = picks.filter(p => p.result === "win").length;
  const losses = picks.filter(p => p.result === "loss").length;
  const pushes = picks.filter(p => p.result === "push").length;
  const filtersActive = league !== "ALL" || market !== "ALL" || tier !== "ALL";

  return (
    <PageLayout>
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[#1A3066]">
        <div>
          <div className="text-[#FFC107] text-[11px] font-bold tracking-[0.25em] uppercase mb-3">
            Pick Archive
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight" style={{ fontFamily: SERIF }}>
            History
          </h1>
          <p className="text-white/55 mt-3 text-base max-w-xl">
            Every published pick, every result. The full record, never edited.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <FilterSelect label="League" value={league} onChange={(v) => setLeague(v as any)} options={[
            { value: "ALL", label: "All Leagues" },
            { value: "nba", label: "NBA" },
            { value: "nhl", label: "NHL" },
            { value: "mlb", label: "MLB" },
            { value: "ncaam", label: "NCAAM" },
          ]} />
          <FilterSelect label="Market" value={market} onChange={(v) => setMarket(v as any)} options={[
            { value: "ALL", label: "All Markets" },
            { value: "moneyline", label: "Moneyline" },
            { value: "spread", label: "Spread" },
            { value: "total", label: "Total" },
          ]} />
          <FilterSelect label="Score" value={tier} onChange={(v) => setTier(v as any)} options={[
            { value: "ALL", label: "All Scores" },
            { value: "A", label: "Score A" },
            { value: "B", label: "Score B" },
            { value: "C", label: "Score C" },
            { value: "PASS", label: "Pass" },
          ]} />
        </div>
      </div>

      <HistoryGuide open={guideOpen} onToggle={() => setGuideOpen(v => !v)} />

      {picks.length > 0 && !isLoading && (
        <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-5 py-4 rounded-sm border border-[#1A3066] bg-[#0D1B3E]">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm text-white/70">
              <Archive size={14} className="text-[#FFC107]" />
              <span>
                Showing <span className="text-white font-bold">{picks.length}</span>{" "}
                {filtersActive ? "filtered" : ""} picks
              </span>
            </div>
            <p className="text-[11px] text-white/40 italic md:pl-6 leading-snug">
              Showing picks since the current model went live on April&nbsp;12,&nbsp;2026.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <ResultPill color="#4ADE80" label="Wins" count={wins} />
            <ResultPill color="#F87171" label="Losses" count={losses} />
            <ResultPill color="#FFC107" label="Pushes" count={pushes} />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="h-[200px] w-full rounded-sm bg-[#0D1B3E]" />
          ))}
        </div>
      ) : picks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-500">
          {picks.map((pick) => (
            <PickCard
              key={pick.id}
              pick={pick}
              onLogPick={
                pick.result === "pending"
                  ? () => {
                      stashPrefillPick(pickToLogData(pick));
                      setLocation("/tracker");
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="py-24 text-center border border-[#1A3066] rounded-sm bg-[#0D1B3E]/50">
          <Archive size={32} className="text-[#FFC107]/30 mx-auto mb-4" />
          <p className="text-white/50">
            {filtersActive
              ? "No picks match those filters. Try widening the search."
              : "No graded picks yet."}
          </p>
        </div>
      )}
    </PageLayout>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const isActive = value !== "ALL";
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={`w-[140px] bg-[#0D1B3E] text-white text-sm h-9 ${
          isActive ? "border-[#FFC107]/50" : "border-[#1A3066]"
        }`}
        aria-label={label}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ResultPill({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-[#1A3066] bg-[#060D1F]">
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-white/60 uppercase tracking-wider text-[10px] font-bold">{label}</span>
      <span className="text-white font-mono text-xs">{count}</span>
    </span>
  );
}
