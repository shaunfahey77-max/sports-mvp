// apps/web/src/components/DailyPicks.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function fmtPct(x, digits = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtEdge(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `+${n.toFixed(3)}`;
}

function tierRank(t) {
  const x = String(t || "").toUpperCase();
  if (x === "ELITE") return 4;
  if (x === "STRONG") return 3;
  if (x === "EDGE") return 2;
  if (x === "LEAN") return 1;
  return 0;
}

function badgeClass(t) {
  const x = String(t || "").toUpperCase();
  if (x === "ELITE") return "badge badge-elite";
  if (x === "STRONG") return "badge badge-strong";
  if (x === "EDGE") return "badge badge-edge";
  if (x === "LEAN") return "badge badge-lean";
  return "badge";
}

async function fetchJson(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${txt ? ` — ${txt}` : ""}`);
  }
  return res.json();
}

export default function DailyPicks({
  date = todayUTCYYYYMMDD(),
  nbaModel = "v2",
  windowNba = 14,
  windowNcaam = 45,
  maxPicksPerLeague = 8,
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [items, setItems] = useState([]);
  const abortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    async function loadLeague(league) {
      const qs = new URLSearchParams();
      qs.set("league", league);
      qs.set("date", date);

      if (league === "nba") {
        qs.set("windowDays", String(windowNba));
        qs.set("model", nbaModel);
      }
      if (league === "ncaam") {
        qs.set("windowDays", String(windowNcaam));
      }

      const data = await fetchJson(`/api/predictions?${qs.toString()}`, { signal: controller.signal });
      const games = Array.isArray(data?.games) ? data.games : [];
      const meta = data?.meta || {};

      const picks = games
        .filter((g) => g?.market?.pick)
        .map((g) => {
          const home = g?.home?.abbr || g?.home?.name || "HOME";
          const away = g?.away?.abbr || g?.away?.name || "AWAY";
          return {
            league,
            date,
            gameId: g?.gameId || `${league}:${away}@${home}`,
            matchup: `${away} @ ${home}`,
            pick: String(g?.market?.pick || "").toUpperCase(),
            tier: String(g?.market?.tier || "PASS").toUpperCase(),
            edge: Number(g?.market?.edge),
            winProb: Number(g?.market?.winProb),
            conf: Number(g?.market?.confidence),
            headline: g?.why?.headline || "",
            bullets: Array.isArray(g?.why?.bullets) ? g.why.bullets.slice(0, 3) : [],
            model: meta?.model || "",
            elapsedMs: meta?.elapsedMs ?? null,
          };
        });

      picks.sort((a, b) => {
        const tr = tierRank(b.tier) - tierRank(a.tier);
        if (tr) return tr;
        const e = (Number.isFinite(b.edge) ? b.edge : -1) - (Number.isFinite(a.edge) ? a.edge : -1);
        if (e) return e;
        return (Number.isFinite(b.winProb) ? b.winProb : -1) - (Number.isFinite(a.winProb) ? a.winProb : -1);
      });

      return picks.slice(0, maxPicksPerLeague);
    }

    (async () => {
      try {
        const [nba, ncaam] = await Promise.all([loadLeague("nba"), loadLeague("ncaam")]);
        const combined = [...nba, ...ncaam];

        combined.sort((a, b) => {
          const tr = tierRank(b.tier) - tierRank(a.tier);
          if (tr) return tr;
          const e = (Number.isFinite(b.edge) ? b.edge : -1) - (Number.isFinite(a.edge) ? a.edge : -1);
          if (e) return e;
          return (Number.isFinite(b.winProb) ? b.winProb : -1) - (Number.isFinite(a.winProb) ? a.winProb : -1);
        });

        if (!alive) return;
        setItems(combined);
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
        setItems([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [date, nbaModel, windowNba, windowNcaam, maxPicksPerLeague]);

  const nbaTop = useMemo(() => items.filter((x) => x.league === "nba"), [items]);
  const ncaamTop = useMemo(() => items.filter((x) => x.league === "ncaam"), [items]);

  return (
    <div className="card">
      <div className="page-title-row" style={{ marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Recommended Daily Picks</div>
          <div className="subtle">Top value edges (NBA v2 + NCAAM) · <span className="mono">{date}</span></div>
        </div>

        <div className="page-actions">
          <Link className="btn btn-ghost" to={`/predict/nba?date=${date}&model=v2&windowDays=${windowNba}`}>NBA</Link>
          <Link className="btn btn-ghost" to={`/predict/ncaam?date=${date}&windowDays=${windowNcaam}`}>NCAAM</Link>
        </div>
      </div>

      {loading ? <div className="subtle">Loading picks…</div> : null}
      {err ? (
        <div className="card danger">
          <div className="mono pre" style={{ whiteSpace: "pre-wrap" }}>{err}</div>
        </div>
      ) : null}

      {!loading && !err && items.length === 0 ? (
        <div className="subtle">
          No picks returned. (This would be unusual given your NBA results — if you see this, your frontend isn’t reading <span className="mono">market.pick</span>.)
        </div>
      ) : null}

      {!loading && !err && items.length > 0 ? (
        <>
          <div className="subtle" style={{ marginBottom: 8 }}>
            NBA picks: <span className="mono">{nbaTop.length}</span> · NCAAM picks: <span className="mono">{ncaamTop.length}</span>
          </div>

          <div className="grid">
            {items.map((p) => (
              <div className="card game" key={`${p.league}:${p.gameId}`}>
                <div className="game-top">
                  <div className="game-main">
                    <div className="game-matchup">{p.matchup}</div>
                    <div className="subtle">
                      <span className="mono">{p.league.toUpperCase()}</span> · Pick: <span className="mono">{p.pick}</span>
                    </div>
                  </div>
                  <div className="game-badges">
                    <span className={badgeClass(p.tier)}>{p.tier}</span>
                  </div>
                </div>

                <div className="game-metrics">
                  <div className="metric">
                    <div className="k">Edge</div>
                    <div className="v">{fmtEdge(p.edge)}</div>
                  </div>
                  <div className="metric">
                    <div className="k">WinProb</div>
                    <div className="v">{fmtPct(p.winProb, 1)}</div>
                  </div>
                  <div className="metric">
                    <div className="k">Conf</div>
                    <div className="v">{fmtPct(p.conf, 0)}</div>
                  </div>
                </div>

                {p.headline ? <div className="why-head">{p.headline}</div> : null}
                {p.bullets?.length ? (
                  <ul className="why-bullets" style={{ marginTop: 8 }}>
                    {p.bullets.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}