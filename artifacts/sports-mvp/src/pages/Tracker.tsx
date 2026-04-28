import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Plus, Trash2, TrendingUp, TrendingDown, BookOpen } from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AddBetPanel } from "@/components/AddBetPanel";
import { cn } from "@/lib/utils";
import {
  UserBet, BetResult, LogPickData,
  loadBets, addBet, updateBetResult, deleteBet,
  loadBankroll, saveBankroll, calcSummary, calcPnLCurve,
  consumePrefillPick,
} from "@/lib/betTracker";

// ─── One-time seeder for April 7 DraftKings bets ──────────────────────────────

const SEED_KEY = "sportsmvp_seed_apr7_2026";

function seedApril7Bets() {
  if (localStorage.getItem(SEED_KEY)) return;
  const apr7: Omit<UserBet, "id" | "createdAt">[] = [
    {
      date: "2026-04-07",
      league: "nba",
      matchup: "2-Leg Parlay",
      market: "parlay",
      pick: "UNDER 240.5 (MIA@TOR) + OVER 220.5 (MIL@BKN)",
      odds: 276,
      stake: 10,
      sportsbook: "DraftKings",
      result: "pending",
      profit: null,
      notes: "+20% Parlay Boost applied",
    },
    {
      date: "2026-04-07",
      league: "nhl",
      matchup: "3-Leg Parlay",
      market: "parlay",
      pick: "UNDER 6.5 (BOS@CAR) + OVER 6.5 (TB@OTT) + OVER 5.5 (PHI@NJ)",
      odds: 614,
      stake: 20,
      sportsbook: "DraftKings",
      result: "pending",
      profit: null,
      notes: "Boosted +20% — original +511",
    },
  ];
  apr7.forEach((bet) => addBet(bet));
  localStorage.setItem(SEED_KEY, "1");
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useBets() {
  const [bets, setBets] = useState<UserBet[]>(() => {
    seedApril7Bets();
    return loadBets();
  });
  const add = useCallback((data: Omit<UserBet, "id" | "createdAt">) => {
    addBet(data);
    setBets(loadBets());
  }, []);
  const markResult = useCallback((id: string, result: BetResult) => {
    setBets(updateBetResult(id, result));
  }, []);
  const remove = useCallback((id: string) => {
    setBets(deleteBet(id));
  }, []);
  return { bets, add, markResult, remove };
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, positive, tooltip }: {
  label: string; value: string; sub?: string; positive?: boolean | null; tooltip?: string;
}) {
  return (
    <Card className="bg-[#0D1B3E] border-[#1A3066] px-4 py-3 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className={cn("text-xl font-display font-bold",
        positive === true ? "text-[#4ADE80]" : positive === false ? "text-[#F87171]" : "text-foreground"
      )}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

// ─── P&L Chart ────────────────────────────────────────────────────────────────

