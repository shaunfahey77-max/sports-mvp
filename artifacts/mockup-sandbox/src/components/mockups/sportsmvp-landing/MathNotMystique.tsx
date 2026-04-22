import React from "react";
import { ArrowRight, ChevronRight, Activity, BarChart2, ShieldAlert, Cpu, Database, Link as LinkIcon, Download, Clock, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MathNotMystique() {
  return (
    <div className="min-h-screen bg-[#060D1F] text-slate-300 font-sans selection:bg-[#0033A0] selection:text-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b border-[#1A3066]/50 bg-[#060D1F]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-[#0033A0] to-[#1A3066] flex items-center justify-center border border-[#4488FF]/30">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-bold tracking-tight text-lg">SportsMVP</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
            <a href="#methodology" className="hover:text-white transition-colors">Methodology</a>
            <a href="#track-record" className="hover:text-white transition-colors">Track Record</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/5">
              Sign In
            </Button>
            <Button className="bg-[#0033A0] text-white hover:bg-[#4488FF] border border-[#4488FF]/50 rounded-md font-mono text-sm uppercase tracking-wider">
              Initialize
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-24 overflow-hidden border-b border-[#1A3066]/30">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1A3066_1px,transparent_1px),linear-gradient(to_bottom,#1A3066_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-[500px] bg-[#0033A0]/20 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-[#FFC107]/30 bg-[#FFC107]/10 text-[#FFC107] text-[11px] font-mono uppercase tracking-widest mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FFC107] animate-pulse" />
              Live Models: NBA + NHL
            </div>
            <h1 className="text-5xl lg:text-7xl font-black text-white leading-[1.1] tracking-tight mb-6">
              Math,<br/>
              <span className="text-[#4488FF]">Not Mystique.</span>
            </h1>
            <p className="text-lg text-slate-400 mb-10 max-w-xl leading-relaxed font-light">
              SportsMVP is an analyst's instrument, not a tipster service. We run calibrated machine learning models against live sportsbook odds to identify statistically significant positive expected-value (EV) plays.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button className="h-12 px-8 bg-[#0033A0] hover:bg-[#4488FF] text-white font-mono text-sm uppercase tracking-wider rounded border border-[#4488FF]/50 shadow-[0_0_20px_rgba(0,51,160,0.5)]">
                View Documentation
              </Button>
              <Button variant="outline" className="h-12 px-8 border-[#1A3066] text-slate-300 hover:text-white hover:bg-[#1A3066]/50 font-mono text-sm uppercase tracking-wider">
                Explore Pricing
              </Button>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-slate-500 font-mono">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#388E3C]" />
                Brier-scored probability
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#388E3C]" />
                Closing line value tracked
              </div>
            </div>
          </div>
          
          {/* Terminal / Output Mockup */}
          <div className="relative rounded-lg border border-[#1A3066] bg-[#0D1B3E]/80 backdrop-blur shadow-2xl overflow-hidden font-mono text-xs">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A3066] bg-[#060D1F]/50">
              <div className="flex gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              </div>
              <div className="text-slate-500">model_output_stream.log</div>
            </div>
            <div className="p-4 space-y-3 text-slate-300">
              <div className="flex text-slate-500">
                <span className="w-20 shrink-0">14:02:41</span>
                <span>[INFO] fetching_market_snapshots... [OK]</span>
              </div>
              <div className="flex text-slate-500">
                <span className="w-20 shrink-0">14:02:43</span>
                <span>[INFO] running_inference: model=nba_spread_v4... [OK]</span>
              </div>
              <div className="flex">
                <span className="w-20 shrink-0 text-slate-500">14:02:45</span>
                <span className="text-[#4488FF]">[EVAL] POSITIVE_EV_DETECTED</span>
              </div>
              <div className="pl-20 space-y-1">
                <div><span className="text-slate-500">id:</span> <span className="text-[#FFC107]">"game_nba_bos_phi"</span></div>
                <div><span className="text-slate-500">market:</span> "spread"</div>
                <div><span className="text-slate-500">pick:</span> "BOS -4.5"</div>
                <div><span className="text-slate-500">book_odds:</span> -110 <span className="text-slate-500">(implied: 52.38%)</span></div>
                <div><span className="text-slate-500">model_prob:</span> 56.12% <span className="text-slate-500">(calibrated)</span></div>
                <div><span className="text-slate-500">edge:</span> <span className="text-[#388E3C]">+3.74%</span></div>
                <div><span className="text-slate-500">ev:</span> <span className="text-[#388E3C]">+7.14%</span></div>
                <div><span className="text-slate-500">tier:</span> <span className="text-[#FFC107]">"A"</span></div>
              </div>
              <div className="flex text-slate-500 pt-2 border-t border-[#1A3066]/50">
                <span className="w-20 shrink-0">14:02:46</span>
                <span>[INFO] dispatching_webhooks... [OK]</span>
              </div>
              <div className="flex">
                <span className="w-20 shrink-0 text-slate-500">14:02:47</span>
                <span className="text-slate-400 animate-pulse">awaiting_next_tick...</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Methodology Section */}
      <section id="methodology" className="py-24 border-b border-[#1A3066]/30 bg-[#060D1F]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-16">
            <h2 className="text-3xl font-black text-white mb-4">Methodology Pipeline</h2>
            <p className="text-slate-400 max-w-2xl">A rigorous, three-stage quantitative approach to identifying market inefficiencies.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-8 left-[15%] right-[15%] h-[1px] bg-[#1A3066] border-t border-dashed border-[#4488FF]/30 z-0" />
            
            <div className="relative z-10 bg-[#0D1B3E] border border-[#1A3066] p-8 rounded-lg shadow-lg">
              <div className="w-16 h-16 rounded bg-[#060D1F] border border-[#1A3066] flex items-center justify-center mb-6 font-mono text-xl text-[#4488FF] shadow-inner">01</div>
              <h3 className="text-xl font-bold text-white mb-3">Snapshots</h3>
              <p className="text-sm text-slate-400 leading-relaxed mb-4">
                We poll DraftKings, FanDuel, BetMGM, and Caesars every 10 minutes. Real-time odds ingestion forms the baseline for all calculations.
              </p>
              <ul className="text-xs font-mono text-slate-500 space-y-2">
                <li className="flex gap-2"><Database className="w-4 h-4 text-[#1A3066]" /> 8 Books polled</li>
                <li className="flex gap-2"><Clock className="w-4 h-4 text-[#1A3066]" /> 10m frequency</li>
              </ul>
            </div>

            <div className="relative z-10 bg-[#0D1B3E] border border-[#1A3066] p-8 rounded-lg shadow-lg">
              <div className="w-16 h-16 rounded bg-[#060D1F] border border-[#1A3066] flex items-center justify-center mb-6 font-mono text-xl text-[#4488FF] shadow-inner">02</div>
              <h3 className="text-xl font-bold text-white mb-3">Scoring</h3>
              <p className="text-sm text-slate-400 leading-relaxed mb-4">
                Proprietary models calculate true win probability. If the model probability exceeds the book's implied probability by our threshold, the pick is flagged.
              </p>
              <ul className="text-xs font-mono text-slate-500 space-y-2">
                <li className="flex gap-2"><Cpu className="w-4 h-4 text-[#1A3066]" /> EV Calculation</li>
                <li className="flex gap-2"><BarChart2 className="w-4 h-4 text-[#1A3066]" /> Edge %</li>
              </ul>
            </div>

            <div className="relative z-10 bg-[#0D1B3E] border border-[#1A3066] p-8 rounded-lg shadow-lg">
              <div className="w-16 h-16 rounded bg-[#060D1F] border border-[#1A3066] flex items-center justify-center mb-6 font-mono text-xl text-[#4488FF] shadow-inner">03</div>
              <h3 className="text-xl font-bold text-white mb-3">Grading</h3>
              <p className="text-sm text-slate-400 leading-relaxed mb-4">
                Picks are tiered (A, B, C) based on expected value. All predictions are tracked against closing line value (CLV) and final game outcomes.
              </p>
              <ul className="text-xs font-mono text-slate-500 space-y-2">
                <li className="flex gap-2"><ShieldAlert className="w-4 h-4 text-[#1A3066]" /> Brier Scored</li>
                <li className="flex gap-2"><Activity className="w-4 h-4 text-[#1A3066]" /> CLV Tracked</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Track Record / Stats */}
      <section id="track-record" className="py-24 bg-[#0D1B3E]/50 border-b border-[#1A3066]/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
            <div>
              <h2 className="text-3xl font-black text-white mb-4">Public Track Record</h2>
              <p className="text-slate-400 max-w-xl">We publish our aggregate performance data. Transparency is our core product.</p>
            </div>
            <div className="font-mono text-xs text-slate-500 bg-[#060D1F] px-4 py-2 border border-[#1A3066] rounded inline-flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#388E3C] animate-pulse" />
              T-47 Days Window
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#1A3066] border border-[#1A3066] rounded-lg overflow-hidden">
            <div className="bg-[#0D1B3E] p-8 flex flex-col items-center justify-center text-center">
              <div className="text-4xl font-mono text-[#388E3C] mb-2 tracking-tight">60.0%</div>
              <div className="text-xs uppercase tracking-widest text-slate-500">Win Rate</div>
            </div>
            <div className="bg-[#0D1B3E] p-8 flex flex-col items-center justify-center text-center">
              <div className="text-4xl font-mono text-[#388E3C] mb-2 tracking-tight">+27.1%</div>
              <div className="text-xs uppercase tracking-widest text-slate-500">ROI</div>
            </div>
            <div className="bg-[#0D1B3E] p-8 flex flex-col items-center justify-center text-center">
              <div className="text-4xl font-mono text-[#388E3C] mb-2 tracking-tight">+165.1</div>
              <div className="text-xs uppercase tracking-widest text-slate-500">Units Won</div>
            </div>
            <div className="bg-[#0D1B3E] p-8 flex flex-col items-center justify-center text-center">
              <div className="text-4xl font-mono text-[#FFC107] mb-2 tracking-tight">+23.2%</div>
              <div className="text-xs uppercase tracking-widest text-slate-500">Avg EV/Pick</div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section (The Core of the Hypothesis) */}
      <section id="pricing" className="py-32 relative bg-[#060D1F]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#0033A0_0%,transparent_70%)] opacity-10 pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-4xl font-black text-white mb-6">Infrastructure for Analysts</h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Choose the access level that matches your operational needs. From basic model validation to full programmatic integration.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-start">
            {/* Free Tier */}
            <div className="bg-[#0D1B3E] border border-[#1A3066] rounded-xl p-8 hover:border-[#4488FF]/30 transition-colors">
              <div className="mb-8">
                <h3 className="text-xl font-bold text-white font-mono uppercase tracking-wider mb-2">Public Beat</h3>
                <div className="text-sm text-slate-500 h-10">Verify model existence.</div>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-mono text-white">$0</span>
                </div>
              </div>
              <ul className="space-y-4 mb-8 text-sm text-slate-300 font-mono">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-slate-500 shrink-0" />
                  <span>1 daily verified pick</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-slate-500 shrink-0" />
                  <span>Tier classification (A/B/C)</span>
                </li>
                <li className="flex items-start gap-3 opacity-50">
                  <span className="w-5 h-5 flex items-center justify-center shrink-0">-</span>
                  <span>No probability metrics</span>
                </li>
                <li className="flex items-start gap-3 opacity-50">
                  <span className="w-5 h-5 flex items-center justify-center shrink-0">-</span>
                  <span>No historical dashboard</span>
                </li>
              </ul>
              <Button variant="outline" className="w-full border-[#1A3066] text-slate-300 hover:text-white hover:bg-[#1A3066]/50 font-mono uppercase text-xs tracking-wider">
                Create Free Account
              </Button>
            </div>

            {/* Paid Tier */}
            <div className="bg-[#060D1F] border border-[#4488FF] rounded-xl p-8 relative shadow-[0_0_30px_rgba(0,51,160,0.3)]">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0033A0] text-white text-[10px] font-mono uppercase tracking-widest px-3 py-1 rounded border border-[#4488FF]">
                Standard Access
              </div>
              <div className="mb-8">
                <h3 className="text-xl font-bold text-white font-mono uppercase tracking-wider mb-2">Analyst</h3>
                <div className="text-sm text-slate-400 h-10">Full dashboard access and daily slate.</div>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-mono text-white">$29</span>
                  <span className="text-slate-500 font-mono text-sm">/mo</span>
                </div>
                <div className="text-xs text-slate-500 mt-1 font-mono">or $249 / year</div>
              </div>
              <ul className="space-y-4 mb-8 text-sm text-slate-300 font-mono">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" />
                  <span>Full daily slate across NBA/NHL</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" />
                  <span>Edge, EV, CLV, and Brier metrics</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" />
                  <span>Line-shopping across 8 books</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" />
                  <span>90-day performance dashboard</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" />
                  <span>Downloadable raw JSON output</span>
                </li>
              </ul>
              <Button className="w-full bg-[#0033A0] hover:bg-[#4488FF] text-white border border-[#4488FF]/50 font-mono uppercase text-xs tracking-wider">
                Select Analyst
              </Button>
            </div>

            {/* Ultra Premium Tier */}
            <div className="bg-[#0D1B3E] border border-[#FFC107]/50 rounded-xl p-8 relative overflow-hidden">
              <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,193,7,0.05)_50%,transparent_75%)] bg-[length:250%_250%,100%_100%] animate-[shimmer_3s_linear_infinite]" />
              <div className="relative z-10">
                <div className="mb-8">
                  <h3 className="text-xl font-bold text-[#FFC107] font-mono uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Zap className="w-5 h-5" /> Quant Desk
                  </h3>
                  <div className="text-sm text-slate-400 h-10">Programmatic infrastructure for custom bankroll models.</div>
                  <div className="mt-6 flex items-baseline gap-2">
                    <span className="text-4xl font-mono text-white">$99</span>
                    <span className="text-slate-500 font-mono text-sm">/mo</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">or $899 / year</div>
                </div>
                <div className="text-xs font-bold text-[#FFC107] uppercase tracking-widest mb-4">Everything in Analyst, plus:</div>
                <ul className="space-y-4 mb-8 text-sm text-slate-300 font-mono">
                  <li className="flex items-start gap-3">
                    <LinkIcon className="w-5 h-5 text-[#FFC107] shrink-0" />
                    <span>Programmatic REST API access</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Activity className="w-5 h-5 text-[#FFC107] shrink-0" />
                    <span>Rate-limited streaming odds</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Zap className="w-5 h-5 text-[#FFC107] shrink-0" />
                    <span>Model-output Webhooks</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <BarChart2 className="w-5 h-5 text-[#FFC107] shrink-0" />
                    <span>Custom Kelly sizing calculator</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Download className="w-5 h-5 text-[#FFC107] shrink-0" />
                    <span>Weekly methodology PDFs</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-[#FFC107] shrink-0" />
                    <span>Priority email response (4 hrs)</span>
                  </li>
                </ul>
                <Button className="w-full bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F] font-bold font-mono uppercase text-xs tracking-wider">
                  Apply for API Access
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1A3066]/30 bg-[#060D1F] py-12 text-center text-sm font-mono text-slate-500">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#1A3066]" />
            SportsMVP © 2026. All rights reserved.
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-slate-300">Terms of Service</a>
            <a href="#" className="hover:text-slate-300">Privacy Policy</a>
            <a href="#" className="hover:text-slate-300">API Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}