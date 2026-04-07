export default function Slide07ActionPlan() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#060D1F" }}>
      {/* Background grid */}
      <div className="absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(0,51,160,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,51,160,0.06) 1px, transparent 1px)",
        backgroundSize: "6vw 6vw"
      }} />
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #FFC107, #0033A0)" }} />

      <div className="absolute inset-0 pl-[7vw] pr-[6vw] pt-[6vh] pb-[5vh] flex flex-col">
        {/* Header */}
        <div className="mb-[4vh]">
          <div className="font-body font-medium tracking-widest uppercase mb-[0.6vh]" style={{ fontSize: "1.3vw", color: "#FFC107" }}>Strategic Recommendations</div>
          <h2 className="font-display font-black tracking-tight" style={{ fontSize: "3.8vw", color: "#ffffff" }}>Three Actions to Win</h2>
          <div className="mt-[0.8vh] w-[8vw] h-[0.25vh]" style={{ background: "#FFC107" }} />
        </div>

        {/* Three recommendation cards stacked */}
        <div className="flex flex-col gap-[2.5vh] flex-1 justify-center">
          {/* Action 1 */}
          <div className="flex items-start gap-[3vw] rounded-xl p-[2.5vw]" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black shrink-0" style={{ fontSize: "5vw", color: "rgba(255,193,7,0.2)", lineHeight: 1 }}>01</div>
            <div>
              <div className="font-display font-black mb-[0.8vh]" style={{ fontSize: "2vw", color: "#FFC107" }}>Own "Methodology Transparency" — It's Uncontested</div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
                Dimers reviews cite "no verifiable track record" as their top complaint. ZCode is a black box. Publish your Brier score, EV formula, and calibration curve prominently. Make the math the message — it converts analytically-minded bettors who distrust black boxes.
              </div>
            </div>
          </div>

          {/* Action 2 */}
          <div className="flex items-start gap-[3vw] rounded-xl p-[2.5vw]" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black shrink-0" style={{ fontSize: "5vw", color: "rgba(68,136,255,0.2)", lineHeight: 1 }}>02</div>
            <div>
              <div className="font-display font-black mb-[0.8vh]" style={{ fontSize: "2vw", color: "#4488FF" }}>Price-Anchor Against ZCode and WagerTalk</div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
                "$19.99 vs. $198 — with more transparency" is a 10x value proposition. ZCode and WagerTalk users are price-sensitive but don't know better alternatives exist. Run paid ads targeting "[ZCode alternative]" and "[sports betting picks subscription]" keywords.
              </div>
            </div>
          </div>

          {/* Action 3 */}
          <div className="flex items-start gap-[3vw] rounded-xl p-[2.5vw]" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
            <div className="font-display font-black shrink-0" style={{ fontSize: "5vw", color: "rgba(56,142,60,0.2)", lineHeight: 1 }}>03</div>
            <div>
              <div className="font-display font-black mb-[0.8vh]" style={{ fontSize: "2vw", color: "#388E3C" }}>Lean Into NBA + NHL Depth as a Feature</div>
              <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.7)", lineHeight: 1.6 }}>
                Dimers covers 22k+ events across 12+ sports — it's generalist. SportsMVP covers 2 sports deeply. Reframe narrow focus as "fewer sports, better picks" — dedicated basketball and hockey bettors want a specialist, not a generalist.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-[2vh]" style={{ borderTop: "1px solid #1A3066", paddingTop: "2vh" }}>
          <div className="font-display font-black" style={{ fontSize: "1.8vw", color: "#FFC107" }}>sportsmvp.net</div>
          <div className="font-body font-medium" style={{ fontSize: "1.3vw", color: "rgba(255,255,255,0.35)" }}>Bet Like an MVP. — April 2026</div>
        </div>
      </div>
    </div>
  );
}
