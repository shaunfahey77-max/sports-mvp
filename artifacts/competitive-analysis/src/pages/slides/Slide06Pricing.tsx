export default function Slide06Pricing() {
  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#0D1B3E" }}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 20%, rgba(0,51,160,0.12) 0%, transparent 60%)" }} />
      <div className="absolute left-0 top-0 bottom-0 w-[0.4vw]" style={{ background: "linear-gradient(to bottom, #FFC107, #388E3C)" }} />

      <div className="absolute inset-0 pl-[7vw] pr-[6vw] pt-[6vh] pb-[5vh] flex flex-col">
        {/* Header */}
        <div className="mb-[3vh]">
          <div className="font-body font-medium tracking-widest uppercase mb-[0.6vh]" style={{ fontSize: "1.3vw", color: "#FFC107" }}>Price Benchmarking</div>
          <h2 className="font-display font-black tracking-tight" style={{ fontSize: "3.8vw", color: "#ffffff" }}>Market Pricing vs. SportsMVP</h2>
          <div className="mt-[0.8vh] w-[8vw] h-[0.25vh]" style={{ background: "#FFC107" }} />
        </div>

        {/* Big stat */}
        <div className="flex items-end gap-[3vw] mb-[3vh]">
          <div>
            <div className="font-display font-black leading-none" style={{ fontSize: "9vw", color: "#FFC107" }}>10x</div>
            <div className="font-body font-medium" style={{ fontSize: "1.6vw", color: "rgba(255,255,255,0.55)" }}>cheaper than ZCode with more transparency</div>
          </div>
          <div style={{ paddingBottom: "1.5vh" }}>
            <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.4)" }}>SportsMVP MVP = $19.99/mo</div>
            <div className="font-body" style={{ fontSize: "1.5vw", color: "rgba(255,255,255,0.4)" }}>ZCode = $198/mo</div>
          </div>
        </div>

        {/* Price bar chart — visual comparison */}
        <div className="flex items-end gap-[3vw] flex-1" style={{ maxHeight: "34vh" }}>
          {/* WagerTalk */}
          <div className="flex flex-col items-center gap-[1vh]" style={{ flex: 1 }}>
            <div className="font-display font-black" style={{ fontSize: "1.6vw", color: "rgba(255,255,255,0.7)" }}>$299</div>
            <div className="w-full rounded-t-lg" style={{ height: "30vh", background: "rgba(211,47,47,0.35)", border: "1px solid rgba(211,47,47,0.4)" }} />
            <div className="font-body font-medium text-center" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>WagerTalk</div>
            <div className="font-body text-center" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)" }}>Human analysts</div>
          </div>

          {/* ZCode */}
          <div className="flex flex-col items-center gap-[1vh]" style={{ flex: 1 }}>
            <div className="font-display font-black" style={{ fontSize: "1.6vw", color: "rgba(255,255,255,0.7)" }}>$198</div>
            <div className="w-full rounded-t-lg" style={{ height: "20vh", background: "rgba(211,47,47,0.25)", border: "1px solid rgba(211,47,47,0.3)" }} />
            <div className="font-body font-medium text-center" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>ZCode</div>
            <div className="font-body text-center" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)" }}>Black box AI</div>
          </div>

          {/* Dimers */}
          <div className="flex flex-col items-center gap-[1vh]" style={{ flex: 1 }}>
            <div className="font-display font-black" style={{ fontSize: "1.6vw", color: "rgba(255,255,255,0.7)" }}>$24.99</div>
            <div className="w-full rounded-t-lg" style={{ height: "6vh", background: "rgba(68,136,255,0.25)", border: "1px solid rgba(68,136,255,0.4)" }} />
            <div className="font-body font-medium text-center" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>Dimers</div>
            <div className="font-body text-center" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)" }}>+EV leader</div>
          </div>

          {/* SportsMVP */}
          <div className="flex flex-col items-center gap-[1vh]" style={{ flex: 1 }}>
            <div className="font-display font-black" style={{ fontSize: "1.6vw", color: "#FFC107" }}>$19.99</div>
            <div className="w-full rounded-t-lg relative" style={{ height: "5vh", background: "rgba(0,51,160,0.5)", border: "2px solid #FFC107", boxShadow: "0 0 20px rgba(255,193,7,0.2)" }}>
              <div className="absolute -top-[3vh] left-1/2 -translate-x-1/2 font-body font-bold whitespace-nowrap px-[0.8vw] py-[0.4vh] rounded" style={{ fontSize: "1.1vw", background: "#FFC107", color: "#060D1F" }}>Best Value</div>
            </div>
            <div className="font-body font-bold text-center" style={{ fontSize: "1.2vw", color: "#FFC107" }}>SportsMVP</div>
            <div className="font-body text-center" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.5)" }}>Full transparency</div>
          </div>

          {/* Free sites */}
          <div className="flex flex-col items-center gap-[1vh]" style={{ flex: 1 }}>
            <div className="font-display font-black" style={{ fontSize: "1.6vw", color: "rgba(255,255,255,0.7)" }}>$0</div>
            <div className="w-full rounded-t-lg" style={{ height: "1.5vh", background: "rgba(136,153,187,0.2)", border: "1px solid rgba(136,153,187,0.3)" }} />
            <div className="font-body font-medium text-center" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.5)" }}>Pickswise / Covers</div>
            <div className="font-body text-center" style={{ fontSize: "1.1vw", color: "rgba(255,255,255,0.3)" }}>Ad-supported, no EV</div>
          </div>
        </div>

        <div className="mt-[2vh] font-body" style={{ fontSize: "1.2vw", color: "rgba(255,255,255,0.3)" }}>
          Monthly pricing at standard tier — annual plans not shown. Sources: public pricing pages — April 2026
        </div>
      </div>
    </div>
  );
}
