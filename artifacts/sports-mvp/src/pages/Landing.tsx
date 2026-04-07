import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Star, TrendingUp, Shield, Zap, BarChart2, Clock, BookOpen, CheckCircle, ChevronRight, ArrowRight } from "lucide-react";
import { parseGameMatchup, getTeamLogoUrl } from "@/lib/teamLogos";
import { formatOdds } from "@/lib/utils";

const STATS = [
  { label: "Win Rate", value: "55.8%", color: "#388E3C" },
  { label: "ROI (45 Days)", value: "+22.9%", color: "#388E3C" },
  { label: "Units Won", value: "+84.5U", color: "#388E3C" },
  { label: "CLV Hit Rate", value: "54.7%", color: "#FFC107" },
];

const FEATURES = [
  {
    icon: BarChart2,
    title: "Calibrated ML Models",
    desc: "Every pick is scored by a multi-stage pipeline — market probability, edge calculation, EV, and ranking. No gut calls.",
  },
  {
    icon: TrendingUp,
    title: "Best Lines Across All Books",
    desc: "We query DraftKings, FanDuel, BetMGM, Caesars, and more every 10 minutes to find the best available price for every market.",
  },
  {
    icon: Shield,
    title: "CLV Tracking",
    desc: "Closing Line Value is the gold standard for measuring pick quality. We track every pick's CLV delta so you know if you're beating the market.",
  },
  {
    icon: Zap,
    title: "Real-Time Updates",
    desc: "Odds refresh every 10 minutes automatically. If the line moves before tipoff, your picks re-score with the latest data.",
  },
  {
    icon: BookOpen,
    title: "Transparent Methodology",
    desc: "We publish our EV formula, Brier score, and calibration methodology. No black boxes. The math is always visible.",
  },
  {
    icon: Clock,
    title: "Daily Auto-Scoring",
    desc: "Results are validated every morning at 3:30 AM. Win/loss/push recorded automatically with final scores from the sportsbook APIs.",
  },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    accent: "#424242",
    accentBg: "rgba(66,66,66,0.15)",
    items: ["Today's #1 top pick (daily)", "Tier badge only", "No metrics or history", "Web access"],
    cta: "Start Free",
    ctaStyle: "border border-[#424242] text-white hover:bg-white/5",
    popular: false,
  },
  {
    name: "MVP",
    price: "$19.99",
    period: "/month",
    annual: "$149/year",
    accent: "#0033A0",
    accentBg: "rgba(0,51,160,0.2)",
    items: [
      "All A / B / C tier picks daily",
      "Full EV, edge, and rank metrics",
      "CLV tracking on every pick",
      "45-day performance dashboard",
      "Pick history with results",
      "Best lines across all sportsbooks",
      "Picks updated every 10 minutes",
    ],
    cta: "Get MVP",
    ctaStyle: "bg-[#0033A0] text-white hover:bg-[#0040CC]",
    popular: true,
  },
  {
    name: "MVP Pro",
    price: "$39.99",
    period: "/month",
    annual: "$299/year",
    accent: "#FFC107",
    accentBg: "rgba(255,193,7,0.12)",
    items: [
      "Everything in MVP",
      "Email alerts for A-tier picks",
      "Line movement notifications",
      "Early picks (before public release)",
      "API access for your own tools",
      "Priority support",
    ],
    cta: "Get MVP Pro",
    ctaStyle: "bg-[#FFC107] text-[#060D1F] hover:bg-[#FFD54F] font-bold",
    popular: false,
  },
];

