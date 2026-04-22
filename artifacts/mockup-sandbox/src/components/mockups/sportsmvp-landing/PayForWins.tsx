import React, { useState } from "react";
import { 
  ArrowRight, 
  TrendingUp, 
  ShieldCheck, 
  Target, 
  BarChart, 
  CheckCircle2, 
  ChevronRight,
  Calculator,
  AlertTriangle,
  Zap
} from "lucide-react";

export function PayForWins() {
  const [profitInput, setProfitInput] = useState<number>(1000);
  
  const calculateOwed = (profit: number) => {
    const base = 49;
    const revShare = Math.max(0, profit * 0.05);
    const total = base + revShare;
    return Math.min(total, 249);
  };

  return (
    <div className="min-h-screen bg-[#060D1F] text-slate-200 font-sans selection:bg-[#0033A0] selection:text-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-[#1A3066] bg-[#060D1F]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-8 h-8 text-[#0033A0]" />
            <span className="text-xl font-black tracking-tight text-white">SportsMVP</span>
          </div>
          <div className="hidden md:flex items-center gap-8 font-medium text-sm">
            <a href="#track-record" className="hover:text-white transition-colors">Track Record</a>
            <a href="#methodology" className="hover:text-white transition-colors">Methodology</a>
            <a href="#pricing" className="text-[#388E3C] hover:text-[#4CAF50] transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-sm font-medium hover:text-white transition-colors hidden sm:block">Sign In</button>
            <button className="bg-[#0033A0] hover:bg-[#0040CC] text-white px-4 py-2 rounded-lg text-sm font-bold transition-all">
              Start Free
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#388E3C]/10 rounded-full blur-[120px]" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#388E3C]/10 border border-[#388E3C]/30 text-[#388E3C] font-bold text-xs tracking-wider uppercase mb-8">
            <TrendingUp className="w-4 h-4" />
            Current Month: +14.2% ROI
          </div>
          
          <h1 className="text-5xl md:text-7xl font-black text-white leading-tight tracking-tight mb-6 max-w-4xl mx-auto">
            We only win <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#388E3C] to-[#4CAF50]">when you win.</span>
          </h1>
          
          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Stop paying fixed fees for losing months. Our performance-aligned pricing means if the model drops below breakeven, your next month is on us.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
            <a href="#pricing" className="w-full sm:w-auto bg-[#388E3C] hover:bg-[#2E7D32] text-white px-8 py-4 rounded-xl font-bold text-lg transition-all shadow-[0_0_20px_rgba(56,142,60,0.3)] flex items-center justify-center gap-2">
              See Win-Aligned Pricing <ArrowRight className="w-5 h-5" />
            </a>
            <button className="w-full sm:w-auto bg-[#0D1B3E] hover:bg-[#112454] border border-[#1A3066] text-white px-8 py-4 rounded-xl font-bold text-lg transition-all">
              View Live Track Record
            </button>
          </div>

          {/* Results Strip */}
          <div className="bg-[#0D1B3E] border border-[#1A3066] rounded-2xl p-6 max-w-5xl mx-auto shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-white flex items-center gap-2">
                <BarChart className="w-5 h-5 text-[#4488FF]" /> 90-Day Rolling Performance
              </h3>
              <span className="text-xs font-mono text-slate-500">UPDATED DAILY AT 3:30 AM EST</span>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="border-r border-[#1A3066] pr-6">
                <div className="text-sm text-slate-400 font-medium mb-1">Win Rate</div>
                <div className="text-3xl font-black text-white">58.4%</div>
              </div>
              <div className="border-r border-[#1A3066] pr-6 hidden md:block">
                <div className="text-sm text-slate-400 font-medium mb-1">Total Picks</div>
                <div className="text-3xl font-black text-white">412</div>
              </div>
              <div className="border-r border-[#1A3066] pr-6">
                <div className="text-sm text-slate-400 font-medium mb-1">Units Won</div>
                <div className="text-3xl font-black text-[#388E3C]">+42.8u</div>
              </div>
              <div>
                <div className="text-sm text-slate-400 font-medium mb-1">ROI</div>
                <div className="text-3xl font-black text-[#388E3C]">+12.1%</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Top Pick & Methodology */}
      <section className="py-24 bg-[#0A1430] border-y border-[#1A3066]" id="methodology">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-6">The math behind the edge.</h2>
            <p className="text-lg text-slate-400 mb-8 leading-relaxed">
              We don't do "gut feels" or "locks of the century." We run a calibrated machine learning pipeline that scans every line across major books every 10 minutes.
            </p>
            
            <div className="space-y-8">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#0033A0]/20 border border-[#0033A0]/40 flex items-center justify-center shrink-0">
                  <Target className="w-6 h-6 text-[#4488FF]" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-2">1. Snapshots</h4>
                  <p className="text-slate-400">Live odds from DraftKings, FanDuel, BetMGM, and Caesars pulled continuously.</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#0033A0]/20 border border-[#0033A0]/40 flex items-center justify-center shrink-0">
                  <Zap className="w-6 h-6 text-[#4488FF]" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-2">2. Scoring</h4>
                  <p className="text-slate-400">Models calculate true win probability, edge over market, and Expected Value (EV).</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#0033A0]/20 border border-[#0033A0]/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-[#4488FF]" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white mb-2">3. Grading</h4>
                  <p className="text-slate-400">Picks are tiered and fully graded the next morning. Complete transparency.</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Sample Pick Card */}
          <div className="bg-[#0D1B3E] border border-[#1A3066] rounded-2xl p-8 relative shadow-2xl">
            <div className="absolute top-0 right-0 px-4 py-2 bg-[#FFC107] text-[#060D1F] font-bold text-sm rounded-bl-xl rounded-tr-2xl">
              TODAY'S TOP PICK
            </div>
            
            <div className="flex items-center gap-3 mb-6 mt-4">
              <span className="px-2.5 py-1 bg-[#1A3066] text-white rounded text-xs font-bold uppercase">NBA</span>
              <span className="text-slate-400 text-sm">Tipoff at 7:30 PM EST</span>
            </div>
            
            <div className="flex justify-between items-center mb-8 border-b border-[#1A3066] pb-8">
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-2xl font-black text-white">BOS</div>
                  <div className="text-sm text-slate-500">Away</div>
                </div>
                <div className="text-slate-600 font-black">@</div>
                <div>
                  <div className="text-2xl font-black text-white">NYK</div>
                  <div className="text-sm text-slate-500">Home</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-400 uppercase tracking-wider mb-1 font-bold">Pick</div>
                <div className="text-3xl font-black text-[#4488FF]">BOS -4.5</div>
                <div className="text-sm text-slate-500 mt-1">Odds: -110 (DraftKings)</div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[#060D1F] rounded-xl p-4 text-center border border-[#1A3066]">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Tier</div>
                <div className="text-xl font-black text-[#FFC107]">A</div>
              </div>
              <div className="bg-[#060D1F] rounded-xl p-4 text-center border border-[#1A3066]">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Edge</div>
                <div className="text-xl font-black text-[#388E3C]">+4.2%</div>
              </div>
              <div className="bg-[#060D1F] rounded-xl p-4 text-center border border-[#1A3066]">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">EV</div>
                <div className="text-xl font-black text-[#388E3C]">+7.1%</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-32 relative" id="pricing">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6">Pricing built for winners.</h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              We don't hide behind fixed expensive subscriptions when the model has an off month. Choose standard access or true skin-in-the-game pricing.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Free Tier */}
            <div className="bg-[#0D1B3E] border border-[#1A3066] rounded-3xl p-8 flex flex-col">
              <h3 className="text-2xl font-bold text-white mb-2">Sampler</h3>
              <div className="text-slate-400 mb-6">Perfect for evaluating our model.</div>
              <div className="mb-8">
                <span className="text-5xl font-black text-white">Free</span>
                <span className="text-slate-400 ml-2">forever</span>
              </div>
              <ul className="space-y-4 mb-10 flex-1 text-slate-300">
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>3 free picks per week</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>Full metrics shown</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>No payment method ever</span></li>
              </ul>
              <button className="w-full bg-[#1A3066] hover:bg-[#23428A] text-white px-6 py-4 rounded-xl font-bold transition-all">
                Create Free Account
              </button>
            </div>

            {/* Standard Tier */}
            <div className="bg-[#0D1B3E] border border-[#0033A0] rounded-3xl p-8 flex flex-col relative shadow-[0_0_30px_rgba(0,51,160,0.2)]">
              <h3 className="text-2xl font-bold text-white mb-2">Standard</h3>
              <div className="text-slate-400 mb-6">Unrestricted daily access.</div>
              <div className="mb-8">
                <span className="text-5xl font-black text-white">$19.99</span>
                <span className="text-slate-400 ml-2">/month</span>
                <div className="text-sm text-[#4488FF] mt-2 font-medium">or $149/year flat</div>
              </div>
              <ul className="space-y-4 mb-10 flex-1 text-slate-300">
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" /> <span>Everything daily</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" /> <span>Full edge & EV metrics</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" /> <span>Full grading history</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#4488FF] shrink-0" /> <span>No surprises</span></li>
              </ul>
              <button className="w-full bg-[#0033A0] hover:bg-[#0040CC] text-white px-6 py-4 rounded-xl font-bold transition-all">
                Subscribe to Standard
              </button>
            </div>

            {/* Win-Aligned Tier */}
            <div className="bg-gradient-to-b from-[#112D18] to-[#0D1B3E] border-2 border-[#388E3C] rounded-3xl p-8 flex flex-col relative transform lg:-translate-y-4 shadow-[0_20px_40px_rgba(56,142,60,0.2)]">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#388E3C] text-white px-4 py-1 rounded-full text-xs font-black uppercase tracking-wider">
                Our Hypothesis
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Win-Aligned</h3>
              <div className="text-[#4CAF50] font-medium mb-6">If we drop below breakeven (ROI ≤ 0%), your next month is FREE.</div>
              <div className="mb-8 border-b border-[#388E3C]/30 pb-6">
                <span className="text-5xl font-black text-white">$49</span>
                <span className="text-slate-400 ml-2">base /mo</span>
                <div className="text-sm text-white mt-2 font-bold flex items-center gap-2">
                  <span>+ 5% of your monthly profit</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">(capped at $249/mo total)</div>
              </div>
              <ul className="space-y-4 mb-10 flex-1 text-slate-200 font-medium">
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>Everything in Standard</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>Early pick access</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>Live line movement alerts</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>Dedicated Slack channel</span></li>
                <li className="flex gap-3"><CheckCircle2 className="w-5 h-5 text-[#388E3C] shrink-0" /> <span>Weekly P&L review</span></li>
              </ul>
              
              {/* Interactive Calculator */}
              <div className="bg-[#060D1F]/50 rounded-xl p-4 mb-6 border border-[#388E3C]/20">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Calculator className="w-3 h-3" /> Profit Estimator
                  </label>
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-slate-400">$</span>
                  <input 
                    type="number" 
                    value={profitInput}
                    onChange={(e) => setProfitInput(Number(e.target.value) || 0)}
                    className="w-full bg-[#0D1B3E] border border-[#1A3066] rounded-md px-3 py-2 text-white font-bold focus:outline-none focus:border-[#388E3C]"
                  />
                  <span className="text-xs text-slate-500 whitespace-nowrap">this month</span>
                </div>
                <div className="flex justify-between items-end border-t border-[#388E3C]/20 pt-3">
                  <div className="text-xs text-slate-400">Total owed:</div>
                  <div className="text-xl font-black text-[#4CAF50]">${calculateOwed(profitInput).toFixed(2)}</div>
                </div>
              </div>

              <button className="w-full bg-[#388E3C] hover:bg-[#2E7D32] text-white px-6 py-4 rounded-xl font-bold transition-all shadow-lg">
                Join Win-Aligned
              </button>
            </div>
          </div>

          <div className="mt-16 max-w-2xl mx-auto bg-[#1A3066]/20 border border-[#1A3066] rounded-2xl p-6 flex gap-4">
            <AlertTriangle className="w-6 h-6 text-[#FFC107] shrink-0" />
            <div>
              <h4 className="font-bold text-white mb-1">How the Win-Aligned guarantee works</h4>
              <p className="text-sm text-slate-400 leading-relaxed">
                Our model's performance is completely public. At the end of the month, if the official A/B tier picks have an ROI of 0.0% or worse, every Win-Aligned member automatically receives a 100% credit for their next month's base fee ($49).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#060D1F] border-t border-[#1A3066] py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#1A3066]" />
            <span className="text-lg font-black tracking-tight text-slate-600">SportsMVP</span>
          </div>
          <div className="text-slate-500 text-sm">
            © 2026 SportsMVP. All rights reserved.
          </div>
          <div className="flex gap-6 text-sm font-medium text-slate-500">
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Responsible Gaming</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
