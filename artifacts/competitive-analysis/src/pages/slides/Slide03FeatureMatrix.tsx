function Check() {
  return <span style={{ color: "#388E3C", fontSize: "1.6vw", fontWeight: 700 }}>✓</span>;
}
function Cross() {
  return <span style={{ color: "#D32F2F", fontSize: "1.6vw", fontWeight: 700 }}>✗</span>;
}
function Partial() {
  return <span style={{ color: "#FFC107", fontSize: "1.6vw", fontWeight: 700 }}>~</span>;
}

export default function Slide03FeatureMatrix() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#060D1F" }}>
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #FFC107, #0033A0)" }} />

      <div className="absolute inset-0 pl-[7vw] pr-[6vw] pt-[5vh] pb-[4vh] flex flex-col">
        {/* Header */}
        <div className="mb-[2.5vh]">
          <div className="font-body font-medium tracking-widest uppercase mb-[0.6vh]" style={{ fontSize: "1.3vw", color: "#FFC107" }}>Head-to-Head</div>
          <h2 className="font-display font-black tracking-tight" style={{ fontSize: "3.8vw", color: "#ffffff" }}>Feature Matrix</h2>
          <div className="flex items-center gap-[2vw] mt-[0.8vh]">
            <div className="flex items-center gap-[0.5vw]"><Check /><span className="font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>Full</span></div>
            <div className="flex items-center gap-[0.5vw]"><Partial /><span className="font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>Partial</span></div>
            <div className="flex items-center gap-[0.5vw]"><Cross /><span className="font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>None</span></div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden rounded-xl" style={{ border: "1px solid #1A3066" }}>
          {/* Header row */}
          <div className="grid font-display font-bold text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", background: "#0D1B3E", borderBottom: "1px solid #1A3066" }}>
            <div className="text-left px-[1.5vw] py-[1.4vh]" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.5)" }}>Feature</div>
            <div className="py-[1.4vh]" style={{ fontSize: "1.2vw", color: "#FFC107", background: "rgba(0,51,160,0.3)" }}>SportsMVP</div>
            <div className="py-[1.4vh]" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.7)" }}>Dimers</div>
            <div className="py-[1.4vh]" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.7)" }}>ZCode</div>
            <div className="py-[1.4vh]" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.7)" }}>Pickswise</div>
            <div className="py-[1.4vh]" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.7)" }}>WagerTalk</div>
          </div>

          {/* Row 1 */}
          <div className="grid text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", borderBottom: "1px solid rgba(26,48,102,0.5)" }}>
            <div className="text-left px-[1.5vw] py-[1.2vh] font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.85)" }}>+EV / Edge Shown</div>
            <div className="py-[1.2vh]" style={{ background: "rgba(0,51,160,0.1)" }}><Check /></div>
            <div className="py-[1.2vh]"><Check /></div>
            <div className="py-[1.2vh]"><Partial /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
          </div>

          {/* Row 2 */}
          <div className="grid text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", borderBottom: "1px solid rgba(26,48,102,0.5)", background: "rgba(13,27,62,0.3)" }}>
            <div className="text-left px-[1.5vw] py-[1.2vh] font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.85)" }}>Calibrated ML Model</div>
            <div className="py-[1.2vh]" style={{ background: "rgba(0,51,160,0.1)" }}><Check /></div>
            <div className="py-[1.2vh]"><Check /></div>
            <div className="py-[1.2vh]"><Check /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
          </div>

          {/* Row 3 */}
          <div className="grid text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", borderBottom: "1px solid rgba(26,48,102,0.5)" }}>
            <div className="text-left px-[1.5vw] py-[1.2vh] font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.85)" }}>CLV Tracking</div>
            <div className="py-[1.2vh]" style={{ background: "rgba(0,51,160,0.1)" }}><Check /></div>
            <div className="py-[1.2vh]"><Partial /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
          </div>

          {/* Row 4 */}
          <div className="grid text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", borderBottom: "1px solid rgba(26,48,102,0.5)", background: "rgba(13,27,62,0.3)" }}>
            <div className="text-left px-[1.5vw] py-[1.2vh] font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.85)" }}>Transparent Methodology</div>
            <div className="py-[1.2vh]" style={{ background: "rgba(0,51,160,0.1)" }}><Check /></div>
            <div className="py-[1.2vh]"><Partial /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
          </div>

          {/* Row 5 */}
          <div className="grid text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", borderBottom: "1px solid rgba(26,48,102,0.5)" }}>
            <div className="text-left px-[1.5vw] py-[1.2vh] font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.85)" }}>Parlay Builder</div>
            <div className="py-[1.2vh]" style={{ background: "rgba(0,51,160,0.1)" }}><Check /></div>
            <div className="py-[1.2vh]"><Check /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Cross /></div>
          </div>

          {/* Row 6 */}
          <div className="grid text-center" style={{ gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr 1fr", background: "rgba(13,27,62,0.3)" }}>
            <div className="text-left px-[1.5vw] py-[1.2vh] font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.85)" }}>Affordable Entry Tier</div>
            <div className="py-[1.2vh]" style={{ background: "rgba(0,51,160,0.1)" }}><Check /></div>
            <div className="py-[1.2vh]"><Check /></div>
            <div className="py-[1.2vh]"><Cross /></div>
            <div className="py-[1.2vh]"><Check /></div>
            <div className="py-[1.2vh]"><Cross /></div>
          </div>
        </div>

        <div className="mt-[1.5vh] font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.3)" }}>
          Based on public product pages and published documentation — April 2026
        </div>
      </div>
    </div>
  );
}
