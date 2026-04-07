export default function Slide01Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #060D1F 0%, #0D1B3E 50%, #060D1F 100%)" }}>
      {/* Background grid lines */}
      <div className="absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(0,51,160,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,51,160,0.08) 1px, transparent 1px)",
        backgroundSize: "6vw 6vw"
      }} />

      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #FFC107, #0033A0)" }} />

      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-[0.15vh]" style={{ background: "linear-gradient(to right, #FFC107, transparent)" }} />

      {/* Main content — left-aligned */}
      <div className="absolute inset-0 flex flex-col justify-center pl-[8vw] pr-[10vw]">
        <div className="mb-[2vh]">
          <span className="font-body text-[1.5vw] font-medium tracking-[0.3em] uppercase" style={{ color: "#FFC107" }}>
            April 2026 — Competitive Intelligence
          </span>
        </div>

        <h1 className="font-display font-black tracking-tight leading-none mb-[1.5vh]" style={{ fontSize: "7vw", color: "#ffffff" }}>
          Bet Like an MVP.
        </h1>
        <h2 className="font-display font-bold tracking-tight" style={{ fontSize: "3.5vw", color: "#4488FF" }}>
          Where We Stand.
        </h2>

        <div className="mt-[4vh] w-[12vw] h-[0.3vh]" style={{ background: "#FFC107" }} />

        <p className="font-body font-light mt-[3vh] leading-relaxed" style={{ fontSize: "1.8vw", color: "rgba(255,255,255,0.55)", maxWidth: "45vw" }}>
          SportsMVP vs. the AI-powered sports betting prediction landscape — NBA and NHL — April 2026
        </p>

        {/* Bottom stat row */}
        <div className="flex gap-[6vw] mt-[6vh]">
          <div>
            <div className="font-display font-black" style={{ fontSize: "3.5vw", color: "#388E3C" }}>5</div>
            <div className="font-body font-medium" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.45)", letterSpacing: "0.1em" }}>COMPETITORS ANALYZED</div>
          </div>
          <div>
            <div className="font-display font-black" style={{ fontSize: "3.5vw", color: "#388E3C" }}>12</div>
            <div className="font-body font-medium" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.45)", letterSpacing: "0.1em" }}>FEATURES COMPARED</div>
          </div>
          <div>
            <div className="font-display font-black" style={{ fontSize: "3.5vw", color: "#FFC107" }}>3</div>
            <div className="font-body font-medium" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.45)", letterSpacing: "0.1em" }}>STRATEGIC ACTIONS</div>
          </div>
        </div>
      </div>

      {/* Right — large decorative "S" lettermark */}
      <div className="absolute right-[5vw] top-1/2 -translate-y-1/2 font-display font-black select-none pointer-events-none" style={{ fontSize: "35vw", color: "rgba(0,51,160,0.06)", lineHeight: 1 }}>
        S
      </div>

      {/* Bottom right label */}
      <div className="absolute bottom-[3vh] right-[4vw] font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.2)" }}>
        sportsmvp.net
      </div>
    </div>
  );
}
