import React, { useState } from "react";
import { Star, Shield, Crown, ChevronRight, Lock, TrendingUp, Zap, Clock, Users, Check, AlertCircle } from "lucide-react";

export function InsideEdge() {
  return (
    <div className="min-h-screen bg-[#060D1F] text-white selection:bg-[#FFC107] selection:text-[#060D1F]">
      {/* Texture Overlay */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay z-50" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>

      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-[#FFC107]/20 bg-[#060D1F]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FFC107] to-[#B38700] flex items-center justify-center shadow-[0_0_15px_rgba(255,193,7,0.3)]">
              <Crown size={20} className="text-[#060D1F] fill-[#060D1F]" />
            </div>
            <span className="text-xl font-['Playfair_Display'] font-bold tracking-wide text-white">The Inside Edge</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#methodology" className="text-sm font-medium text-white/70 hover:text-[#FFC107] transition-colors">Methodology</a>
            <a href="#performance" className="text-sm font-medium text-white/70 hover:text-[#FFC107] transition-colors">Performance</a>
            <a href="#membership" className="text-sm font-medium text-white/70 hover:text-[#FFC107] transition-colors">Membership</a>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-sm font-medium text-white/70 hover:text-white transition-colors">Member Login</button>
            <button className="text-sm font-bold bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F] px-5 py-2.5 rounded-sm transition-colors uppercase tracking-wider">Apply for Access</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-24 pb-32 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#060D1F]/80 to-[#060D1F] z-10" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#060D1F] via-transparent to-[#060D1F] z-10" />
          <img src="/__mockup/images/inside-edge-hero.png" alt="Exclusive members club" className="w-full h-full object-cover opacity-40" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#FFC107]/30 bg-[#FFC107]/5 mb-6">
              <Shield size={14} className="text-[#FFC107]" />
              <span className="text-xs font-bold text-[#FFC107] uppercase tracking-widest">Invitation-Only Model</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-['Playfair_Display'] font-bold leading-tight mb-6">
              The unfair advantage, <span className="italic text-[#FFC107]">reserved for the few.</span>
            </h1>
            
            <p className="text-xl text-white/70 mb-10 leading-relaxed max-w-2xl font-light">
              We don't sell picks to the public. We provide calibrated, machine-learning driven market edges to an exclusive syndicate of serious bettors. Our members beat the closing line by 3.2pts on average.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-[#FFC107] to-[#B38700] hover:from-[#FFD54F] hover:to-[#FFC107] text-[#060D1F] font-bold uppercase tracking-widest text-sm transition-all shadow-[0_0_30px_rgba(255,193,7,0.2)] hover:shadow-[0_0_40px_rgba(255,193,7,0.4)] flex items-center justify-center gap-2">
                View Membership Tiers <ChevronRight size={16} />
              </button>
              <span className="flex items-center gap-2 text-sm text-white/50">
                <Users size={16} className="text-[#FFC107]" />
                Currently <strong className="text-white">2,847</strong> active members
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Top Pick / Sample Card */}
      <section className="py-20 bg-[#0D1B3E] border-y border-[#FFC107]/10 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row gap-12 items-center">
            <div className="lg:w-1/2">
              <div className="text-[#FFC107] text-xs font-bold tracking-widest uppercase mb-3 flex items-center gap-2">
                <Lock size={14} /> Unlocked Preview
              </div>
              <h2 className="text-4xl font-['Playfair_Display'] font-bold mb-6">A glimpse inside the vault.</h2>
              <p className="text-white/60 mb-8 leading-relaxed font-light text-lg">
                While our Inner Circle gets lines the moment they are identified, we occasionally release a delayed look at our proprietary model's output. This is the caliber of data our members use daily.
              </p>
              
              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="border-l-2 border-[#FFC107] pl-4">
                  <div className="text-3xl font-['Playfair_Display'] text-white">4.2%</div>
                  <div className="text-sm text-white/50 uppercase tracking-wide">Avg Model Edge</div>
                </div>
                <div className="border-l-2 border-[#FFC107] pl-4">
                  <div className="text-3xl font-['Playfair_Display'] text-white">24/7</div>
                  <div className="text-sm text-white/50 uppercase tracking-wide">Market Surveillance</div>
                </div>
              </div>
            </div>

            <div className="lg:w-1/2 w-full">
              {/* Pick Card */}
              <div className="bg-[#060D1F] border border-[#FFC107]/30 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#FFC107]/5 rounded-bl-full pointer-events-none" />
                
                <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-6">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-[#FFC107] text-[#060D1F] text-xs font-bold uppercase tracking-widest">Tier A</span>
                    <span className="text-white/50 text-sm">NBA Spread</span>
                  </div>
                  <span className="text-[#388E3C] font-mono text-sm flex items-center gap-1">
                    <TrendingUp size={14} /> +6.8% EV
                  </span>
                </div>

                <div className="flex items-center justify-between mb-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-[#0D1B3E] border border-white/10 rounded flex items-center justify-center font-bold text-white/40">MIL</div>
                    <span className="text-xl text-white/40 font-['Playfair_Display'] italic">at</span>
                    <div className="w-12 h-12 bg-[#FFC107]/10 border border-[#FFC107]/30 rounded flex items-center justify-center font-bold text-white">CHI</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-white/50 uppercase tracking-wide mb-1">Our Play</div>
                    <div className="text-2xl font-bold">CHI +4.5 <span className="text-[#FFC107] font-normal">-110</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 bg-[#0D1B3E] p-4 rounded-sm border border-white/5">
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Market Prob</div>
                    <div className="text-lg font-mono">52.4%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Model Prob</div>
                    <div className="text-lg font-mono text-[#FFC107]">58.2%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">True Edge</div>
                    <div className="text-lg font-mono text-[#388E3C]">+5.8%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Methodology */}
      <section id="methodology" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-4xl font-['Playfair_Display'] font-bold mb-4">The Methodology</h2>
            <p className="text-white/50 font-light text-lg">We don't rely on gut feelings. Our edge is derived from a rigorous, three-stage mathematical pipeline.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Global Snapshots",
                desc: "Our infrastructure ingests odds from every major global and US sportsbook every 10 seconds, identifying market inefficiencies the moment they open.",
                icon: Zap
              },
              {
                step: "02",
                title: "Algorithmic Scoring",
                desc: "Proprietary ML models regress historical data against current lines to compute true probability, expected value (EV), and raw edge over the market.",
                icon: TrendingUp
              },
              {
                step: "03",
                title: "Tiered Grading",
                desc: "Picks are synthesized and graded. Only those passing strict variance thresholds earn our 'Tier A' designation and are pushed to the Inner Circle.",
                icon: Shield
              }
            ].map((item, i) => (
              <div key={i} className="p-8 border border-white/10 bg-[#0D1B3E]/50 hover:bg-[#0D1B3E] hover:border-[#FFC107]/30 transition-all group">
                <div className="flex justify-between items-start mb-8">
                  <item.icon size={24} className="text-[#FFC107] group-hover:scale-110 transition-transform" />
                  <span className="text-4xl font-['Playfair_Display'] font-bold text-white/10">{item.step}</span>
                </div>
                <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Performance */}
      <section id="performance" className="py-20 bg-[#FFC107] text-[#060D1F]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center mb-12">
            <div>
              <h2 className="text-4xl font-['Playfair_Display'] font-bold mb-2">Track Record</h2>
              <p className="text-[#060D1F]/70 font-medium">Verified performance across all Tier A releases.</p>
            </div>
            <div className="mt-4 md:mt-0 px-4 py-2 border border-[#060D1F]/20 rounded-full text-sm font-bold uppercase tracking-widest flex items-center gap-2">
              <Check size={16} /> Fully Transparent
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <div className="text-5xl font-['Playfair_Display'] font-black mb-1">62.4%</div>
              <div className="text-sm font-bold uppercase tracking-widest opacity-70">Win Rate</div>
            </div>
            <div>
              <div className="text-5xl font-['Playfair_Display'] font-black mb-1">+28.1%</div>
              <div className="text-sm font-bold uppercase tracking-widest opacity-70">Verified ROI</div>
            </div>
            <div>
              <div className="text-5xl font-['Playfair_Display'] font-black mb-1">+184</div>
              <div className="text-sm font-bold uppercase tracking-widest opacity-70">Units Won</div>
            </div>
            <div>
              <div className="text-5xl font-['Playfair_Display'] font-black mb-1">+5.2%</div>
              <div className="text-sm font-bold uppercase tracking-widest opacity-70">Avg EV / Pick</div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing / Membership */}
      <section id="membership" className="py-32 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/20 bg-white/5 mb-4 text-xs font-bold uppercase tracking-widest">
              Access Tiers
            </div>
            <h2 className="text-4xl md:text-5xl font-['Playfair_Display'] font-bold mb-6">Select your status.</h2>
            <p className="text-white/60 font-light text-lg">We strictly limit membership to protect our lines from market movement. Choose the level of access that matches your ambition.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {/* Free Tier */}
            <div className="p-8 border border-white/10 bg-[#0D1B3E] flex flex-col">
              <h3 className="text-2xl font-['Playfair_Display'] font-bold text-white mb-2">Guest Pass</h3>
              <div className="text-white/40 text-sm mb-6 h-10">For those wanting to observe before committing.</div>
              <div className="text-4xl font-bold mb-8">Complimentary</div>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-sm text-white/70">
                  <Clock size={18} className="text-white/40 shrink-0" />
                  <span>1 preview pick per week (delayed 30 mins)</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/70">
                  <Check size={18} className="text-white/40 shrink-0" />
                  <span>Watermarked analysis cards</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/70 opacity-50">
                  <AlertCircle size={18} className="text-white/40 shrink-0" />
                  <span>No Discord access</span>
                </li>
              </ul>
              
              <button className="w-full py-3 border border-white/20 hover:bg-white/5 text-white font-bold uppercase tracking-widest text-sm transition-colors">
                Request Guest Pass
              </button>
            </div>

            {/* Paid Tier */}
            <div className="p-8 border border-[#FFC107]/50 bg-gradient-to-b from-[#112454] to-[#0D1B3E] relative transform lg:-translate-y-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#FFC107] text-[#060D1F] px-4 py-1 text-xs font-bold uppercase tracking-widest">
                Standard Access
              </div>
              <h3 className="text-2xl font-['Playfair_Display'] font-bold text-[#FFC107] mb-2">Members</h3>
              <div className="text-white/60 text-sm mb-6 h-10">Full access to our quantitative models and community.</div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-4xl font-bold">$49</span>
                <span className="text-white/50">/ mo</span>
              </div>
              <div className="text-sm text-[#FFC107] mb-8 font-medium">Or $399 billed annually</div>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-sm text-white/90">
                  <Check size={18} className="text-[#FFC107] shrink-0" />
                  <span>Full daily slate of Tier A/B/C picks</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/90">
                  <Check size={18} className="text-[#FFC107] shrink-0" />
                  <span>Real-time delivery via platform</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/90">
                  <Check size={18} className="text-[#FFC107] shrink-0" />
                  <span>Access to Members-Only Discord</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/90">
                  <Check size={18} className="text-[#FFC107] shrink-0" />
                  <span>Weekly state-of-the-model briefs</span>
                </li>
              </ul>
              
              <button className="w-full py-4 bg-[#FFC107] hover:bg-[#FFD54F] text-[#060D1F] font-bold uppercase tracking-widest text-sm transition-colors">
                Join The Club
              </button>
            </div>

            {/* Ultra Premium Tier */}
            <div className="p-8 border border-white/10 bg-[#060D1F] relative overflow-hidden flex flex-col">
              <div className="absolute top-0 right-0 w-40 h-40 bg-[#FFC107]/5 rounded-bl-full pointer-events-none" />
              
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-2xl font-['Playfair_Display'] font-bold text-white">Inner Circle</h3>
                <div className="flex items-center gap-1 text-xs text-[#FFC107]">
                  <Users size={12} /> <span className="font-bold">7 Seats Left</span>
                </div>
              </div>
              
              <div className="text-white/40 text-sm mb-6 h-10">The absolute pinnacle. Unrivaled speed and access.</div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-4xl font-bold">$199</span>
                <span className="text-white/50">/ mo</span>
              </div>
              <div className="text-sm text-white/40 mb-8 font-medium">Or $1,799 billed annually</div>
              
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-start gap-3 text-sm text-white/90 font-medium">
                  <Crown size={18} className="text-white shrink-0" />
                  <span>15-minute early access on EVERY pick</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/70">
                  <Check size={18} className="text-white/50 shrink-0" />
                  <span>Custom SMS/Email alerts the second lines publish</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/70">
                  <Check size={18} className="text-white/50 shrink-0" />
                  <span>Private Inner Circle Discord channel</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/70">
                  <Check size={18} className="text-white/50 shrink-0" />
                  <span>Monthly 1-on-1 strategy call with Head Modeler</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-white/70">
                  <Check size={18} className="text-white/50 shrink-0" />
                  <span>White-glove onboarding</span>
                </li>
              </ul>
              
              <button className="w-full py-3 border border-white hover:bg-white hover:text-[#060D1F] text-white font-bold uppercase tracking-widest text-sm transition-colors">
                Apply For Inner Circle
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#060D1F] pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between items-center mb-12">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#FFC107] flex items-center justify-center">
                <Crown size={16} className="text-[#060D1F] fill-[#060D1F]" />
              </div>
              <span className="text-lg font-['Playfair_Display'] font-bold text-white">The Inside Edge</span>
            </div>
            <div className="flex gap-6 text-sm text-white/40">
              <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            </div>
          </div>
          <div className="text-center text-white/30 text-xs">
            &copy; 2026 SportsMVP Syndicate. All rights reserved. Information is for entertainment purposes only.
          </div>
        </div>
      </footer>
    </div>
  );
}
