export default function Slide05WhiteSpace() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#060D1F" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% 60%, rgba(56,142,60,0.08) 0%, transparent 60%)" }} />
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #388E3C, #0033A0)" }} />

      <div className="absolute inset-0 pl-[7vw] pr-[6vw] pt-[6vh] pb-[5vh] flex flex-col">
        {/* Header */}
        <div className="mb-[3vh]">
          <div className="font-body font-medium tracking-widest uppercase mb-[0.6vh]" style={{ fontSize: "1.3vw", color: "#388E3C" }}>Opportunity Analysis</div>
          <h2 className="font-display font-black tracking-tight" style={{ fontSize: "3.8vw", color: "#ffffff" }}>Where the Market Falls Short</h2>
          <div className="mt-[0.8vh] w-[8vw] h-[0.25vh]" style={{ background: "#388E3C" }} />
        </div>

        {/* 2x2 opportunity grid */}
        <div className="grid gap-[2vw] flex-1" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          {/* Opportunity 1 */}
          <div className="rounded-xl p-[2.5vw] flex flex-col justify-between" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div>
              <div className="flex items-center gap-[1vw] mb-[1.5vh]">
                <div className="w-[0.5vw] h-[4vh] rounded-full" style={{ background: "#388E3C" }} />
                <div className="font-display font-black" style={{ fontSize: "1.8vw", color: "#388E3C" }}>CLV Tracking — Rare</div>
              </div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.65 }}>
                Only SportsMVP and Dimers track closing line value. CLV is the gold standard for long-term pick quality measurement — but most sites ignore it.
              </div>
            </div>
            <div className="font-body font-medium" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.4)" }}>
              Advantage: Lead with CLV in marketing
            </div>
          </div>

          {/* Opportunity 2 */}
          <div className="rounded-xl p-[2.5vw] flex flex-col justify-between" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div>
              <div className="flex items-center gap-[1vw] mb-[1.5vh]">
                <div className="w-[0.5vw] h-[4vh] rounded-full" style={{ background: "#FFC107" }} />
                <div className="font-display font-black" style={{ fontSize: "1.8vw", color: "#FFC107" }}>Methodology Transparency</div>
              </div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.65 }}>
                Dimers publishes picks — not formulas. ZCode is a black box. Serious bettors want to see the model. SportsMVP shows EV formula, Brier score, and edge math.
              </div>
            </div>
            <div className="font-body font-medium" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.4)" }}>
              Advantage: Trust play for analytically-minded bettors
            </div>
          </div>

          {/* Opportunity 3 */}
          <div className="rounded-xl p-[2.5vw] flex flex-col justify-between" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div>
              <div className="flex items-center gap-[1vw] mb-[1.5vh]">
                <div className="w-[0.5vw] h-[4vh] rounded-full" style={{ background: "#4488FF" }} />
                <div className="font-display font-black" style={{ fontSize: "1.8vw", color: "#4488FF" }}>NBA + NHL Focus</div>
              </div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.65 }}>
                Most competitors chase all sports. SportsMVP is intentionally narrow — better models for fewer markets beats mediocre models for dozens.
              </div>
            </div>
            <div className="font-body font-medium" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.4)" }}>
              Advantage: Depth beats breadth in niche bettors' eyes
            </div>
          </div>

          {/* Opportunity 4 */}
          <div className="rounded-xl p-[2.5vw] flex flex-col justify-between" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div>
              <div className="flex items-center gap-[1vw] mb-[1.5vh]">
                <div className="w-[0.5vw] h-[4vh] rounded-full" style={{ background: "#D32F2F" }} />
                <div className="font-display font-black" style={{ fontSize: "1.8vw", color: "#D32F2F" }}>Competitor Pricing Gaps</div>
              </div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.75)", lineHeight: 1.65 }}>
                ZCode charges $198/mo. WagerTalk $299/mo. Both are black boxes. SportsMVP at $19.99/mo with full transparency is 10x cheaper with more insight.
              </div>
            </div>
            <div className="font-body font-medium" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.4)" }}>
              Advantage: Dominant value proposition on price + quality
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
