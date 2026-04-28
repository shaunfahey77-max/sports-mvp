import { useState, useEffect } from "react";
import { format } from "date-fns";
import { X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  UserBet, BetResult, LogPickData, SPORTSBOOKS,
  loadBankroll, calcProfit, americanToDecimalBet,
} from "@/lib/betTracker";
import { halfKellyStake } from "@/lib/kellyCalc";

const LEAGUES = ["nba", "nhl", "mlb"];
const MARKETS = ["moneyline", "spread", "total", "parlay"];
const SPORTSBOOK_OPTIONS = SPORTSBOOKS;

interface AddBetPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (bet: Omit<UserBet, "id" | "createdAt">) => void;
  initialData?: LogPickData;
}

export function AddBetPanel({ isOpen, onClose, onSubmit, initialData }: AddBetPanelProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const bankroll = loadBankroll();

  const [date, setDate] = useState(today);
  const [league, setLeague] = useState(initialData?.league ?? "nba");
  const [matchup, setMatchup] = useState(initialData?.matchup ?? "");
  const [market, setMarket] = useState(initialData?.market ?? "moneyline");
  const [pick, setPick] = useState(initialData?.pick ?? "");
  const [oddsStr, setOddsStr] = useState(initialData?.odds ? String(initialData.odds) : "");
  const [stakeStr, setStakeStr] = useState("");
  const [sportsbook, setSportsbook] = useState("DraftKings");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (initialData) {
      setLeague(initialData.league ?? "nba");
      setMatchup(initialData.matchup ?? "");
      setMarket(initialData.market ?? "moneyline");
      setPick(initialData.pick ?? "");
      setOddsStr(initialData.odds ? String(initialData.odds) : "");
    }
  }, [initialData]);

  useEffect(() => {
    if (!isOpen) {
      setDate(today);
      setMatchup("");
      setPick("");
      setOddsStr("");
      setStakeStr("");
      setNotes("");
    }
  }, [isOpen]);

  const odds = parseFloat(oddsStr) || 0;
  const stake = parseFloat(stakeStr) || 0;
  const modelProb = initialData?.edge != null
    ? Math.min(0.95, (initialData.ev ?? 0) / (americanToDecimalBet(odds) - 1 || 1) + 1 / (americanToDecimalBet(odds) || 2))
    : null;
  const kellySuggest = odds && initialData?.edge && bankroll
    ? halfKellyStake(odds, 0.63, bankroll)
    : null;

  const potentialProfit = odds && stake ? calcProfit(stake, odds, 'win') : null;

  const canSubmit = matchup.trim() && pick.trim() && odds && stake > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      date,
      league,
      matchup: matchup.trim(),
      gameKey: initialData?.gameKey,
      market,
      pick: pick.trim(),
      odds,
      stake,
      sportsbook,
      result: 'pending',
      profit: null,
      notes: notes.trim() || undefined,
      sourcePickId: initialData?.sourcePickId,
      tier: initialData?.tier,
      edge: initialData?.edge,
      ev: initialData?.ev,
    });
    onClose();
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full max-w-md bg-[#0D1B3E] border-l border-[#1A3066] shadow-2xl flex flex-col transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A3066]">
          <div>
            <div className="text-[#FFC107] text-[10px] font-bold tracking-[0.25em] uppercase mb-1">Bet Tracker</div>
            <div className="text-xl text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Log a Bet</div>
            {initialData?.tier && (
              <div className="text-[10px] text-white/50 mt-1">
                Pre-filled from platform pick · Tier {initialData.tier}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-[#112454] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-[#112454] border border-[#1A3066] rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#FFC107]/60"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">League</label>
              <div className="flex gap-1.5">
                {LEAGUES.map(l => (
                  <button key={l} type="button" onClick={() => setLeague(l)}
                    className={cn("flex-1 py-2 rounded text-xs font-bold font-display uppercase border transition-all",
                      league === l
                        ? "bg-[#FFC107] border-[#FFC107] text-[#060D1F]"
                        : "border-[#1A3066] text-muted-foreground hover:border-[#FFC107]/40 hover:text-[#FFC107]"
                    )}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Matchup</label>
            <input
              type="text"
              value={matchup}
              onChange={e => setMatchup(e.target.value)}
              placeholder="e.g. MIA @ TOR"
              className="w-full bg-[#112454] border border-[#1A3066] rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#FFC107]/60"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Market</label>
            <div className="grid grid-cols-4 gap-1.5">
              {MARKETS.map(m => (
                <button key={m} type="button" onClick={() => setMarket(m)}
                  className={cn("py-2 rounded text-[10px] font-bold font-display uppercase border transition-all",
                    market === m
                      ? "bg-[#112454] border-[#FFC107]/60 text-[#FFC107]"
                      : "border-[#1A3066] text-muted-foreground hover:border-[#FFC107]/30 hover:text-white"
                  )}>
                  {m === 'moneyline' ? 'ML' : m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Pick</label>
            <input
              type="text"
              value={pick}
              onChange={e => setPick(e.target.value)}
              placeholder="e.g. UNDER 240.5 or MIA"
              className="w-full bg-[#112454] border border-[#1A3066] rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#FFC107]/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Odds (American)</label>
              <input
                type="number"
                value={oddsStr}
                onChange={e => setOddsStr(e.target.value)}
                placeholder="-110"
                className="w-full bg-[#112454] border border-[#1A3066] rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#FFC107]/60"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Stake ($)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={stakeStr}
                  onChange={e => setStakeStr(e.target.value)}
                  placeholder="50"
                  className="w-full bg-[#112454] border border-[#1A3066] rounded px-3 py-2 pl-7 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#FFC107]/60"
                />
              </div>
            </div>
          </div>

          {kellySuggest !== null && kellySuggest > 0 && (
            <div className="flex items-center gap-2 bg-[#FFC107]/10 border border-[#FFC107]/30 rounded-lg px-3 py-2.5">
              <Zap size={13} className="text-[#FFC107] shrink-0" />
              <div className="flex-1">
                <span className="text-[10px] text-[#FFC107] font-bold">Half-Kelly Suggests: </span>
                <button type="button" onClick={() => setStakeStr(String(kellySuggest))}
                  className="text-[10px] text-[#FFC107] underline underline-offset-2">
                  ${kellySuggest.toFixed(2)}
                </button>
                <span className="text-[10px] text-muted-foreground"> on ${bankroll.toLocaleString()} bankroll</span>
              </div>
            </div>
          )}

          {potentialProfit !== null && potentialProfit > 0 && (
            <div className="flex items-center justify-between bg-[#4ADE80]/10 border border-[#4ADE80]/30 rounded-lg px-3 py-2">
              <span className="text-[10px] text-muted-foreground">Potential profit if win</span>
              <span className="text-sm font-bold text-[#4ADE80]">+${potentialProfit.toFixed(2)}</span>
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Sportsbook</label>
            <div className="grid grid-cols-2 gap-1.5">
              {SPORTSBOOK_OPTIONS.map(sb => (
                <button key={sb} type="button" onClick={() => setSportsbook(sb)}
                  className={cn("py-2 rounded text-xs border transition-all text-left px-3",
                    sportsbook === sb
                      ? "bg-[#112454] border-[#FFC107]/60 text-[#FFC107] font-medium"
                      : "border-[#1A3066] text-muted-foreground hover:border-[#FFC107]/30 hover:text-white"
                  )}>
                  {sb}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this bet..."
              rows={2}
              className="w-full bg-[#112454] border border-[#1A3066] rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#FFC107]/60 resize-none"
            />
          </div>
        </form>

        <div className="px-5 py-4 border-t border-[#1A3066]">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "w-full py-3 rounded font-display font-bold text-sm uppercase tracking-wider transition-all",
              canSubmit
                ? "bg-[#FFC107] text-[#060D1F] hover:bg-[#FFD740]"
                : "bg-[#112454] text-muted-foreground/40 cursor-not-allowed"
            )}
          >
            Log Bet
          </button>
        </div>
      </div>
    </>
  );
}
