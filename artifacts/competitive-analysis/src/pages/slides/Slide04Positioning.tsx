export default function Slide04Positioning() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#0D1B3E" }}>
      {/* Background gradient */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 70% 50%, rgba(0,51,160,0.15) 0%, transparent 65%)" }} />
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #FFC107, #0033A0)" }} />

      <div className="absolute inset-0 pl-[7vw] pr-[6vw] pt-[6vh] pb-[5vh] flex flex-col">
        {/* Header */}
        <div className="mb-[3vh]">
          <div className="font-body font-medium tracking-widest uppercase mb-[0.6vh]" style={{ fontSize: "1.3vw", color: "#FFC107" }}>Positioning Map</div>
          <h2 className="font-display font-black tracking-tight" style={{ fontSize: "3.8vw", color: "#ffffff" }}>Transparency vs. Breadth</h2>
          <div className="mt-[0.8vh] w-[8vw] h-[0.25vh]" style={{ background: "#0033A0" }} />
        </div>

        <div className="flex gap-[5vw] flex-1">
          {/* 2x2 Positioning chart */}
          <div className="flex-1 relative" style={{ maxWidth: "55vw" }}>
            {/* Y-axis label */}
            <div className="absolute font-body font-medium tracking-widest uppercase" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.4)", left: "-1vw", top: "50%", transform: "rotate(-90deg) translateX(-50%)", transformOrigin: "center", whiteSpace: "nowrap" }}>
              MODEL TRANSPARENCY
            </div>
            {/* X-axis label */}
            <div className="absolute font-body font-medium tracking-widest uppercase text-center w-full" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.4)", bottom: "-2vh", left: 0 }}>
              SPORTS COVERAGE BREADTH
            </div>

            {/* Chart area */}
            <div className="relative h-[58vh] ml-[4vw]" style={{ border: "1px solid rgba(26,48,102,0.8)" }}>
              {/* Quadrant lines */}
              <div className="absolute top-0 bottom-0 left-1/2" style={{ width: "1px", background: "rgba(26,48,102,0.6)" }} />
              <div className="absolute left-0 right-0 top-1/2" style={{ height: "1px", background: "rgba(26,48,102,0.6)" }} />

              {/* Quadrant labels */}
              <div className="absolute font-body font-medium" style={{ fontSize: "1vw", color: "rgba(255,255,255,0.2)", top: "2vh", left: "2vw" }}>High Transparency / Narrow</div>
              <div className="absolute font-body font-medium" style={{ fontSize: "1vw", color: "rgba(255,255,255,0.2)", top: "2vh", right: "2vw" }}>High Transparency / Broad</div>
              <div className="absolute font-body font-medium" style={{ fontSize: "1vw", color: "rgba(255,255,255,0.2)", bottom: "2vh", left: "2vw" }}>Black-box / Narrow</div>
              <div className="absolute font-body font-medium" style={{ fontSize: "1vw", color: "rgba(255,255,255,0.2)", bottom: "2vh", right: "2vw" }}>Black-box / Broad</div>

              {/* Dimers — high transparency, very broad */}
              <div className="absolute" style={{ right: "15%", top: "18%" }}>
                <div className="font-body font-bold text-center" style={{ fontSize: "1.2vw", color: "#4488FF" }}>Dimers</div>
                <div className="w-[1.2vw] h-[1.2vw] rounded-full mx-auto mt-[0.4vh]" style={{ background: "#4488FF" }} />
              </div>

              {/* ZCode — medium transparency, medium breadth */}
              <div className="absolute" style={{ right: "38%", bottom: "30%" }}>
                <div className="font-body font-bold text-center" style={{ fontSize: "1.2vw", color: "#8899BB" }}>ZCode</div>
                <div className="w-[1.2vw] h-[1.2vw] rounded-full mx-auto mt-[0.4vh]" style={{ background: "#8899BB" }} />
              </div>

              {/* Pickswise — low transparency, very broad */}
              <div className="absolute" style={{ right: "10%", bottom: "18%" }}>
                <div className="font-body font-bold text-center" style={{ fontSize: "1.2vw", color: "#8899BB" }}>Pickswise</div>
                <div className="w-[1.2vw] h-[1.2vw] rounded-full mx-auto mt-[0.4vh]" style={{ background: "#8899BB" }} />
              </div>

              {/* WagerTalk — low transparency, medium breadth */}
              <div className="absolute" style={{ right: "28%", bottom: "22%" }}>
                <div className="font-body font-bold text-center" style={{ fontSize: "1.2vw", color: "#8899BB" }}>WagerTalk</div>
                <div className="w-[1.2vw] h-[1.2vw] rounded-full mx-auto mt-[0.4vh]" style={{ background: "#8899BB" }} />
              </div>

              {/* SportsMVP — high transparency, focused */}
              <div className="absolute" style={{ left: "20%", top: "15%" }}>
                <div className="px-[1vw] py-[0.6vh] rounded-lg font-display font-black" style={{ background: "#0033A0", border: "2px solid #FFC107", fontSize: "1.2vw", color: "#FFC107", boxShadow: "0 0 20px rgba(255,193,7,0.3)" }}>SportsMVP</div>
                <div className="w-[1.2vw] h-[1.2vw] rounded-full mx-auto mt-[0.4vh]" style={{ background: "#FFC107" }} />
              </div>

              {/* Axes arrows */}
              <div className="absolute font-body font-bold" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)", top: "1vh", left: "50%", transform: "translateX(-50%)" }}>HIGH</div>
              <div className="absolute font-body font-bold" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)", bottom: "1vh", left: "50%", transform: "translateX(-50%)" }}>LOW</div>
              <div className="absolute font-body font-bold" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)", left: "1vw", top: "50%", transform: "translateY(-50%)" }}>NARROW</div>
              <div className="absolute font-body font-bold" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)", right: "1vw", top: "50%", transform: "translateY(-50%)" }}>BROAD</div>
            </div>
          </div>

          {/* Right — insight callout */}
          <div className="flex flex-col justify-center gap-[3vh]" style={{ width: "28vw" }}>
            <div className="rounded-xl p-[2vw]" style={{ background: "rgba(0,51,160,0.15)", border: "1px solid #0033A0" }}>
              <div className="font-display font-black mb-[1vh]" style={{ fontSize: "1.6vw", color: "#FFC107" }}>Our Position</div>
              <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>
                High transparency, focused depth. We win on showing the math — not just the pick.
              </div>
            </div>

            <div className="rounded-xl p-[2vw]" style={{ background: "#0D1B3E", border: "1px solid #1A3066" }}>
              <div className="font-display font-black mb-[1vh]" style={{ fontSize: "1.6vw", color: "#4488FF" }}>The Gap</div>
              <div className="font-body" style={{ fontSize: "1.4vw", color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>
                No one combines transparent methodology with focused NBA/NHL depth at an affordable price.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
