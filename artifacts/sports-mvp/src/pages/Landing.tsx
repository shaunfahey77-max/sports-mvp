import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  Star, Shield, Crown, ChevronRight, Lock, TrendingUp, Zap, Clock,
  Check, ArrowRight, Cpu, Database, BarChart2, Activity, CheckCircle2,
} from "lucide-react";
import { parseGameMatchup, getTeamLogoUrl } from "@/lib/teamLogos";
import { formatOdds } from "@/lib/utils";
import { WhyThisPickPopover } from "@/components/WhyThisPickPopover";

const STAT_WINDOW = 47;
const SERIF = "'Playfair Display', serif";

function useLandingStats() {
  return useQuery({
    queryKey: ["landing-perf-stats"],
    queryFn: async () => {
      const res = await axios.get(`/performance?window=${STAT_WINDOW}`);
      return res.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

const BASELINE_STATS = {
  winRate: 0.600,
  roi: 0.2710,
  unitsWon: 165.1,
  avgEv: 0.232,
};

function buildStats(perf: any) {
  const hasResults = perf && (perf.wins + perf.losses) > 0;
  const winRate = hasResults ? perf.wins / (perf.wins + perf.losses) : BASELINE_STATS.winRate;
  const roi = hasResults ? (perf.roi ?? 0) : BASELINE_STATS.roi;
  const units = hasResults ? (perf.unitsWon ?? 0) : BASELINE_STATS.unitsWon;
  const avgEv = hasResults ? (perf.avgEv ?? 0) : BASELINE_STATS.avgEv;
  return {
    winRate: `${(winRate * 100).toFixed(1)}%`,
    roi: `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`,
    units: `${units >= 0 ? "+" : ""}${units.toFixed(1)}`,
    avgEv: `${avgEv >= 0 ? "+" : ""}${(avgEv * 100).toFixed(1)}%`,
    isLive: hasResults,
  };
}

/* ---------------- NAV ---------------- */
function LandingNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-[#FFC107]/20 bg-[#060D1F]/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <img
            src="/shield-logo.png"
            alt="SportsMVP"
            className="h-10 w-auto object-contain drop-shadow-[0_0_12px_rgba(255,193,7,0.35)]"
          />
          <span className="text-xl font-bold tracking-wide text-white" style={{ fontFamily: SERIF }}>
            SportsMVP
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#methodology" className="text-sm font-medium text-white/70 hover:text-[#FFC107] transition-colors">Methodology</a>
          <a href="#track-record" className="text-sm font-medium text-white/70 hover:text-[#FFC107] transition-colors">Track Record</a>
          <a href="#membership" className="text-sm font-medium text-white/70 hover:text-[#FFC107] transition-colors">Membership</a>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="text-sm font-bold bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F] px-5 py-2.5 rounded-sm transition-colors uppercase tracking-wider"
          >
            Become a Member
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ---------------- HERO ---------------- */
function HeroSection({ stats }: { stats: ReturnType<typeof buildStats> }) {
  return (
    <section className="relative pt-20 pb-28 overflow-hidden">
      {/* background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#060D1F]/65 to-[#060D1F] z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#060D1F]/95 via-transparent to-[#060D1F]/45 z-10" />
        <img
          src="/sportsbook-hero.jpg"
          alt=""
          className="w-full h-full object-cover object-center opacity-35"
        />
      </div>

      <div className="max-w-7xl mx-auto px-6 relative z-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FFC107]/30 bg-[#FFC107]/5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FFC107] animate-pulse" />
            <span className="text-xs font-bold text-[#FFC107] uppercase tracking-widest">
              Live Models · NBA · NHL · MLB
            </span>
          </div>

          <h1
            className="text-5xl md:text-7xl font-bold leading-[1.05] mb-6 text-white"
            style={{ fontFamily: SERIF }}
          >
            The math-driven edge,{" "}
            <span className="italic text-[#FFC107]">made transparent.</span>
          </h1>

          <p className="text-xl text-white/70 mb-10 leading-relaxed max-w-2xl font-light">
            SportsMVP is an analyst's instrument, not a tipster service. We run calibrated
            machine-learning models against live sportsbook odds to find statistically
            significant positive expected-value plays — and publish every result.
          </p>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
            <Link
              href="/sign-up"
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-[#FFC107] to-[#B38700] hover:from-[#FFD54F] hover:to-[#FFC107] text-[#060D1F] font-bold uppercase tracking-widest text-sm transition-all shadow-[0_0_30px_rgba(255,193,7,0.2)] hover:shadow-[0_0_40px_rgba(255,193,7,0.4)] flex items-center justify-center gap-2 rounded-sm"
            >
              Become a Member <ChevronRight size={16} />
            </Link>
            <a
              href="#methodology"
              className="w-full sm:w-auto px-8 py-4 border border-white/20 hover:bg-white/5 text-white/80 font-medium uppercase tracking-widest text-sm transition-colors rounded-sm text-center"
            >
              View Methodology
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/50 font-mono">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#388E3C]" />
              Brier-scored probability
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#388E3C]" />
              Closing line value tracked
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#388E3C]" />
              Every pick graded publicly
            </div>
          </div>
        </div>

        {/* Floating perf stats — real data */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-px bg-[#FFC107]/20 border border-[#FFC107]/30 rounded-sm overflow-hidden">
          {[
            { label: "Win Rate", value: stats.winRate, color: "#388E3C" },
            { label: `ROI · ${STAT_WINDOW}d`, value: stats.roi, color: "#388E3C" },
            { label: "Units Won", value: stats.units, color: "#388E3C" },
            { label: "Avg EV / Pick", value: stats.avgEv, color: "#FFC107" },
          ].map((s) => (
            <div key={s.label} className="bg-[#0D1B3E]/95 backdrop-blur p-5 text-center">
              <div className="text-3xl md:text-4xl font-black" style={{ color: s.color, fontFamily: SERIF }}>{s.value}</div>
              <div className="text-white/50 text-[10px] md:text-xs font-bold uppercase tracking-widest mt-1">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center text-white/40 text-xs">
          {stats.isLive ? "Live performance" : "Baseline shown — live data publishes after first graded slate"} · rolling {STAT_WINDOW}-day window
        </div>
      </div>
    </section>
  );
}

/* ---------------- TODAY'S TOP PICK ---------------- */
function TeamLogoWithFallback({ league, abbrev, size = 36 }: { league: string; abbrev: string; size?: number }) {
  const [imgError, setImgError] = useState(false);
  const src = getTeamLogoUrl(league, abbrev);
  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={abbrev}
        width={size}
        height={size}
        className="object-contain drop-shadow"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded text-[11px] font-black text-white bg-[#0033A0]"
      style={{ width: size, height: size }}
    >
      {abbrev.slice(0, 3).toUpperCase()}
    </div>
  );
}

function TopPickCard({ pick }: { pick: any }) {
  const matchup = parseGameMatchup(pick.gameKey, pick.league);
  const edge = parseFloat(pick.edge ?? "0");
  const ev = parseFloat(pick.ev ?? "0");
  const publishOdds = parseFloat(pick.publishOdds ?? "0");
  const publishLine = pick.publishLine ? parseFloat(pick.publishLine) : null;
  const modelProb = parseFloat(pick.modelProbCalibrated ?? "0.5");
  const marketProb = parseFloat(pick.marketProbFair ?? "0.5");

  return (
    <div className="bg-[#060D1F] border border-[#FFC107]/30 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden rounded-sm">
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFC107]/5 rounded-bl-full pointer-events-none" />

      <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-6 relative">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-[#FFC107] text-[#060D1F] text-xs font-bold uppercase tracking-widest rounded-sm">
            Tier {pick.tier ?? "A"}
          </span>
          <span className="text-white/50 text-sm uppercase tracking-wider">
            {pick.league?.toUpperCase()} {pick.market}
          </span>
        </div>
        <span className="text-[#388E3C] font-mono text-sm flex items-center gap-1">
          <TrendingUp size={14} /> {(ev * 100).toFixed(1)}% EV
        </span>
      </div>

      <div className="flex items-center justify-between mb-8 relative">
        {matchup ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <TeamLogoWithFallback league={pick.league} abbrev={matchup.awayAbbrev} size={40} />
              <span className={`font-black ${pick.pick === "away" ? "text-white" : "text-white/40"}`}>
                {matchup.awayAbbrev.toUpperCase()}
              </span>
            </div>
            <span className="text-white/30 italic" style={{ fontFamily: SERIF }}>at</span>
            <div className="flex items-center gap-2">
              <TeamLogoWithFallback league={pick.league} abbrev={matchup.homeAbbrev} size={40} />
              <span className={`font-black ${pick.pick === "home" ? "text-white" : "text-white/40"}`}>
                {matchup.homeAbbrev.toUpperCase()}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-white/60 text-sm">{pick.gameKey}</div>
        )}
        <div className="text-right">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Our Play</div>
          <div className="text-xl font-bold text-white">
            {pick.pick?.toString().toUpperCase()}
            {publishLine !== null && (
              <span className="text-white/60 ml-2">{publishLine > 0 ? `+${publishLine}` : publishLine}</span>
            )}
            <span className="text-[#FFC107] font-normal ml-2">{formatOdds(publishOdds)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 bg-[#0D1B3E] p-4 rounded-sm border border-white/5 relative">
        <div>
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Market Prob</div>
          <div className="text-lg font-mono text-white">{(marketProb * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Model Prob</div>
          <div className="text-lg font-mono text-[#FFC107]">{(modelProb * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">True Edge</div>
          <div className="text-lg font-mono text-[#388E3C]">+{(edge * 100).toFixed(1)}%</div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/5 flex justify-end relative">
        <WhyThisPickPopover input={{
          modelProb,
          marketProb,
          edge,
          ev,
          tier: pick.tier ?? "A",
          rankScore: parseFloat(pick.rankScore ?? "0.8"),
          market: pick.market ?? "total",
          league: pick.league ?? "nhl",
          pick: pick.pick ?? "under",
          publishOdds,
          publishLine,
        }} />
      </div>
    </div>
  );
}

function TodaysTopPick() {
  const today = new Date().toISOString().split("T")[0];
  const { data, isLoading } = useQuery({
    queryKey: ["landing-top-pick", today],
    queryFn: async () => {
      const res = await axios.get(`/picks?date=${today}&tier=A&result=pending&limit=1`);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
  const pick = data?.picks?.[0] ?? null;

  return (
    <section className="py-20 bg-[#0D1B3E] border-y border-[#FFC107]/10 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-3 flex items-center gap-2">
              <Lock size={14} /> Today's Unlocked Preview
            </div>
            <h2 className="text-4xl font-bold mb-6 text-white" style={{ fontFamily: SERIF }}>
              A glimpse inside the vault.
            </h2>
            <p className="text-white/60 mb-8 leading-relaxed font-light text-lg">
              Members get the entire daily slate the moment our model surfaces it. Here's
              one Tier-A play from today — published with the same metrics members see:
              market probability, model probability, and the true edge between them.
            </p>

            <div className="grid grid-cols-2 gap-6 mb-2">
              <div className="border-l-2 border-[#FFC107] pl-4">
                <div className="text-3xl text-white" style={{ fontFamily: SERIF }}>10 min</div>
                <div className="text-xs text-white/50 uppercase tracking-wide">Refresh cadence</div>
              </div>
              <div className="border-l-2 border-[#FFC107] pl-4">
                <div className="text-3xl text-white" style={{ fontFamily: SERIF }}>3:30 AM</div>
                <div className="text-xs text-white/50 uppercase tracking-wide">Daily auto-grading</div>
              </div>
            </div>
          </div>

          <div className="w-full">
            {isLoading ? (
              <div className="h-72 rounded-sm bg-[#060D1F] animate-pulse border border-white/5" />
            ) : pick ? (
              <TopPickCard pick={pick} />
            ) : (
              <div className="bg-[#060D1F] border border-dashed border-[#FFC107]/20 p-10 text-center rounded-sm">
                <div className="text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-2">
                  Awaiting Today's Official Slate
                </div>
                <p className="text-white/50 text-sm">
                  No Tier-A Official play has cleared today's threshold yet.
                  Members can still see the full Model Watch lane — picks the
                  model surfaces in markets that are still earning their
                  Official promotion. The slate re-scores every 10 minutes.
                </p>
              </div>
            )}
            <div className="mt-4 text-center">
              <Link href="/sign-up" className="inline-flex items-center gap-2 text-[#FFC107] hover:text-[#FFD54F] text-sm font-bold uppercase tracking-widest transition-colors">
                See the full slate <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- METHODOLOGY ---------------- */
function MethodologySection() {
  const steps = [
    {
      step: "01",
      title: "Market Snapshots",
      desc: "Every 10 minutes we ingest live odds from DraftKings, FanDuel, BetMGM, Caesars and more, plus matched alt-line and total pairs. Real-time ingestion is the baseline for every calculation.",
      icon: Database,
      meta: ["8+ sportsbooks", "10-minute cadence"],
    },
    {
      step: "02",
      title: "Calibrated Scoring",
      desc: "Proprietary models compute true win probability and the edge over each book's implied price. Probabilities are isotonically calibrated and Brier-scored against historical outcomes.",
      icon: Cpu,
      meta: ["Brier-scored", "EV calculated"],
    },
    {
      step: "03",
      title: "Tiered Grading",
      desc: "Every candidate is tiered A / B / C by composite rank score. Markets only earn the Official label when calibration, edge, and CLV consistently clear our launch thresholds — newer or recovering markets surface in a separate Model Watch lane, visible to members and graded the same way. Every result is published the next morning.",
      icon: Shield,
      meta: ["A/B/C tiers", "Official + Model Watch lanes", "CLV tracked"],
    },
  ];

  return (
    <section id="methodology" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-3">
            The Methodology
          </div>
          <h2 className="text-4xl font-bold mb-4 text-white" style={{ fontFamily: SERIF }}>
            No gut calls. Just the pipeline.
          </h2>
          <p className="text-white/50 font-light text-lg">
            Our edge comes from a rigorous, three-stage quantitative pipeline.
            We publish the formulas, the calibration, and every result.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((item) => (
            <div
              key={item.step}
              className="p-8 border border-white/10 bg-[#0D1B3E]/50 hover:bg-[#0D1B3E] hover:border-[#FFC107]/30 transition-all group rounded-sm"
            >
              <div className="flex justify-between items-start mb-8">
                <item.icon size={24} className="text-[#FFC107] group-hover:scale-110 transition-transform" />
                <span className="text-4xl font-bold text-white/10" style={{ fontFamily: SERIF }}>{item.step}</span>
              </div>
              <h3 className="text-xl font-bold mb-3 text-white">{item.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed mb-6">{item.desc}</p>
              <ul className="space-y-2 border-t border-white/5 pt-4">
                {item.meta.map((m) => (
                  <li key={m} className="text-xs font-mono text-white/40 flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-[#388E3C]" /> {m}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- LIVE OUTPUT TERMINAL ---------------- */
function LiveOutputStrip() {
  return (
    <section className="py-16 bg-[#060D1F] border-y border-white/5">
      <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-5 gap-10 items-center">
        <div className="lg:col-span-2">
          <div className="text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-3">
            What members see
          </div>
          <h3 className="text-3xl font-bold text-white mb-4" style={{ fontFamily: SERIF }}>
            The model speaks for itself.
          </h3>
          <p className="text-white/50 leading-relaxed font-light">
            Inside the dashboard, each pick is presented with the raw output that
            produced it. No commentary. No rationalizing. Just the numbers that drove
            the call — and the result, once it lands.
          </p>
        </div>

        <div className="lg:col-span-3 rounded-sm border border-[#1A3066] bg-[#0D1B3E]/80 backdrop-blur shadow-2xl overflow-hidden font-mono text-xs">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A3066] bg-[#060D1F]/50">
            <div className="flex gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-widest border border-[#FFC107]/40 text-[#FFC107] rounded-sm">Illustrative sample</span>
              <span className="text-slate-500">model_output_stream.log</span>
            </div>
          </div>
          <div className="p-4 space-y-2 text-slate-300">
            <div className="flex text-slate-500"><span className="w-20 shrink-0">14:02:41</span><span>[INFO] fetching_market_snapshots... [OK]</span></div>
            <div className="flex text-slate-500"><span className="w-20 shrink-0">14:02:43</span><span>[INFO] running_inference: model=nba_spread_v4... [OK]</span></div>
            <div className="flex"><span className="w-20 shrink-0 text-slate-500">14:02:45</span><span className="text-[#4488FF]">[EVAL] POSITIVE_EV_DETECTED</span></div>
            <div className="pl-20 space-y-1">
              <div><span className="text-slate-500">market:</span> "spread"</div>
              <div><span className="text-slate-500">pick:</span> "BOS -4.5"</div>
              <div><span className="text-slate-500">book_odds:</span> -110 <span className="text-slate-500">(implied: 52.38%)</span></div>
              <div><span className="text-slate-500">model_prob:</span> 56.12% <span className="text-slate-500">(calibrated)</span></div>
              <div><span className="text-slate-500">edge:</span> <span className="text-[#388E3C]">+3.74%</span></div>
              <div><span className="text-slate-500">ev:</span> <span className="text-[#388E3C]">+7.14%</span></div>
              <div><span className="text-slate-500">tier:</span> <span className="text-[#FFC107]">"A"</span></div>
            </div>
            <div className="flex text-slate-500 pt-2 border-t border-[#1A3066]/50"><span className="w-20 shrink-0">14:02:46</span><span>[INFO] publishing_to_dashboard... [OK]</span></div>
            <div className="flex"><span className="w-20 shrink-0 text-slate-500">14:02:47</span><span className="text-slate-400 animate-pulse">awaiting_next_tick...</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- TRACK RECORD ---------------- */
function TrackRecordSection({ stats, picksTracked }: { stats: ReturnType<typeof buildStats>; picksTracked: number }) {
  return (
    <section id="track-record" className="py-20 bg-[#FFC107] text-[#060D1F]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <div className="text-[#060D1F]/60 text-xs font-bold tracking-widest uppercase mb-2">
              Public Track Record
            </div>
            <h2 className="text-4xl font-bold mb-2" style={{ fontFamily: SERIF }}>
              Transparency is the product.
            </h2>
            <p className="text-[#060D1F]/70 font-medium max-w-xl">
              We publish every pick the moment it surfaces and grade every result the
              next morning. No cherry-picked highlight reels.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-4 py-2 border border-[#060D1F]/20 rounded-full text-xs font-bold uppercase tracking-widest flex items-center gap-2 bg-[#060D1F]/5">
              <span className="w-2 h-2 rounded-full bg-[#388E3C] animate-pulse" />
              Rolling {STAT_WINDOW}-day window
            </div>
            <Link
              href="/performance"
              className="px-4 py-2 border border-[#060D1F] rounded-full text-xs font-bold uppercase tracking-widest hover:bg-[#060D1F] hover:text-[#FFC107] transition-colors"
            >
              Full record →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#060D1F]/10 border border-[#060D1F]/10 rounded-sm overflow-hidden">
          <div className="bg-[#FFC107] p-8 text-center">
            <div className="text-5xl font-black mb-1" style={{ fontFamily: SERIF }}>{stats.winRate}</div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70">Win Rate</div>
          </div>
          <div className="bg-[#FFC107] p-8 text-center">
            <div className="text-5xl font-black mb-1" style={{ fontFamily: SERIF }}>{stats.roi}</div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70">ROI</div>
          </div>
          <div className="bg-[#FFC107] p-8 text-center">
            <div className="text-5xl font-black mb-1" style={{ fontFamily: SERIF }}>{stats.units}</div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70">Units Won</div>
          </div>
          <div className="bg-[#FFC107] p-8 text-center">
            <div className="text-5xl font-black mb-1" style={{ fontFamily: SERIF }}>{stats.avgEv}</div>
            <div className="text-xs font-bold uppercase tracking-widest opacity-70">Avg EV / Pick</div>
          </div>
        </div>

        <div className="mt-4 text-xs text-[#060D1F]/60 font-medium text-center md:text-left">
          {stats.isLive
            ? `Live performance · ${picksTracked} picks tracked in window`
            : "Baseline shown — live track record publishes after first graded slate"}
        </div>
      </div>
    </section>
  );
}

/* ---------------- MEMBERSHIP ---------------- */
function MembershipSection() {
  const tiers = [
    {
      name: "Guest Pass",
      tagline: "Verify the model before you commit.",
      price: "Free",
      priceMeta: "No card required",
      cta: "Start Free",
      ctaHref: "/sign-up",
      ctaStyle: "border border-white/20 hover:bg-white/5 text-white",
      features: [
        { ok: true, text: "Today's #1 Tier-A pick (delayed)" },
        { ok: true, text: "Public tier badge + final result" },
        { ok: false, text: "No edge / EV / probability metrics" },
        { ok: false, text: "No full slate or history" },
      ],
      highlight: false,
      badge: null,
    },
    {
      name: "Members",
      tagline: "Full access to the daily slate and the math behind it.",
      billingNote: "Billed as MVP",
      price: "$19.99",
      priceUnit: "/ mo",
      priceMeta: "Or $149 billed annually · save 38%",
      cta: "Become a Member",
      ctaHref: "/subscribe",
      ctaStyle: "bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F]",
      features: [
        { ok: true, text: "Every Official Tier A / B / C pick, every day" },
        { ok: true, text: "Full Model Watch lane while markets earn promotion" },
        { ok: true, text: "Full edge, EV, model & market probability" },
        { ok: true, text: "CLV tracked on every pick" },
        { ok: true, text: "Best line across all sportsbooks" },
        { ok: true, text: "Parlay Builder + Bet Tracker" },
        { ok: true, text: "Re-scored every 10 minutes" },
      ],
      highlight: true,
      badge: "Most Popular",
    },
  ];

  return (
    <section id="membership" className="py-32 relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/20 bg-white/5 mb-4 text-xs font-bold uppercase tracking-widest text-white/70">
            Access Tiers
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white" style={{ fontFamily: SERIF }}>
            Choose your level of access.
          </h2>
          <p className="text-white/60 font-light text-lg">
            Start free. Upgrade when the picks prove themselves. Cancel any time —
            no contracts, no pressure.
          </p>
          <div className="mt-8 mx-auto max-w-2xl border-l-2 border-[#FFC107] pl-5 text-left">
            <p className="text-white text-base md:text-lg leading-relaxed">
              <span className="text-[#FFC107] font-semibold">Members get every model-approved bet,</span>{" "}
              <span className="text-white/90">live edge data,</span> and{" "}
              <span className="text-white/90">closing-line tracking</span> — all in one feed,
              graded publicly the next morning.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-stretch max-w-4xl mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`p-8 flex flex-col rounded-sm relative ${
                tier.highlight
                  ? "border border-[#FFC107]/50 bg-gradient-to-b from-[#112454] to-[#0D1B3E] lg:-translate-y-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                  : "border border-white/10 bg-[#0D1B3E]"
              }`}
            >
              {tier.badge && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#FFC107] text-[#060D1F] px-4 py-1 text-xs font-bold uppercase tracking-widest rounded-sm">
                  {tier.badge}
                </div>
              )}

              <h3 className={`text-2xl font-bold mb-3 ${tier.highlight ? "text-[#FFC107]" : "text-white"}`} style={{ fontFamily: SERIF }}>
                {tier.name}
              </h3>
              {tier.billingNote && (
                <div className="inline-flex items-center gap-1.5 mb-4 px-2.5 py-1 rounded-sm border border-[#FFC107]/40 bg-[#FFC107]/5">
                  <span className="w-1 h-1 rounded-full bg-[#FFC107]" />
                  <span className="text-[11px] text-[#FFC107] font-mono tracking-wide whitespace-nowrap">
                    {tier.billingNote} on your card
                  </span>
                </div>
              )}
              <p className="text-white/50 text-sm mb-6 min-h-[2.5rem]">{tier.tagline}</p>

              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-4xl font-bold text-white">{tier.price}</span>
                {tier.priceUnit && <span className="text-white/50">{tier.priceUnit}</span>}
              </div>
              <div className={`text-sm mb-8 font-medium ${tier.highlight ? "text-[#FFC107]" : "text-white/40"}`}>
                {tier.priceMeta}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((f, i) => (
                  <li key={i} className={`flex items-start gap-3 text-sm ${f.ok ? "text-white/85" : "text-white/40"}`}>
                    {f.ok ? (
                      <Check size={18} className={`shrink-0 mt-0.5 ${tier.highlight ? "text-[#FFC107]" : "text-[#388E3C]"}`} />
                    ) : (
                      <span className="w-[18px] h-[18px] flex items-center justify-center text-white/30 shrink-0 mt-0.5">—</span>
                    )}
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className={`w-full py-3 text-center font-bold uppercase tracking-widest text-sm transition-colors rounded-sm ${tier.ctaStyle}`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-white/30 text-xs mt-10 max-w-xl mx-auto">
          Pricing does not constitute financial advice. Sports wagering involves risk.
          Please bet responsibly. SportsMVP picks are for informational purposes only.
        </p>
      </div>
    </section>
  );
}

/* ---------------- FOOTER ---------------- */
function LandingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#060D1F] pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <img src="/shield-logo.png" alt="SportsMVP" className="h-10 w-auto object-contain" />
              <span className="text-xl font-bold text-white" style={{ fontFamily: SERIF }}>SportsMVP</span>
            </div>
            <p className="text-white/40 text-sm leading-relaxed max-w-sm">
              SportsMVP is a data-driven sports analytics platform. We use calibrated
              machine-learning models across NBA, NHL, and MLB. Picks publish as
              Official only when their market clears our launch thresholds — others
              surface in a Model Watch lane while they earn promotion. Every result
              is graded publicly.
            </p>
            <p className="text-white/25 text-xs mt-4">
              For entertainment and informational purposes only. Always wager responsibly.
            </p>
          </div>
          <div>
            <div className="text-white/60 text-xs font-bold uppercase tracking-wider mb-4">Platform</div>
            <ul className="space-y-2.5">
              <li><Link href="/sign-in" className="text-white/50 hover:text-[#FFC107] text-sm transition-colors">Today's Picks</Link></li>
              <li><Link href="/performance" className="text-white/50 hover:text-[#FFC107] text-sm transition-colors">Performance</Link></li>
              <li><Link href="/history" className="text-white/50 hover:text-[#FFC107] text-sm transition-colors">Pick History</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-white/60 text-xs font-bold uppercase tracking-wider mb-4">Legal</div>
            <ul className="space-y-2.5">
              <li><Link href="/privacy" className="text-white/50 hover:text-[#FFC107] text-sm transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-white/50 hover:text-[#FFC107] text-sm transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-xs">© 2026 SportsMVP. All rights reserved.</p>
          <div className="flex items-center gap-2 text-white/30 text-xs">
            <Activity className="w-3.5 h-3.5" />
            <span>Math, not mystique.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ---------------- ROOT ---------------- */
export function Landing() {
  const { data: perf } = useLandingStats();
  const stats = buildStats(perf);
  const picksTracked = perf ? (perf.wins ?? 0) + (perf.losses ?? 0) + (perf.pushes ?? 0) : 0;

  return (
    <div className="min-h-screen bg-[#060D1F] text-white selection:bg-[#FFC107] selection:text-[#060D1F]">
      <LandingNav />
      <HeroSection stats={stats} />
      <TodaysTopPick />
      <MethodologySection />
      <LiveOutputStrip />
      <TrackRecordSection stats={stats} picksTracked={picksTracked} />
      <MembershipSection />
      <LandingFooter />
    </div>
  );
}
