import { useMemo, useState } from "react";

function tierRank(t) {
  const x = String(t || "").toUpperCase();
  if (x === "ELITE") return 4;
  if (x === "STRONG") return 3;
  if (x === "EDGE") return 2;
  if (x === "LEAN") return 1;
  return 0;
}

function TeamLogo({ src, alt }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;

  return (
    <img
      src={src}
      alt={alt}
      width={18}
      height={18}
      loading="lazy"
      decoding="async"
      style={{ borderRadius: 4, display: "inline-block", objectFit: "contain" }}
      onError={() => setOk(false)}
    />
  );
}

function fmtPct(x, digits = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtEdge(x, digits = 2) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function marketDisplay(item) {
  const market = item?.market || {};
  const rec = String(market?.recommendedMarket || market?.marketType || "").toLowerCase();
  const side = String(market?.pick || market?.marketSide || "").toLowerCase();
  const line = market?.marketLine;

  if (rec.includes("total")) {
    const dir = side === "under" ? "UNDER" : "OVER";
    return `${dir} ${Number.isFinite(Number(line)) ? line : ""}`.trim();
  }

  if (rec.includes("spread")) {
    const away = item?.matchup?.split(" @ ")[0] || "AWAY";
    const home = item?.matchup?.split(" @ ")[1] || "HOME";
    const team = side === "away" ? away : home;
    const num = Number(line);
    const spread = Number.isFinite(num) ? `${num > 0 ? "+" : ""}${num}` : "";
    return `${team} ${spread}`.trim();
  }

  if (rec.includes("moneyline") || rec.includes("ml")) {
    const away = item?.matchup?.split(" @ ")[0] || "AWAY";
    const home = item?.matchup?.split(" @ ")[1] || "HOME";
    const team = side === "away" ? away : home;
    return `${team} ML`;
  }

  return "Best Play";
}

function sortItems(items) {
  return [...items]
    .filter(Boolean)
    .sort((a, b) => {
      const tr = tierRank(b?.tier || b?.market?.tier) - tierRank(a?.tier || a?.market?.tier);
      if (tr) return tr;

      const e =
        (Number.isFinite(Number(b?.edge)) ? Number(b.edge) : -1) -
        (Number.isFinite(Number(a?.edge)) ? Number(a.edge) : -1);
      if (e) return e;

      return (
        (Number.isFinite(Number(b?.winProb)) ? Number(b.winProb) : -1) -
        (Number.isFinite(Number(a?.winProb)) ? Number(a.winProb) : -1)
      );
    });
}

function BestTile({ label, item }) {
  if (!item) return null;

  const away = item?.matchup?.split(" @ ")[0] || "AWAY";
  const home = item?.matchup?.split(" @ ")[1] || "HOME";

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,.03)"
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.68)",
          marginBottom: 10
        }}
      >
        {label}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, color: "rgba(255,255,255,.72)", fontSize: 12 }}>
        <TeamLogo src={item?.awayLogo} alt={`${away} logo`} />
        <span>{item?.matchup}</span>
        <TeamLogo src={item?.homeLogo} alt={`${home} logo`} />
      </div>

      <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05, marginBottom: 12 }}>
        {marketDisplay(item)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.06)"
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Win Prob</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtPct(item?.winProb, 0)}</div>
        </div>

        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.06)"
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Edge</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtEdge(item?.edge)}</div>
        </div>
      </div>
    </div>
  );
}

function ParlayTile({ topParlay }) {
  if (!topParlay || !Array.isArray(topParlay?.legs) || topParlay.legs.length < 2) return null;

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,.03)"
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.68)",
          marginBottom: 10
        }}
      >
        Best 2-Leg Parlay
      </div>

      {topParlay.legs.slice(0, 2).map((leg, idx) => (
        <div key={idx} style={{ marginBottom: idx === 0 ? 12 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, color: "rgba(255,255,255,.72)", fontSize: 12 }}>
            <TeamLogo src={leg?.awayLogo} alt="away logo" />
            <span>{leg?.matchup || "Matchup"}</span>
            <TeamLogo src={leg?.homeLogo} alt="home logo" />
          </div>

          <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1.1 }}>
            {leg?.betText || leg?.marketText || "Parlay Leg"}
          </div>
        </div>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10, marginTop: 12 }}>
        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.06)"
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Avg Win Prob</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtPct(topParlay?.avgWinProb, 0)}</div>
        </div>

        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.06)"
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Avg Edge</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtEdge(topParlay?.avgEdge)}</div>
        </div>
      </div>
    </div>
  );
}

function UpsetTile({ upset }) {
  if (!upset) return null;

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,.03)"
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.68)",
          marginBottom: 10
        }}
      >
        Upset of the Day
      </div>

      <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1, marginBottom: 8 }}>
        {upset.matchup || "Underdog Value"}
      </div>

      <div style={{ color: "rgba(255,255,255,.78)", fontSize: 14, marginBottom: 12 }}>
        {upset.pick || "Underdog ML"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.06)"
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Upset Prob</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtPct(upset?.winProb, 0)}</div>
        </div>

        <div
          style={{
            padding: 10,
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.06)"
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Edge</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtEdge(upset?.edge)}</div>
        </div>
      </div>
    </div>
  );
}

export default function BestBetsStrip({ items = [], topParlay = null, upset = null }) {
  const data = useMemo(() => {
    const ranked = sortItems(items);
    const used = new Set();

    function take(test = () => true) {
      const hit = ranked.find((x) => {
        const key = `${x?.gameId || x?.matchup}:${x?.market?.recommendedMarket || x?.market?.marketType || ""}`;
        if (used.has(key)) return false;
        if (!test(x)) return false;
        used.add(key);
        return true;
      });

      return hit || null;
    }

    const bestBet = take();
    const bestTotal = take(
      (x) => String(x?.market?.recommendedMarket || x?.market?.marketType || "").toLowerCase().includes("total")
    );

    return { bestBet, bestTotal };
  }, [items]);

  const tiles = [
    data.bestBet ? <BestTile key="best-bet" label="Best Bet" item={data.bestBet} /> : null,
    data.bestTotal ? <BestTile key="best-total" label="Best Total" item={data.bestTotal} /> : null,
    topParlay ? <ParlayTile key="best-parlay" topParlay={topParlay} /> : null,
    upset ? <UpsetTile key="upset" upset={upset} /> : null,
  ].filter(Boolean);

  if (!tiles.length) return null;

  const columns = tiles.length >= 4 ? "repeat(4, minmax(0, 1fr))" : `repeat(${tiles.length}, minmax(0, 1fr))`;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 14 }}>
        Today's Best Bets
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns,
          gap: 12
        }}
      >
        {tiles}
      </div>
    </div>
  );
}
