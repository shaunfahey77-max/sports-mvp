export default function Slide02Landscape() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#060D1F" }}>
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #0033A0, #FFC107)" }} />

      <div className="absolute inset-0 pl-[7vw] pr-[6vw] pt-[6vh] pb-[5vh] flex flex-col">
        {/* Header */}
        <div className="mb-[3vh]">
          <div className="font-body font-medium tracking-widest uppercase mb-[0.8vh]" style={{ fontSize: "1.3vw", color: "#FFC107" }}>Market Overview</div>
          <h2 className="font-display font-black tracking-tight" style={{ fontSize: "4vw", color: "#ffffff" }}>The Competitive Landscape</h2>
          <div className="mt-[1vh] w-[8vw] h-[0.25vh]" style={{ background: "#0033A0" }} />
        </div>

        {/* 5 competitor category cards */}
        <div className="flex gap-[2vw] flex-1">
          {/* Card 1 */}
          <div className="flex-1 rounded-xl p-[2vw] flex flex-col" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black mb-[1vh]" style={{ fontSize: "1.4vw", color: "#4488FF" }}>DIMERS PRO</div>
            <div className="font-body font-medium mb-[1.5vh]" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.6)" }}>AI Picks Leader</div>
            <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
              Most mature +EV platform. 22k+ events/yr. Dimebot AI assistant. Discord community.
            </div>
            <div className="mt-auto pt-[1.5vh]" style={{ borderTop: "1px solid #1A3066" }}>
              <span className="font-display font-bold" style={{ fontSize: "1.4vw", color: "#FFC107" }}>$24.99/mo</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="flex-1 rounded-xl p-[2vw] flex flex-col" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black mb-[1vh]" style={{ fontSize: "1.4vw", color: "#4488FF" }}>ZCODE SYSTEM</div>
            <div className="font-body font-medium mb-[1.5vh]" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.6)" }}>Legacy AI Platform</div>
            <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
              Since 1999. 80+ parameters/game. Automated "betting robot." Black-box predictions.
            </div>
            <div className="mt-auto pt-[1.5vh]" style={{ borderTop: "1px solid #1A3066" }}>
              <span className="font-display font-bold" style={{ fontSize: "1.4vw", color: "#FFC107" }}>$198/mo</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="flex-1 rounded-xl p-[2vw] flex flex-col" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black mb-[1vh]" style={{ fontSize: "1.4vw", color: "#4488FF" }}>PICKS WISE / COVERS</div>
            <div className="font-body font-medium mb-[1.5vh]" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.6)" }}>Free Handicappers</div>
            <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
              Expert analyst picks. 30+ yrs experience. All US sports. Zero cost — ad-supported.
            </div>
            <div className="mt-auto pt-[1.5vh]" style={{ borderTop: "1px solid #1A3066" }}>
              <span className="font-display font-bold" style={{ fontSize: "1.4vw", color: "#388E3C" }}>Free</span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="flex-1 rounded-xl p-[2vw] flex flex-col" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black mb-[1vh]" style={{ fontSize: "1.4vw", color: "#4488FF" }}>WAGERTALK</div>
            <div className="font-body font-medium mb-[1.5vh]" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.6)" }}>Handicapper Marketplace</div>
            <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
              Per-pick or all-access. Human analysts. No model transparency. Premium pricing.
            </div>
            <div className="mt-auto pt-[1.5vh]" style={{ borderTop: "1px solid #1A3066" }}>
              <span className="font-display font-bold" style={{ fontSize: "1.4vw", color: "#FFC107" }}>$299/mo</span>
            </div>
          </div>

          {/* Card 5 - us */}
          <div className="flex-1 rounded-xl p-[2vw] flex flex-col" style={{ background: "linear-gradient(135deg, #0D1B3E, #112454)", border: "2px solid #0033A0", boxShadow: "0 0 30px rgba(0,51,160,0.2)" }}>
            <div className="flex items-center gap-[0.5vw] mb-[1vh]">
              <div className="font-display font-black" style={{ fontSize: "1.4vw", color: "#FFC107" }}>SPORTSMVP</div>
              <div className="font-body font-bold px-[0.5vw] rounded" style={{ fontSize: "0.9vw", background: "#FFC107", color: "#060D1F" }}>YOU</div>
            </div>
            <div className="font-body font-medium mb-[1.5vh]" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.6)" }}>Calibrated ML, NBA+NHL</div>
            <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
              EV + edge + CLV visible. Tier grading A/B/C. Parlay builder. Real-time odds.
            </div>
            <div className="mt-auto pt-[1.5vh]" style={{ borderTop: "1px solid #0033A0" }}>
              <span className="font-display font-bold" style={{ fontSize: "1.4vw", color: "#FFC107" }}>$19.99/mo</span>
            </div>
          </div>
        </div>

        {/* Bottom caption */}
        <div className="mt-[2vh] font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.3)" }}>
          Source: dimers.com, zcode.com, wagertalk.com, pickswise.com, covers.com — April 2026
        </div>
      </div>
    </div>
  );
}
