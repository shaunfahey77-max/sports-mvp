import { useState, useMemo } from "react";
import { useListPicks, getListPicksQueryKey } from "@workspace/api-client-react";
import type { ScoredPick } from "@workspace/api-client-react";
import { format } from "date-fns";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  cn,
  formatOdds,
  formatPercentage,
  getLeagueColor,
  getMarketColorClass,
  getTierColorClass,
} from "@/lib/utils";
import { parseGameMatchup } from "@/lib/teamLogos";
import { calcParlay, autoBuildParlay, americanToDecimal, decimalToAmerican } from "@/lib/parlayMath";
import { X, Zap, AlertTriangle, ChevronDown, ChevronUp, Lock } from "lucide-react";

// ─── Parlay Pick Row ──────────────────────────────────────────────────────────

function ParlayPickRow({
  pick,
  selected,
  onToggle,
  disabled,
}: {
  pick: ScoredPick;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const matchup = parseGameMatchup(pick.gameKey, pick.league);
  const isOver = pick.pick === "over";
  const isUnder = pick.pick === "under";
  const isHome = pick.pick === "home";

  const pickLabel = isOver
    ? "OVER"
    : isUnder
    ? "UNDER"
    : isHome
    ? matchup?.homeAbbrev ?? "HOME"
    : matchup?.awayAbbrev ?? "AWAY";

  return (
    <button
      onClick={onToggle}
      disabled={disabled && !selected}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-all duration-150 flex items-center gap-3",
        selected
          ? "bg-[#0D1B3E] border-[#4488FF]/60 shadow-[0_0_12px_rgba(68,136,255,0.12)]"
          : "bg-card/60 border-border hover:bg-card hover:border-[#1A3066]",
        disabled && !selected && "opacity-40 cursor-not-allowed"
      )}
    >
      <div
        className={cn(
          "shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
          selected ? "bg-[#4488FF] border-[#4488FF]" : "border-[#1A3066] bg-transparent"
        )}
      >
        {selected && (
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 items-center">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="outline"
            style={{ color: getLeagueColor(pick.league), borderColor: getLeagueColor(pick.league) }}
            className="bg-transparent uppercase text-[9px] px-1 py-0 leading-tight"
          >
            {pick.league}
          </Badge>
          <Badge className={cn(getMarketColorClass(pick.market), "text-[9px] px-1 py-0 leading-tight")}>
            {pick.market.toUpperCase()}
          </Badge>
          <Badge className={cn(getTierColorClass(pick.tier), "text-[9px] px-1 py-0 leading-tight")}>
            {pick.tier}
          </Badge>
        </div>
        <div className="text-right flex items-center gap-1.5 justify-end">
          <span className="text-[10px] text-muted-foreground">
            EV <span className="text-[#388E3C] font-bold">{formatPercentage(Number(pick.ev))}</span>
          </span>
        </div>

        <div className="font-display font-bold text-sm flex items-baseline gap-1.5 truncate">
          <span className={cn(isOver || isUnder ? "text-[#00897B]" : "text-foreground")}>
            {pickLabel}
          </span>
          {pick.publishLine != null && pick.publishLine !== "" && (
            <span className="text-muted-foreground text-xs">
              {Number(pick.publishLine) > 0 ? `+${pick.publishLine}` : pick.publishLine}
            </span>
          )}
          <span className="text-primary text-xs">{formatOdds(Number(pick.publishOdds))}</span>
        </div>

        <div className="text-[10px] text-muted-foreground text-right truncate">
          {matchup ? `${matchup.awayAbbrev} @ ${matchup.homeAbbrev}` : pick.gameKey}
        </div>
      </div>
    </button>
  );
}

// ─── Parlay Slip ──────────────────────────────────────────────────────────────

function ParlaySlip({
  legs,
  onRemoveLeg,
  onClear,
}: {
  legs: ScoredPick[];
  onRemoveLeg: (id: number) => void;
  onClear: () => void;
}) {
  const parlay = useMemo(() => calcParlay(legs), [legs]);
  const hasEnough = legs.length >= 2;
  const evPositive = parlay.ev >= 0;

  return (
    <Card className="bg-[#0D1B3E] border-[#1A3066] p-4 flex flex-col gap-4 sticky top-24">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display font-bold uppercase tracking-wider text-sm">Parlay Slip</div>
          <div className="text-[10px] text-muted-foreground">
            {legs.length === 0
              ? "No legs selected"
              : `${legs.length} leg${legs.length === 1 ? "" : "s"} — select at least 2`}
          </div>
        </div>
        {legs.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors border border-[#1A3066] hover:border-[#4488FF]/40 rounded px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {legs.length === 0 ? (
        <div className="py-6 text-center border border-dashed border-[#1A3066] rounded-lg">
          <div className="text-muted-foreground text-xs leading-relaxed">
            Select picks from the list<br />to build your parlay
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {legs.map((leg) => {
            const matchup = parseGameMatchup(leg.gameKey, leg.league);
            const isOver = leg.pick === "over";
            const isUnder = leg.pick === "under";
            const isHome = leg.pick === "home";
            const pickLabel = isOver
              ? "OVER"
              : isUnder
              ? "UNDER"
              : isHome
              ? matchup?.homeAbbrev ?? "HOME"
              : matchup?.awayAbbrev ?? "AWAY";
            return (
              <div
                key={leg.id}
                className="flex items-center gap-2 bg-[#112454]/60 rounded px-2.5 py-1.5 border border-[#1A3066]/60"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold font-display flex items-baseline gap-1.5">
                    <span className={cn(isOver || isUnder ? "text-[#00897B]" : "text-foreground")}>
                      {pickLabel}
                    </span>
                    {leg.publishLine != null && leg.publishLine !== "" && (
                      <span className="text-muted-foreground text-[10px]">
                        {Number(leg.publishLine) > 0 ? `+${leg.publishLine}` : leg.publishLine}
                      </span>
                    )}
                    <span className="text-primary text-[10px]">{formatOdds(Number(leg.publishOdds))}</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground truncate">
                    {leg.league.toUpperCase()} {leg.market.toUpperCase()}
                    {matchup ? ` · ${matchup.awayAbbrev} @ ${matchup.homeAbbrev}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => onRemoveLeg(leg.id)}
                  className="shrink-0 text-muted-foreground hover:text-[#D32F2F] transition-colors p-0.5 rounded"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {parlay.hasCorrelation && (
        <div className="flex items-start gap-2 bg-[#FFC107]/10 border border-[#FFC107]/30 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="text-[#FFC107] mt-0.5 shrink-0" />
          <p className="text-[10px] text-[#FFC107] leading-relaxed">
            Two or more legs are from the same game. Correlated legs can inflate or deflate the true win probability.
          </p>
        </div>
      )}

      <div className={cn(
        "rounded-lg border p-4 flex flex-col gap-3",
        hasEnough ? "border-[#1A3066] bg-[#112454]/40" : "border-[#1A3066]/30 bg-[#112454]/20 opacity-50"
      )}>
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            Combined Odds
            <InfoTooltip content="The product of all leg decimal odds converted back to American format. For a $100 wager, this is what the book would offer." />
          </div>
          <div className="text-xl font-display font-bold text-[#4488FF]">
            {hasEnough ? formatOdds(parlay.americanOdds) : "—"}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#1A3066]">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center">
              Win Prob
              <InfoTooltip content="Product of each leg's calibrated model probability. Assumes legs are independent (no correlations)." />
            </div>
            <div className="font-bold text-sm text-foreground">
              {hasEnough ? `${(parlay.probability * 100).toFixed(1)}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center">
              EV / $100
              <InfoTooltip content="Expected value on a $100 stake. Positive means this parlay has a mathematical edge over the house based on our model probabilities." />
            </div>
            <div className={cn("font-bold text-sm", hasEnough ? (evPositive ? "text-[#388E3C]" : "text-[#D32F2F]") : "text-foreground")}>
              {hasEnough ? `${evPositive ? "+" : ""}$${parlay.ev.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center">
              Payout
              <InfoTooltip content="Total payout (including your $100 stake) if all legs win." />
            </div>
            <div className="font-bold text-sm text-foreground">
              {hasEnough ? `$${parlay.payout.toFixed(0)}` : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="text-[9px] text-muted-foreground/60 leading-relaxed text-center">
        For entertainment and informational use only. Not financial advice. Bet responsibly.
      </div>
    </Card>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

function HowParlaysWork({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg border border-[#1A3066] bg-[#0D1B3E] overflow-hidden mb-8">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left"
        onClick={onToggle}
      >
        <span className="text-xs font-bold font-display uppercase tracking-widest text-muted-foreground">
          How Parlays Work
        </span>
        {open ? (
          <ChevronUp size={14} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground border-t border-[#1A3066] pt-4">
          <div>
            <div className="text-[#FFC107] font-bold font-display mb-1 uppercase text-xs tracking-wider">
              All Legs Must Win
            </div>
            <p>
              A parlay requires every selected leg to win for the bet to pay out. One loss voids the whole ticket —
              but the combined odds are much higher than any single bet.
            </p>
          </div>
          <div>
            <div className="text-[#388E3C] font-bold font-display mb-1 uppercase text-xs tracking-wider">
              Positive EV Matters
            </div>
            <p>
              The <strong className="text-foreground">EV / $100</strong> figure tells you whether the parlay is
              mathematically worth placing. Positive EV means our model finds value in the combined odds. Size down
              vs. singles.
            </p>
          </div>
          <div>
            <div className="text-[#4488FF] font-bold font-display mb-1 uppercase text-xs tracking-wider">
              Correlation Warning
            </div>
            <p>
              Picking two legs from the same game (same-game parlay) creates correlation — outcomes aren't
              independent. Our model flags this so you can decide if the risk is worth it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ParlayGenerator() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [legCountTarget, setLegCountTarget] = useState(3);
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  const { data, isLoading } = useListPicks(
    { date: todayStr },
    { query: { queryKey: getListPicksQueryKey({ date: todayStr }) } }
  );
  const picks = useMemo(() => data?.picks || [], [data]);

  const selectedLegs = useMemo(
    () => picks.filter((p) => selectedIds.has(p.id)),
    [picks, selectedIds]
  );

  const filteredPicks = useMemo(() => {
    return picks
      .filter((p) => !leagueFilter || p.league === leagueFilter)
      .filter((p) => !marketFilter || p.market === marketFilter)
      .sort((a, b) => Number(b.rankScore) - Number(a.rankScore));
  }, [picks, leagueFilter, marketFilter]);

  const handleToggle = (pick: ScoredPick) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pick.id)) {
        next.delete(pick.id);
      } else if (next.size < 8) {
        next.add(pick.id);
      }
      return next;
    });
  };

  const handleAutoBuild = () => {
    const built = autoBuildParlay(picks, legCountTarget);
    setSelectedIds(new Set(built.map((p) => p.id)));
  };

  const handleRemoveLeg = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleClear = () => setSelectedIds(new Set());

  const legCounts = [2, 3, 4, 5, 6];
  const proLocked = (n: number) => n >= 5;

  return (
    <PageLayout>
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src="/logo-shield.png" alt="SportsMVP" className="h-12 w-auto drop-shadow-lg" />
          <div>
            <h1 className="text-4xl font-display text-foreground uppercase tracking-tight">
              Parlay Builder
            </h1>
            <p className="text-muted-foreground mt-1">
              {format(new Date(), "EEEE, MMMM do, yyyy")} · Combine today's top picks
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-[#0033A0] text-white border-transparent text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">
            MVP+ Feature
          </Badge>
          <div className="text-sm font-display font-bold uppercase tracking-widest text-[#4488FF]">
            Bet Like an MVP.
          </div>
        </div>
      </div>

      <HowParlaysWork open={howOpen} onToggle={() => setHowOpen((v) => !v)} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="flex flex-col gap-5">
          <Card className="bg-[#0D1B3E] border-[#1A3066] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={15} className="text-[#FFC107]" />
              <span className="text-xs font-bold font-display uppercase tracking-wider">Auto-Build</span>
              <span className="text-[10px] text-muted-foreground">— let the model pick your highest-EV parlay</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Legs:</span>
              {legCounts.map((n) => {
                const locked = proLocked(n);
                return (
                  <button
                    key={n}
                    onClick={() => !locked && setLegCountTarget(n)}
                    className={cn(
                      "relative flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold font-display border transition-all",
                      locked
                        ? "border-[#1A3066] text-muted-foreground/40 cursor-not-allowed bg-[#112454]/20"
                        : legCountTarget === n
                        ? "bg-[#0033A0] border-[#0033A0] text-white"
                        : "border-[#1A3066] text-muted-foreground hover:border-[#4488FF]/40 hover:text-foreground"
                    )}
                  >
                    {locked && <Lock size={9} className="shrink-0" />}
                    {n}-Leg
                    {locked && (
                      <span className="absolute -top-2 -right-1 text-[8px] bg-[#FFC107] text-[#060D1F] font-bold px-1 rounded-sm leading-tight">
                        PRO
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                onClick={handleAutoBuild}
                disabled={picks.length < legCountTarget}
                className={cn(
                  "ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-bold font-display border transition-all",
                  picks.length >= legCountTarget
                    ? "bg-[#FFC107] border-[#FFC107] text-[#060D1F] hover:bg-[#FFD740]"
                    : "border-[#1A3066] text-muted-foreground/40 cursor-not-allowed"
                )}
              >
                <Zap size={11} />
                Build Best {legCountTarget}-Leg Parlay
              </button>
            </div>
          </Card>

          <div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter:</span>
              {[null, "nba", "nhl"].map((league) => (
                <button
                  key={league ?? "all"}
                  onClick={() => setLeagueFilter(league)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-bold uppercase border transition-all",
                    leagueFilter === league
                      ? "bg-[#112454] border-[#4488FF]/50 text-foreground"
                      : "border-[#1A3066] text-muted-foreground hover:border-[#4488FF]/30 hover:text-foreground"
                  )}
                >
                  {league ?? "All Leagues"}
                </button>
              ))}
              <div className="w-px h-4 bg-[#1A3066] mx-1" />
              {[null, "moneyline", "spread", "total"].map((market) => (
                <button
                  key={market ?? "all"}
                  onClick={() => setMarketFilter(market)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-bold uppercase border transition-all",
                    marketFilter === market
                      ? "bg-[#112454] border-[#4488FF]/50 text-foreground"
                      : "border-[#1A3066] text-muted-foreground hover:border-[#4488FF]/30 hover:text-foreground"
                  )}
                >
                  {market ?? "All Markets"}
                </button>
              ))}
              <div className="ml-auto text-[10px] text-muted-foreground">
                {selectedIds.size}/8 selected
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg bg-card" />
                ))}
              </div>
            ) : filteredPicks.length === 0 ? (
              <div className="py-12 text-center border border-border rounded-xl bg-card/30">
                <img src="/logo-shield.png" alt="" className="h-10 w-auto mx-auto mb-3 opacity-20" />
                <p className="text-muted-foreground text-sm">No picks match the current filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredPicks.map((pick) => (
                  <ParlayPickRow
                    key={pick.id}
                    pick={pick}
                    selected={selectedIds.has(pick.id)}
                    onToggle={() => handleToggle(pick)}
                    disabled={selectedIds.size >= 8}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <ParlaySlip
            legs={selectedLegs}
            onRemoveLeg={handleRemoveLeg}
            onClear={handleClear}
          />
        </div>
      </div>
    </PageLayout>
  );
}