function PnLChart({ bets }: { bets: UserBet[] }) {
  const data = useMemo(() => calcPnLCurve(bets), [bets]);
  const final = data[data.length - 1]?.cumPnL ?? 0;
  const isPositive = final >= 0;

  if (data.length <= 1) {
    return (
      <Card className="bg-[#0D1B3E] border-[#1A3066] p-6 flex items-center justify-center h-44">
        <div className="text-center">
          <TrendingUp size={28} className="text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Settle your first bet to see your P&amp;L chart</p>
        </div>
      </Card>
    );
  }

  const color = isPositive ? "#4ADE80" : "#F87171";

  return (
    <Card className="bg-[#0D1B3E] border-[#1A3066] p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs font-bold font-display uppercase tracking-wider">P&amp;L Curve</div>
          <div className="text-[10px] text-muted-foreground">Cumulative profit / loss per settled bet</div>
        </div>
        <div className={cn("text-lg font-display font-bold", isPositive ? "text-[#4ADE80]" : "text-[#F87171]")}>
          {final >= 0 ? "+" : ""}${final.toFixed(2)}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A3066" vertical={false} />
          <XAxis dataKey="index" hide />
          <YAxis
            tickFormatter={v => `$${v}`}
            tick={{ fontSize: 10, fill: '#8899CC' }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <ReferenceLine y={0} stroke="#1A3066" strokeWidth={1.5} />
          <Tooltip
            contentStyle={{ background: '#0D1B3E', border: '1px solid #1A3066', borderRadius: 8, fontSize: 11 }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.matchup ?? ''}
            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative P&L']}
          />
          <Area
            type="monotone"
            dataKey="cumPnL"
            stroke={color}
            strokeWidth={2}
            fill="url(#pnlGrad)"
            dot={false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ─── Bet Card ─────────────────────────────────────────────────────────────────

const RESULT_COLORS: Record<BetResult, string> = {
  pending: 'text-muted-foreground',
  win: 'text-[#4ADE80]',
  loss: 'text-[#F87171]',
  push: 'text-[#FFC107]',
};
const RESULT_BG: Record<BetResult, string> = {
  pending: 'border-[#1A3066]',
  win: 'border-[#4ADE80]/40 bg-[#4ADE80]/5',
  loss: 'border-[#F87171]/40 bg-[#F87171]/5',
  push: 'border-[#FFC107]/40 bg-[#FFC107]/5',
};

function BetCard({ bet, onMarkResult, onDelete }: {
  bet: UserBet;
  onMarkResult: (id: string, result: BetResult) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const profitStr = bet.profit != null
    ? `${bet.profit >= 0 ? "+" : ""}$${bet.profit.toFixed(2)}`
    : null;

  return (
    <Card className={cn("p-4 border flex flex-col gap-3 transition-colors", RESULT_BG[bet.result])}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 uppercase border-[#1A3066] text-muted-foreground">
            {bet.league.toUpperCase()}
          </Badge>
          <Badge className="text-[9px] px-1.5 py-0 uppercase bg-[#112454] text-muted-foreground border-transparent">
            {bet.market}
          </Badge>
          {bet.tier && (
            <Badge className="text-[9px] px-1.5 py-0 bg-[#FFC107] text-[#060D1F] border-transparent font-bold">
              {bet.tier}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("text-xs font-bold font-display uppercase", RESULT_COLORS[bet.result])}>
            {bet.result}
          </span>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} className="text-muted-foreground/40 hover:text-[#F87171] transition-colors p-0.5">
              <Trash2 size={12} />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => { onDelete(bet.id); setConfirming(false); }}
                className="text-[9px] text-[#F87171] border border-[#F87171]/40 rounded px-1.5 py-0.5 hover:bg-[#F87171]/10">
                Delete
              </button>
              <button onClick={() => setConfirming(false)} className="text-[9px] text-muted-foreground border border-[#1A3066] rounded px-1.5 py-0.5">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="font-display font-bold text-sm text-foreground">{bet.matchup}</div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
          <span className="text-foreground/80">{bet.pick}</span>
          <span>·</span>
          <span>{bet.odds > 0 ? `+${bet.odds}` : bet.odds}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <span>{bet.sportsbook}</span>
          <span>·</span>
          <span>${bet.stake.toFixed(0)} stake</span>
          {bet.edge && <span>· Edge {(bet.edge * 100).toFixed(1)}%</span>}
        </div>
        {profitStr && (
          <span className={cn("font-bold font-display text-sm", bet.profit! >= 0 ? "text-[#4ADE80]" : "text-[#F87171]")}>
            {profitStr}
          </span>
        )}
      </div>

      {bet.result === 'pending' && (
        <div className="flex gap-1.5 pt-1 border-t border-[#1A3066]">
          {(['win', 'loss', 'push'] as BetResult[]).map(r => (
            <button key={r} onClick={() => onMarkResult(bet.id, r)}
              className={cn(
                "flex-1 py-1.5 rounded text-[10px] font-bold font-display uppercase border transition-all",
                r === 'win' ? "border-[#4ADE80]/40 text-[#4ADE80] hover:bg-[#4ADE80]/10"
                  : r === 'loss' ? "border-[#F87171]/40 text-[#F87171] hover:bg-[#F87171]/10"
                  : "border-[#FFC107]/40 text-[#FFC107] hover:bg-[#FFC107]/10"
              )}>
              {r}
            </button>
          ))}
        </div>
      )}

      {bet.notes && (
        <div className="text-[10px] text-muted-foreground italic border-t border-[#1A3066] pt-2">
          {bet.notes}
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const RESULT_FILTERS: { label: string; value: BetResult | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Win', value: 'win' },
  { label: 'Loss', value: 'loss' },
  { label: 'Push', value: 'push' },
];

export function Tracker() {
  const { bets, add, markResult, remove } = useBets();
  const [panelOpen, setPanelOpen] = useState(false);
  const [initialData, setInitialData] = useState<LogPickData | undefined>(undefined);

  // Consume any prefill handoff (e.g. user clicked "Add to Tracker" on a
  // pending pick from the History page). Runs once on mount; the helper
  // self-clears the sessionStorage key so a manual refresh won't re-open
  // the panel with stale data. The ref guard makes consumption idempotent
  // under React StrictMode's intentional double-effect-invocation in dev.
  const prefillConsumedRef = useRef(false);
  useEffect(() => {
    if (prefillConsumedRef.current) return;
    prefillConsumedRef.current = true;
    const prefill = consumePrefillPick();
    if (prefill) {
      setInitialData(prefill);
      setPanelOpen(true);
    }
  }, []);

  const [bankroll, setBankrollState] = useState(() => loadBankroll());
  const [bankrollEditing, setBankrollEditing] = useState(false);
  const [bankrollStr, setBankrollStr] = useState(() => String(loadBankroll()));

  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<BetResult | 'all'>('all');

  const summary = useMemo(() => calcSummary(bets), [bets]);

  const filteredBets = useMemo(() => {
    return bets
      .filter(b => !leagueFilter || b.league === leagueFilter)
      .filter(b => !marketFilter || b.market === marketFilter)
      .filter(b => resultFilter === 'all' || b.result === resultFilter);
  }, [bets, leagueFilter, marketFilter, resultFilter]);

  function handleBankrollSave() {
    const val = parseFloat(bankrollStr);
    if (!isNaN(val) && val > 0) {
      setBankrollState(val);
      saveBankroll(val);
    }
    setBankrollEditing(false);
  }

  const { totalProfit, winRate, roi, totalStaked, wins, losses, pushes, pending, streak } = summary;

  const streakDisplay = streak.type
    ? `${streak.count}${streak.type === 'win' ? 'W' : 'L'}`
    : '—';

  return (
    <PageLayout
      title="Bet Tracker"
      subtitle={`${format(new Date(), "EEEE, MMMM do, yyyy")} · Your personal betting ledger`}
      tagline="MVP+ FEATURE"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Bankroll:</span>
          {bankrollEditing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="number"
                value={bankrollStr}
                onChange={e => setBankrollStr(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBankrollSave()}
                className="w-28 bg-[#112454] border border-[#FFC107]/40 rounded px-2 py-1 text-sm text-foreground focus:outline-none"
                autoFocus
              />
              <button onClick={handleBankrollSave}
                className="text-[10px] bg-[#FFC107] text-[#060D1F] font-bold px-2 py-1 rounded">
                Save
              </button>
            </div>
          ) : (
            <button onClick={() => setBankrollEditing(true)}
              className="text-sm font-bold text-foreground border-b border-dashed border-[#1A3066] hover:border-[#FFC107]/40 transition-colors">
              ${bankroll.toLocaleString()}
            </button>
          )}
          <InfoTooltip content="Your total betting bankroll. Used to calculate Half-Kelly stake suggestions when logging platform picks." />
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#FFC107] text-[#060D1F] font-bold font-display text-sm uppercase rounded hover:bg-[#FFD740] transition-colors"
        >
          <Plus size={14} />
          Log a Bet
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          label="Total P&L"
          value={`${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}`}
          sub={`${summary.settledBets} settled`}
          positive={totalProfit > 0 ? true : totalProfit < 0 ? false : null}
          tooltip="Total profit or loss across all settled bets."
        />
        <StatCard
          label="Win Rate"
          value={summary.settledBets > 0 ? `${(winRate * 100).toFixed(1)}%` : '—'}
          sub={`${wins}W ${losses}L ${pushes}P`}
          positive={winRate > 0.5 ? true : winRate < 0.5 ? false : null}
          tooltip="Win rate excluding pushes. 52.4% is break-even at -110 juice."
        />
        <StatCard
          label="ROI"
          value={totalStaked > 0 ? `${roi >= 0 ? '+' : ''}${(roi * 100).toFixed(1)}%` : '—'}
          sub={`on $${totalStaked.toFixed(0)} staked`}
          positive={roi > 0 ? true : roi < 0 ? false : null}
          tooltip="Return on investment — total profit divided by total amount wagered."
        />
        <StatCard
          label="Total Wagered"
          value={`$${totalStaked.toFixed(0)}`}
          sub={`${summary.totalBets} bets`}
          tooltip="Sum of all bet stakes logged."
        />
        <StatCard
          label="Pending"
          value={String(pending)}
          sub={pending === 1 ? '1 open bet' : `${pending} open bets`}
          tooltip="Bets waiting for a result to be marked."
        />
        <StatCard
          label="Streak"
          value={streakDisplay}
          sub={streak.type ? `Current ${streak.type} streak` : 'No streak'}
          positive={streak.type === 'win' ? true : streak.type === 'loss' ? false : null}
          tooltip="Your current consecutive win or loss streak (pushes excluded)."
        />
      </div>

      <div className="mb-6">
        <PnLChart bets={bets} />
      </div>

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <BookOpen size={13} className="text-muted-foreground" />
        <span className="text-xs font-bold font-display uppercase tracking-wider text-muted-foreground mr-2">
          Ledger
        </span>
        {[null, 'nba', 'nhl', 'mlb'].map(l => (
          <button key={l ?? 'all'} onClick={() => setLeagueFilter(l)}
            className={cn("px-2.5 py-1 rounded text-[10px] font-bold uppercase border transition-all",
              leagueFilter === l
                ? "bg-[#112454] border-[#FFC107]/50 text-foreground"
                : "border-[#1A3066] text-muted-foreground hover:border-[#FFC107]/30"
            )}>
            {l ?? 'All'}
          </button>
        ))}
        <div className="w-px h-4 bg-[#1A3066] mx-1" />
        {[null, 'moneyline', 'spread', 'total', 'parlay'].map(m => (
          <button key={m ?? 'all'} onClick={() => setMarketFilter(m)}
            className={cn("px-2.5 py-1 rounded text-[10px] font-bold uppercase border transition-all",
              marketFilter === m
                ? "bg-[#112454] border-[#FFC107]/50 text-foreground"
                : "border-[#1A3066] text-muted-foreground hover:border-[#FFC107]/30"
            )}>
            {m ?? 'All Markets'}
          </button>
        ))}
        <div className="w-px h-4 bg-[#1A3066] mx-1" />
        {RESULT_FILTERS.map(f => (
          <button key={f.value} onClick={() => setResultFilter(f.value)}
            className={cn("px-2.5 py-1 rounded text-[10px] font-bold uppercase border transition-all",
              resultFilter === f.value
                ? "bg-[#112454] border-[#FFC107]/50 text-foreground"
                : "border-[#1A3066] text-muted-foreground hover:border-[#FFC107]/30"
            )}>
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">{filteredBets.length} bets</span>
      </div>

      {filteredBets.length === 0 ? (
        <div className="py-20 text-center border border-border rounded-xl bg-card/30">
          <img src="/logo-shield.png" alt="" className="h-14 w-auto mx-auto mb-4 opacity-20" />
          <h3 className="text-xl font-display font-bold mb-2">No Bets Logged</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Hit "Log a Bet" or use the "Log This Pick" button on any pick card.
          </p>
          <button
            onClick={() => setPanelOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFC107] text-[#060D1F] font-bold font-display text-sm uppercase rounded hover:bg-[#FFD740] transition-colors"
          >
            <Plus size={14} />
            Log Your First Bet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBets.map(bet => (
            <BetCard key={bet.id} bet={bet} onMarkResult={markResult} onDelete={remove} />
          ))}
        </div>
      )}

      <AddBetPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSubmit={add}
        initialData={initialData}
      />
    </PageLayout>
  );
}