function LandingNav() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#1A3066]/80 bg-[#060D1F]/95 backdrop-blur">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-nav.png" alt="SportsMVP" className="h-12 object-contain" />
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#how-it-works" className="text-sm text-white/60 hover:text-white transition-colors font-medium">How It Works</a>
          <a href="#features" className="text-sm text-white/60 hover:text-white transition-colors font-medium">Features</a>
          <a href="#pricing" className="text-sm text-white/60 hover:text-white transition-colors font-medium">Pricing</a>
          <Link href="/picks" className="text-sm text-white/60 hover:text-white transition-colors font-medium">Today's Picks</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/picks" className="text-sm text-white/70 hover:text-white transition-colors font-medium hidden md:block">Sign In</Link>
          <Link href="/picks" className="inline-flex items-center gap-1.5 bg-[#0033A0] hover:bg-[#0040CC] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            Start Free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </nav>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 lg:py-28">
      {/* Sportsbook background image */}
      <div className="absolute inset-0">
        <img
          src="/sportsbook-hero.jpg"
          alt=""
          className="w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#060D1F] via-[#060D1F]/92 to-[#060D1F]/65" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060D1F] via-transparent to-[#060D1F]/40" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 bg-[#FFC107]/10 border border-[#FFC107]/30 rounded-full px-4 py-1.5 mb-6">
            <Star size={12} className="text-[#FFC107] fill-[#FFC107]" />
            <span className="text-[#FFC107] text-xs font-bold tracking-widest uppercase">NBA + NHL · April 2026</span>
          </div>
          <div className="flex items-center gap-5 mb-6">
            <img
              src="/shield-logo.png"
              alt="SportsMVP Shield"
              className="h-28 lg:h-36 w-auto object-contain drop-shadow-[0_0_24px_rgba(255,193,7,0.35)] shrink-0"
            />
            <h1 className="text-5xl lg:text-6xl font-black font-display leading-[1.05] tracking-tight text-white">
              Bet Like<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0033A0] via-[#4488FF] to-[#FFC107]">
                an MVP.
              </span>
            </h1>
          </div>
          <p className="text-lg text-white/70 leading-relaxed mb-8 max-w-lg">
            SportsMVP uses calibrated machine learning models to identify positive expected-value picks across NBA and NHL markets.
            No gut calls. No hype. Just math — updated every 10 minutes.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/picks" className="inline-flex items-center gap-2 bg-[#0033A0] hover:bg-[#0040CC] text-white font-bold px-8 py-4 rounded-xl text-base transition-colors shadow-[0_0_30px_rgba(0,51,160,0.4)]">
              View Today's Picks <ChevronRight size={18} />
            </Link>
            <a href="#pricing" className="inline-flex items-center gap-2 border border-white/20 text-white/80 hover:bg-white/5 font-medium px-8 py-4 rounded-xl text-base transition-colors">
              See Pricing
            </a>
          </div>
          <p className="text-white/40 text-sm mt-4">No credit card required for free tier</p>
        </div>

        {/* Right: floating stats */}
        <div className="hidden lg:grid grid-cols-2 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[#0D1B3E]/80 backdrop-blur border border-[#1A3066] rounded-2xl p-5 text-center">
              <div className="text-3xl font-black font-display mb-1" style={{ color: s.color }}>{s.value}</div>
              <div className="text-white/50 text-xs font-medium uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
          <div className="col-span-2 bg-[#0D1B3E]/80 backdrop-blur border border-[#1A3066] rounded-2xl p-4 text-center">
            <div className="text-white/40 text-xs uppercase tracking-wider mb-1">Live Track Record · 45 Days</div>
            <div className="text-white text-sm font-medium">418 picks tracked · Updated daily</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsMobileBar() {
  return (
    <section className="lg:hidden bg-[#0D1B3E] border-y border-[#1A3066]">
      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-2 gap-4">
        {STATS.map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-2xl font-black font-display" style={{ color: s.color }}>{s.value}</div>
            <div className="text-white/50 text-xs font-medium uppercase tracking-wider mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TodaysTopPick() {
  const today = new Date().toISOString().split("T")[0];
  const { data, isLoading } = useQuery({
    queryKey: ["landing-top-pick", today],
    queryFn: async () => {
      const res = await axios.get(`/picks?date=${today}&tier=A&limit=1`);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const pick = data?.picks?.[0] ?? null;

  return (
    <section className="relative py-20 bg-[#060D1F] overflow-hidden">
      {/* Section glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full bg-[#FFC107]/8 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[250px] rounded-full bg-[#0033A0]/15 blur-[80px]" />
      </div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-3">
            <Star size={12} className="fill-[#FFC107]" /> Live Today
          </div>
          <h2 className="text-3xl font-black font-display text-white">Today's Top Pick</h2>
          <p className="text-white/50 mt-2 text-sm">Updated every 10 minutes with the latest sportsbook odds</p>
        </div>

        <div className="max-w-2xl mx-auto">
          {isLoading ? (
            <div className="h-40 rounded-2xl bg-[#0D1B3E] animate-pulse" />
          ) : pick ? (
            <TopPickCard pick={pick} />
          ) : (
            <div className="text-center text-white/40 py-12 border border-dashed border-[#1A3066] rounded-2xl">
              No picks available yet — check back soon.
            </div>
          )}
        </div>

        <div className="text-center mt-8">
          <Link href="/picks" className="inline-flex items-center gap-2 text-[#4488FF] hover:text-[#6699FF] font-semibold text-sm transition-colors">
            View all today's picks <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function TopPickCard({ pick }: { pick: any }) {
  const matchup = parseGameMatchup(pick.gameKey, pick.league);
  const edge = parseFloat(pick.edge ?? "0");
  const ev = parseFloat(pick.ev ?? "0");
  const publishOdds = parseFloat(pick.publishOdds ?? "0");
  const publishLine = pick.publishLine ? parseFloat(pick.publishLine) : null;

  return (
    <div className="relative rounded-2xl border border-[#FFC107]/30 bg-gradient-to-br from-[#0D1B3E] via-[#112454] to-[#0D1B3E] p-6 shadow-[0_0_60px_rgba(255,193,7,0.12)] overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(45deg,#FFC107 0,#FFC107 1px,transparent 0,transparent 50%)", backgroundSize: "12px 12px" }}
      />
      <div className="relative">
        <div className="flex items-center gap-2 mb-4">
          <Star size={13} className="text-[#FFC107] fill-[#FFC107]" />
          <span className="text-[#FFC107] text-xs font-bold tracking-widest uppercase">Top Pick of the Day</span>
          <span className="bg-[#FFC107] text-[#060D1F] text-[10px] font-black px-1.5 py-0.5 rounded font-display">TIER {pick.tier}</span>
        </div>

        {matchup && (
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-1.5">
              <img src={getTeamLogoUrl(pick.league, matchup.awayAbbrev) ?? undefined} className="h-9 w-9 object-contain drop-shadow" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} alt="" />
              <span className={`text-lg font-black font-display ${pick.pick === 'away' ? 'text-white' : 'text-white/40'}`}>{matchup.awayAbbrev.toUpperCase()}</span>
            </div>
            <span className="text-white/30 text-sm">@</span>
            <div className="flex items-center gap-1.5">
              <img src={getTeamLogoUrl(pick.league, matchup.homeAbbrev) ?? undefined} className="h-9 w-9 object-contain drop-shadow" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} alt="" />
              <span className={`text-lg font-black font-display ${pick.pick === 'home' ? 'text-white' : 'text-white/40'}`}>{matchup.homeAbbrev.toUpperCase()}</span>
            </div>
          </div>
        )}

        <div className="flex items-baseline gap-3 mb-5">
          <span className="text-3xl font-black font-display text-white">{pick.pick.toUpperCase()}</span>
          {publishLine !== null && <span className="text-2xl font-bold text-white/60">{publishLine > 0 ? `+${publishLine}` : publishLine}</span>}
          <span className="text-2xl font-bold text-[#4488FF]">{formatOdds(publishOdds)}</span>
        </div>

        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[#1A3066]">
          <div className="text-center">
            <div className="text-[10px] uppercase text-white/40 tracking-wider mb-1">Edge</div>
            <div className="text-xl font-black font-display text-[#388E3C]">{(edge * 100).toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-white/40 tracking-wider mb-1">EV</div>
            <div className="text-xl font-black font-display text-[#388E3C]">{(ev * 100).toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase text-white/40 tracking-wider mb-1">League</div>
            <div className="text-xl font-black font-display text-white">{pick.league.toUpperCase()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Market Snapshots",
      desc: "Every 10 minutes, we pull live odds from all major US sportsbooks — DraftKings, FanDuel, BetMGM, Caesars, and more. We find the best available line for every game.",
    },
    {
      num: "02",
      title: "Model Scoring",
      desc: "Our calibrated ML models compute win probability, edge over the market's fair price, and expected value for every pick. Only positive-EV picks with meaningful edge advance.",
    },
    {
      num: "03",
      title: "Graded & Published",
      desc: "Picks are tiered A (strongest), B, or C based on a composite rank score. Every morning at 3:30 AM, prior picks are automatically validated against final scores.",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-[#0D1B3E]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="text-[#4488FF] text-xs font-bold tracking-widest uppercase mb-3">Process</div>
            <h2 className="text-4xl font-black font-display text-white mb-4 leading-tight">
              How SportsMVP Works
            </h2>
            <p className="text-white/60 mb-10 leading-relaxed">
              Every pick is the output of an automated, transparent pipeline — no human handicapper discretion.
              The model runs 24/7 so you always have the most current information.
            </p>
            <div className="space-y-8">
              {steps.map((step) => (
                <div key={step.num} className="flex gap-5">
                  <div className="text-3xl font-black font-display text-[#4488FF]/40 leading-none w-10 shrink-0">{step.num}</div>
                  <div>
                    <div className="text-white font-bold mb-1">{step.title}</div>
                    <div className="text-white/50 text-sm leading-relaxed">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative rounded-2xl overflow-hidden bg-[#0D1B3E] border border-[#1A3066] p-6 shadow-2xl">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-[#0033A0]/10 blur-[60px] pointer-events-none" />
            <div className="text-white/30 text-xs font-mono uppercase tracking-wider mb-4">Live Model Output · April 7, 2026</div>
            {[
              { game: "MIL @ CHI", market: "Spread", pick: "MIL -4.5", edge: "+4.6%", ev: "+8.2%", tier: "A" },
              { game: "BOS @ NYR", market: "Moneyline", pick: "BOS ML", edge: "+3.1%", ev: "+5.4%", tier: "B" },
              { game: "LAL @ DEN", market: "Total", pick: "Over 227.5", edge: "+2.8%", ev: "+4.9%", tier: "B" },
              { game: "TOR @ PHI", market: "Spread", pick: "PHI -3", edge: "+1.9%", ev: "+3.2%", tier: "C" },
            ].map((row) => (
              <div key={row.game} className="flex items-center justify-between py-3 border-b border-[#1A3066]/60 last:border-0">
                <div>
                  <div className="text-white text-sm font-semibold">{row.game}</div>
                  <div className="text-white/40 text-xs">{row.market} · {row.pick}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-[#388E3C] text-sm font-bold">{row.edge}</div>
                    <div className="text-white/30 text-[10px]">Edge</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#388E3C] text-sm font-bold">{row.ev}</div>
                    <div className="text-white/30 text-[10px]">EV</div>
                  </div>
                  <div className={`text-[10px] font-black px-2 py-1 rounded font-display ${
                    row.tier === 'A' ? 'bg-[#FFC107] text-[#060D1F]' :
                    row.tier === 'B' ? 'bg-[#0033A0] text-white' :
                    'bg-[#1A3066] text-white/70'
                  }`}>{row.tier}</div>
                </div>
              </div>
            ))}
            <div className="mt-4 pt-3 flex items-center justify-between">
              <span className="text-white/30 text-xs">Updated 3 mins ago</span>
              <span className="text-[#388E3C] text-xs font-semibold">● Live</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="py-24 bg-[#060D1F]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="text-[#4488FF] text-xs font-bold tracking-widest uppercase mb-3">What You Get</div>
          <h2 className="text-4xl font-black font-display text-white">Built for Serious Bettors</h2>
          <p className="text-white/50 mt-3 max-w-xl mx-auto">Every feature is designed around the principle that you deserve to see the math, not just the pick.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[#0D1B3E] border border-[#1A3066] rounded-2xl p-6 hover:border-[#4488FF]/30 transition-colors group">
              <div className="w-10 h-10 rounded-xl bg-[#4488FF]/10 flex items-center justify-center mb-4 group-hover:bg-[#4488FF]/20 transition-colors">
                <f.icon size={20} className="text-[#4488FF]" />
              </div>
              <h3 className="text-white font-bold mb-2">{f.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* League cards */}
        <div className="mt-16 grid grid-cols-2 gap-6">
          {[
            {
              league: "NHL",
              markets: ["Moneyline", "Puck Line", "Totals"],
              color: "#4488FF",
              games: "30 teams · 82 game season",
              gradient: "from-[#0033A0]/30 to-[#0D1B3E]",
              icon: "NHL",
            },
            {
              league: "NBA",
              markets: ["Moneyline", "Spread", "Totals"],
              color: "#FFC107",
              games: "30 teams · 82 game season",
              gradient: "from-[#FFC107]/10 to-[#0D1B3E]",
              icon: "NBA",
            },
          ].map((l) => (
            <div key={l.league} className={`relative rounded-2xl bg-gradient-to-br ${l.gradient} border border-[#1A3066] p-6 overflow-hidden`}>
              <div className="absolute top-4 right-4 text-4xl opacity-20 select-none">{l.icon}</div>
              <div className="text-3xl font-black font-display mb-1" style={{ color: l.color }}>{l.league}</div>
              <div className="text-white/40 text-xs mb-4">{l.games}</div>
              <div className="flex flex-wrap gap-2">
                {l.markets.map((m) => (
                  <span key={m} className="text-[10px] font-bold px-2 py-1 rounded border border-[#1A3066] text-white/60">{m}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="py-24 bg-[#0D1B3E]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-3">Simple Pricing</div>
          <h2 className="text-4xl font-black font-display text-white">Choose Your Level</h2>
          <p className="text-white/50 mt-3 max-w-lg mx-auto">Start free. Upgrade when the picks prove themselves. Cancel anytime.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="relative rounded-2xl border p-6 flex flex-col"
              style={{
                borderColor: plan.popular ? plan.accent : "#1A3066",
                background: plan.popular
                  ? `linear-gradient(135deg, #0D1B3E, #112454)`
                  : "#0D1B3E",
                boxShadow: plan.popular ? `0 0 40px ${plan.accent}33` : "none",
              }}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#0033A0] text-white text-[10px] font-black px-3 py-1 rounded-full tracking-widest uppercase">
                  Most Popular
                </div>
              )}
              <div className="mb-6">
                <div className="text-white font-bold text-lg mb-1" style={{ color: plan.popular ? "white" : "rgba(255,255,255,0.7)" }}>
                  {plan.name}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black font-display text-white">{plan.price}</span>
                  <span className="text-white/50 text-sm">{plan.period}</span>
                </div>
                {plan.annual && (
                  <div className="text-white/40 text-xs mt-1">{plan.annual} · save 38%</div>
                )}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle size={14} className="shrink-0 mt-0.5" style={{ color: plan.accent }} />
                    <span className="text-white/70">{item}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/picks"
                className={`w-full py-3 rounded-xl text-sm font-bold text-center transition-colors block ${plan.ctaStyle}`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-white/30 text-xs mt-8">
          Pricing does not constitute financial advice. Gambling involves risk. Please bet responsibly.
        </p>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="bg-[#060D1F] border-t border-[#1A3066] py-14">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-2">
            <img src="/logo-nav.png" alt="SportsMVP" className="h-8 object-contain mb-4" />
            <p className="text-white/40 text-sm leading-relaxed max-w-sm">
              SportsMVP is a data-driven sports analytics platform. We use calibrated machine learning models to identify positive expected-value betting opportunities in NBA and NHL markets.
            </p>
            <p className="text-white/25 text-xs mt-4">
              For entertainment and informational purposes only. Always gamble responsibly.
            </p>
          </div>
          <div>
            <div className="text-white/60 text-xs font-bold uppercase tracking-wider mb-4">Platform</div>
            <ul className="space-y-2.5">
              {[
                { label: "Today's Picks", href: "/picks" },
                { label: "Performance", href: "/performance" },
                { label: "Pick History", href: "/history" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-white/50 hover:text-white text-sm transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-white/60 text-xs font-bold uppercase tracking-wider mb-4">Legal</div>
            <ul className="space-y-2.5">
              {[
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms of Service", href: "/terms" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-white/50 hover:text-white text-sm transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-[#1A3066] pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/30 text-xs">© 2026 SportsMVP. All rights reserved. "Bet Like an MVP." is a trademark of SportsMVP.</p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-white/30 hover:text-white/60 text-xs transition-colors">Privacy</Link>
            <Link href="/terms" className="text-white/30 hover:text-white/60 text-xs transition-colors">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-[#060D1F] text-white">
      <LandingNav />
      <HeroSection />
      <StatsMobileBar />
      <TodaysTopPick />
      <HowItWorks />
      <FeaturesSection />
      <PricingSection />
      <LandingFooter />
    </div>
  );
}
