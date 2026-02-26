// apps/web/src/components/DailyPicks.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

/* =========================
   Date helpers (UTC-safe)
   ========================= */
function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

/* =========================
   Formatters
   ========================= */
function fmtPct(x, digits = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtEdge(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}`;
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

/* =========================
   Fetch helper (robust JSON)
   ========================= */
async function fetchJson(url, { signal, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const txt = await res.text().catch(() => "");

    let json = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      const err = new Error(`Bad JSON from API (HTTP ${res.status})`);
      err.status = res.status;
      err._raw = txt?.slice?.(0, 250);
      throw err;
    }

    if (!res.ok) {
      const err = new Error(json?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/* =========================
   UI helpers
   ========================= */
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
      style={{ borderRadius: 4, display: "inline-block" }}
      onError={() => setOk(false)}
    />
  );
}

/* =========================
   Component
   ========================= */
export default function DailyPicks({
  date = todayUTCYYYYMMDD(),
  nbaModel = "v2",
  windowNba = 14,
  windowNcaam = 45,
  windowNhl = 40,
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
      } else if (league === "ncaam") {
        qs.set("windowDays", String(windowNcaam));
      } else if (league === "nhl") {
        qs.set("windowDays", String(windowNhl));
      }

      const data = await fetchJson(`/api/predictions?${qs.toString()}`, {
        signal: controller.signal,
        timeoutMs: 30000,
      });

      const games = Array.isArray(data?.games) ? data.games : [];
      const meta = data?.meta || {};

      const picks = games
        .filter((g) => g?.market?.pick)
        .map((g) => {
          const homeAbbr = g?.home?.abbr || g?.home?.name || "HOME";
          const awayAbbr = g?.away?.abbr || g?.away?.name || "AWAY";

          return {
            league,
            date,
            gameId: g?.gameId || `${league}:${awayAbbr}@${homeAbbr}`,
            matchup: `${awayAbbr} @ ${homeAbbr}`,

            // Logos (prefer API team.logo; never use external resolvers here)
            homeLogo: g?.home?.logo || null,
            awayLogo: g?.away?.logo || null,

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
        const e =
          (Number.isFinite(b.edge) ? b.edge : -1) - (Number.isFinite(a.edge) ? a.edge : -1);
        if (e) return e;
        return (
          (Number.isFinite(b.winProb) ? b.winProb : -1) -
          (Number.isFinite(a.winProb) ? a.winProb : -1)
        );
      });

      return picks.slice(0, maxPicksPerLeague);
    }

    (async () => {
      try {
        const [nba, ncaam, nhl] = await Promise.all([
          loadLeague("nba"),
          loadLeague("ncaam"),
          loadLeague("nhl"),
        ]);

        const combined = [...nba, ...ncaam, ...nhl];

        combined.sort((a, b) => {
          const tr = tierRank(b.tier) - tierRank(a.tier);
          if (tr) return tr;
          const e =
            (Number.isFinite(b.edge) ? b.edge : -1) - (Number.isFinite(a.edge) ? a.edge : -1);
          if (e) return e;
          return (
            (Number.isFinite(b.winProb) ? b.winProb : -1) -
            (Number.isFinite(a.winProb) ? a.winProb : -1)
          );
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
  }, [date, nbaModel, windowNba, windowNcaam, windowNhl, maxPicksPerLeague]);

  const nbaTop = useMemo(() => items.filter((x) => x.league === "nba"), [items]);
  const ncaamTop = useMemo(() => items.filter((x) => x.league === "ncaam"), [items]);
  const nhlTop = useMemo(() => items.filter((x) => x.league === "nhl"), [items]);

  return (
    <div className="card">
      <div className="page-title-row" style={{ marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Recommended Daily Picks</div>
          <div className="subtle">
            Top value edges (NBA v2 + NCAAM + NHL) · <span className="mono">{date}</span>
          </div>
        </div>

        <div className="page-actions">
          <Link className="btn btn-ghost" to={`/predict/nba?date=${date}&model=v2&windowDays=${windowNba}`}>
            NBA
          </Link>
          <Link className="btn btn-ghost" to={`/predict/ncaam?date=${date}&windowDays=${windowNcaam}`}>
            NCAAM
          </Link>
          <Link className="btn btn-ghost" to={`/predict/nhl?date=${date}&windowDays=${windowNhl}`}>
            NHL
          </Link>
        </div>
      </div>

      {loading ? <div className="subtle">Loading picks…</div> : null}
      {err ? (
        <div className="card danger">
          <div className="mono pre" style={{ whiteSpace: "pre-wrap" }}>
            {err}
          </div>
        </div>
      ) : null}

      {!loading && !err && items.length === 0 ? (
        <div className="subtle">
          No picks returned. If NHL/NCAAM show 0 picks on a date with games, the model may be
          in PASS mode (threshold too strict) — not a frontend issue.
        </div>
      ) : null}

      {!loading && !err && items.length > 0 ? (
        <>
          <div className="subtle" style={{ marginBottom: 8 }}>
            NBA picks: <span className="mono">{nbaTop.length}</span> · NCAAM picks:{" "}
            <span className="mono">{ncaamTop.length}</span> · NHL picks:{" "}
            <span className="mono">{nhlTop.length}</span>
          </div>

          <div className="grid">
            {items.map((p) => (
              <div className="card game" key={`${p.league}:${p.gameId}`}>
                <div className="game-top">
                  <div className="game-main">
                    <div className="game-matchup" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TeamLogo src={p.awayLogo} alt={`${p.matchup} away`} />
                      <span>{p.matchup}</span>
                      <TeamLogo src={p.homeLogo} alt={`${p.matchup} home`} />
                    </div>
                    <div className="subtle">
                      <span className="mono">{p.league.toUpperCase()}</span> · Pick:{" "}
                      <span className="mono">{p.pick}</span>
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
                    {p.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
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
