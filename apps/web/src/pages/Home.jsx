// apps/web/src/pages/Home.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isFinalStatus(s) {
  const v = String(s || "").toLowerCase();
  return v === "final" || v === "post" || v === "completed";
}

function pct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function tierKey(t) {
  const v = String(t || "PASS").toUpperCase();
  if (v === "ELITE") return "ELITE";
  if (v === "STRONG") return "STRONG";
  if (v === "LEAN") return "LEAN";
  return "PASS";
}

/**
 * Aggregates a slate (games[]) into KPIs.
 * IMPORTANT: completed/scoring is based on winnerTeamId OR final-ish status.
 * We only count wins/losses if we have BOTH predictedId and winnerId.
 */
function aggGames(games) {
  const out = {
    games: games.length,
    picks: 0,
    pass: 0,
    tiers: { ELITE: 0, STRONG: 0, LEAN: 0, PASS: 0 },
    avgEdgeAbs: null,
    completed: 0,
    wins: 0,
    losses: 0,
    accuracy: null,
  };

  let sumAbsEdge = 0;
  let nAbsEdge = 0;

  for (const g of games) {
    const t = tierKey(g?.market?.tier);
    out.tiers[t]++;

    const pick = g?.market?.pick;
    if (pick) out.picks++;
    else out.pass++;

    const edge = safeNum(g?.market?.edge);
    if (edge != null) {
      sumAbsEdge += Math.abs(edge);
      nAbsEdge++;
    }

    const predictedId = g?.market?.recommendedTeamId || null;
    const winnerId = g?.result?.winnerTeamId || null;

    // ✅ consider complete if we have a winnerId OR status is final-ish
    const isComplete = Boolean(winnerId) || isFinalStatus(g?.status);

    if (isComplete) {
      out.completed++;

      if (pick && predictedId && winnerId) {
        if (predictedId === winnerId) out.wins++;
        else out.losses++;
      }
    }
  }

  out.avgEdgeAbs = nAbsEdge ? sumAbsEdge / nAbsEdge : null;
  const denom = out.wins + out.losses;
  out.accuracy = denom ? out.wins / denom : null;

  return out;
}

/** Fetch helper with timeout (and safe abort handling) */
async function fetchJson(url, { timeoutMs = 12000, signal } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    const r = await fetch(url, { signal: ctrl.signal });

    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      const err = new Error("Bad JSON from API");
      err._raw = text?.slice?.(0, 200);
      throw err;
    }

    return { ok: r.ok, status: r.status, json };
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function Bar({ label, value, max, hint }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="barRow">
      <div className="barLabel">{label}</div>
      <div className="barTrack">
        <div className="barFill" style={{ width: `${w}%` }} title={hint || ""} />
      </div>
      <div className="barVal">{value}</div>
    </div>
  );
}

function TrendLine({ points }) {
  const w = 240;
  const h = 56;
  const pad = 6;

  const valid = points.filter((p) => typeof p?.y === "number" && Number.isFinite(p.y));
  if (!valid.length) {
    return (
      <div className="trendEmpty">
        <div className="muted2" style={{ fontSize: 12 }}>
          No scored picks yet
        </div>
      </div>
    );
  }

  const xMax = Math.max(...points.map((p) => p.x));
  const xScale = (x) => pad + (xMax ? (x / xMax) * (w - pad * 2) : 0);

  const yScale = (y) => {
    const yy = clamp(y, 0, 1);
    return pad + (1 - yy) * (h - pad * 2);
  };

  const path = points
    .map((p) => (Number.isFinite(p?.y) ? `${xScale(p.x).toFixed(1)},${yScale(p.y).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      className="trendSvg"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="7-day accuracy trend"
    >
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} className="trendGrid" />
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} className="trendGrid" />
      <polyline points={path} className="trendLine" fill="none" />
      {points.map((p) => {
        if (!Number.isFinite(p?.y)) return null;
        return <circle key={p.x} cx={xScale(p.x)} cy={yScale(p.y)} r="2.6" className="trendDot" />;
      })}
    </svg>
  );
}

function KpiTile({ label, value, mono = false }) {
  return (
    <div className="kpiTile">
      <div className="kpiLabel">{label}</div>
      <div className={`kpiValue ${mono ? "kpiValueMono" : ""}`}>{value}</div>
    </div>
  );
}

function LeagueCard({ league, title, meta, games, loading, error, onOpenLink }) {
  const a = useMemo(() => aggGames(games), [games]);
  const maxTier = Math.max(a.tiers.ELITE, a.tiers.STRONG, a.tiers.LEAN, a.tiers.PASS, 1);

  const scored = a.wins + a.losses;
  const coverage = a.picks ? scored / a.picks : null;

  return (
    <div className="card leagueCard">
      <div className="cardHeader">
        <div className="leagueHead">
          <div className="leagueTitle">{title}</div>
          <div className="muted2 leagueMeta">
            {meta?.model ? `Model: ${meta.model}` : "Model: —"}
            {meta?.mode ? ` • Mode: ${meta.mode}` : ""}
          </div>
        </div>
        <Link className="btn" to={onOpenLink || `/league/${league}`}>
          Open
        </Link>
      </div>

      <div className="cardBody">
        {loading ? (
          <div className="muted">Loading…</div>
        ) : error ? (
          <div className="muted">Error: {error}</div>
        ) : (
          <>
            <div className="kpiGrid4">
              <KpiTile label="Games" value={a.games} />
              <KpiTile label="Picks" value={a.picks} />
              <KpiTile label="Pass" value={a.pass} />
              <KpiTile label="Avg |Edge|" value={a.avgEdgeAbs == null ? "—" : a.avgEdgeAbs.toFixed(3)} mono />
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="muted2" style={{ fontSize: 12, marginBottom: 8 }}>
                Tier distribution
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <Bar label="ELITE" value={a.tiers.ELITE} max={maxTier} />
                <Bar label="STRONG" value={a.tiers.STRONG} max={maxTier} />
                <Bar label="LEAN" value={a.tiers.LEAN} max={maxTier} />
                <Bar label="PASS" value={a.tiers.PASS} max={maxTier} />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="muted2" style={{ fontSize: 12, marginBottom: 8 }}>
                Performance (completed games only)
              </div>

              <div className="kpiGrid3">
                <KpiTile label="Completed" value={a.completed} />
                <KpiTile label="Scored" value={scored} />
                <KpiTile label="Accuracy" value={pct(a.accuracy)} />
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div className="kpiTile" style={{ minWidth: 200 }}>
                  <div className="kpiLabel">Score coverage</div>
                  <div className="kpiValue">{coverage == null ? "—" : pct(coverage)}</div>
                </div>
                <div className="muted2" style={{ fontSize: 12 }}>
                  Coverage = % of picks with a winner available to score.
                </div>
              </div>

              <div className="muted2" style={{ fontSize: 12, marginTop: 8 }}>
                *Accuracy uses <code>result.winnerTeamId</code> when available.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Helpers for 7-day widgets */
function avgAcc(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const valid = arr.map((r) => r?.acc).filter((x) => Number.isFinite(x));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function PerfMiniTable({ rows }) {
  const arr = Array.isArray(rows) ? rows : [];
  return (
    <div className="perfTable">
      {arr.map((r) => (
        <div className="perfRow" key={r.date}>
          <div className="perfDate">{String(r.date).slice(5)}</div>
          <div className="perfScored">{r.scored || 0} scored</div>
          <div className="perfAcc">{pct(r.acc)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Normalizes /api/performance rows into exactly 7 days ending on `endDate`.
 * Fills missing days with { scored:0, acc:null } so the UI never breaks.
 */
function normalizePerfRows(rows, endDate) {
  const byDate = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.date) continue;
    byDate.set(String(r.date).slice(0, 10), {
      date: String(r.date).slice(0, 10),
      scored: Number(r?.scored || 0),
      acc: Number.isFinite(r?.acc) ? r.acc : null,
    });
  }

  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(`${endDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    out.push(byDate.get(ymd) || { date: ymd, scored: 0, acc: null });
  }
  return out;
}

export default function Home() {
  const [date, setDate] = useState(todayUTCYYYYMMDD());
  const [apiOk, setApiOk] = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");

  const [nba, setNba] = useState({ loading: true, error: "", data: null });
  const [nhl, setNhl] = useState({ loading: true, error: "", data: null });
  const [ncaam, setNcaam] = useState({ loading: true, error: "", data: null });

  const [perf7, setPerf7] = useState({
    loading: false,
    error: "",
    rows: { nba: [], nhl: [], ncaam: [] }, // [{ date, scored, acc }]
    meta: null, // optional meta from API
  });

  const perfAbortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/health");
        if (!alive) return;
        setApiOk(r.ok);
      } catch {
        if (!alive) return;
        setApiOk(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // load today's slate for each league
  useEffect(() => {
    let alive = true;

    async function loadOne(league, setState) {
      setState({ loading: true, error: "", data: null });
      try {
        const qs = new URLSearchParams({ league, date });
        const { json } = await fetchJson(`/api/predictions?${qs.toString()}`, { timeoutMs: 20000 });
        if (!alive) return;
        setState({ loading: false, error: "", data: json });
        setLastUpdated(new Date().toLocaleString());
      } catch (e) {
        if (!alive) return;
        setState({ loading: false, error: String(e?.message || e), data: null });
        setLastUpdated(new Date().toLocaleString());
      }
    }

    if (apiOk === false) {
      setNba({ loading: false, error: "API offline (port 3001)", data: null });
      setNhl({ loading: false, error: "API offline (port 3001)", data: null });
      setNcaam({ loading: false, error: "API offline (port 3001)", data: null });
      return () => {
        alive = false;
      };
    }

    loadOne("nba", setNba);
    loadOne("nhl", setNhl);
    loadOne("ncaam", setNcaam);

    return () => {
      alive = false;
    };
  }, [date, apiOk]);

  // ✅ 7-day performance fetch (single call to /api/performance)
  // FIXES:
  // - Uses routeTimeoutMs >= internalTimeoutMs * days (otherwise abort cascades)
  // - Uses a slightly longer fetch timeout than route timeout
  // - Normalizes rows to exactly 7 days ending on selected `date`
  // - Handles partial responses (ok:false) without breaking UI
  useEffect(() => {
    if (apiOk !== true) return;

    if (perfAbortRef.current) perfAbortRef.current.abort();
    const abort = new AbortController();
    perfAbortRef.current = abort;

    // prefill UI so it never looks "empty"
    const empty = {
      nba: normalizePerfRows([], date),
      nhl: normalizePerfRows([], date),
      ncaam: normalizePerfRows([], date),
    };

    setPerf7({ loading: true, error: "", rows: empty, meta: null });

    const run = async () => {
      try {
        const leagues = ["nba", "nhl", "ncaam"].join(",");

        // If your API is doing 7 days * 3 leagues, plan for worst-case.
        // Keep concurrency low to avoid upstream bursts.
        const internalTimeoutMs = 15000; // per internal /predictions call
        const routeTimeoutMs = 80000; // must be comfortably > internalTimeoutMs * 7 / concurrency
        const fetchTimeoutMs = routeTimeoutMs + 10000; // allow the server to finish before client aborts

        const qs = new URLSearchParams({
          days: "7",
          leagues,
          internalTimeoutMs: String(internalTimeoutMs),
          routeTimeoutMs: String(routeTimeoutMs),
          concurrency: "1",
        });

        const { ok, status, json } = await fetchJson(`/api/performance?${qs.toString()}`, {
          timeoutMs: fetchTimeoutMs,
          signal: abort.signal,
        });

        if (abort.signal.aborted) return;

        if (!ok || !json) {
          const msg = `Performance failed (HTTP ${status})`;
          setPerf7({ loading: false, error: msg, rows: empty, meta: null });
          return;
        }

        // If the route times out it may return ok:false with error/meta
        if (!json?.ok) {
          const msg = json?.error || "Performance failed";
          setPerf7({ loading: false, error: msg, rows: empty, meta: json?.meta || null });
          return;
        }

        const rows = json?.rows || {};
        setPerf7({
          loading: false,
          error: "",
          meta: json?.meta || null,
          rows: {
            nba: normalizePerfRows(rows.nba, date),
            nhl: normalizePerfRows(rows.nhl, date),
            ncaam: normalizePerfRows(rows.ncaam, date),
          },
        });
      } catch (e) {
        if (abort.signal.aborted) return;
        if (e?.name === "AbortError") return;

        setPerf7((p) => ({
          loading: false,
          error: String(e?.message || e),
          rows: p.rows,
          meta: p.meta || null,
        }));
      }
    };

    run();
    return () => abort.abort();
  }, [date, apiOk]);

  const nbaAgg = useMemo(() => aggGames(nba.data?.games || []), [nba.data]);
  const nhlAgg = useMemo(() => aggGames(nhl.data?.games || []), [nhl.data]);
  const ncaamAgg = useMemo(() => aggGames(ncaam.data?.games || []), [ncaam.data]);

  // Today's slate summary
  const global = useMemo(() => {
    const wins = (nbaAgg.wins || 0) + (nhlAgg.wins || 0) + (ncaamAgg.wins || 0);
    const losses = (nbaAgg.losses || 0) + (nhlAgg.losses || 0) + (ncaamAgg.losses || 0);
    const scored = wins + losses;
    const acc = scored ? wins / scored : null;

    const picks = (nbaAgg.picks || 0) + (nhlAgg.picks || 0) + (ncaamAgg.picks || 0);
    const completed = (nbaAgg.completed || 0) + (nhlAgg.completed || 0) + (ncaamAgg.completed || 0);

    return { scored, acc, picks, completed };
  }, [nbaAgg, nhlAgg, ncaamAgg]);

  // ✅ 7-day summary derived from perf7 (scored + weighted accuracy)
  const global7 = useMemo(() => {
    const sumLeague = (lg) => {
      const arr = perf7.rows?.[lg] || [];
      let scored = 0;
      let winsApprox = 0;

      for (const r of arr) {
        const s = Number(r?.scored || 0);
        scored += s;
        if (Number.isFinite(r?.acc)) winsApprox += r.acc * s;
      }

      const acc = scored ? winsApprox / scored : null;
      return { scored, acc };
    };

    const nba7 = sumLeague("nba");
    const nhl7 = sumLeague("nhl");
    const ncaam7 = sumLeague("ncaam");

    const scored = nba7.scored + nhl7.scored + ncaam7.scored;
    const winsApprox =
      (nba7.acc ?? 0) * nba7.scored + (nhl7.acc ?? 0) * nhl7.scored + (ncaam7.acc ?? 0) * ncaam7.scored;
    const acc = scored ? winsApprox / scored : null;

    return { scored, acc };
  }, [perf7.rows]);

  const openNbaLink = useMemo(() => `/league/nba?date=${date}`, [date]);
  const openNhlLink = useMemo(() => `/league/nhl?date=${date}`, [date]);
  const openNcaamLink = useMemo(() => `/league/ncaam?date=${date}`, [date]);
  const openNcaamTournamentLink = useMemo(() => `/league/ncaam?date=${date}&mode=tournament`, [date]);

  const trendPoints = (league) =>
    (perf7.rows?.[league] || []).map((r, i) => ({ x: i, y: Number.isFinite(r?.acc) ? r.acc : null }));

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="cardHeader">
          <div>
            <div className="h1" style={{ marginBottom: 6 }}>
              Sports MVP
            </div>
            <p className="sub" style={{ margin: 0 }}>
              Daily slate + premium predictions contract across NBA / NHL / NCAAM.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Link className="btn btnPrimary" to={openNbaLink}>
              Open NBA
            </Link>
          </div>
        </div>

        <div className="cardBody">
          <div className="kpiGrid4">
            <KpiTile label="API" value={apiOk == null ? "Checking…" : apiOk ? "Online" : "Offline"} />
            <KpiTile label="Slate date" value={date} mono />
            <KpiTile label="Updated" value={lastUpdated || "—"} />
            <KpiTile label="Scored accuracy" value={pct(global.acc)} />
          </div>

          <div className="perfStrip">
            <div className="perfStripTop">
              <div>
                <div style={{ fontWeight: 900 }}>7-day performance</div>
                <div className="muted2" style={{ fontSize: 12, marginTop: 4 }}>
                  Scored picks:{" "}
                  <span className="muted" style={{ fontWeight: 800 }}>
                    {global7.scored || 0}
                  </span>
                  {" • "}
                  7-day accuracy:{" "}
                  <span className="muted" style={{ fontWeight: 800 }}>
                    {pct(global7.acc)}
                  </span>
                </div>
              </div>

              <div className="perfLegend">
                <span className="muted2" style={{ fontSize: 12 }}>
                  Accuracy trend
                </span>
                <span className="badge">Last 7 days</span>
              </div>
            </div>

            {perf7.error ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Error: {perf7.error}
              </div>
            ) : (
              <div className="perfGrid">
                <div className="perfCard">
                  <div className="perfCardHead">
                    <div style={{ fontWeight: 900 }}>NBA</div>
                    <div className="muted2" style={{ fontSize: 12 }}>
                      Avg: {pct(avgAcc(perf7.rows.nba))}
                    </div>
                  </div>
                  <TrendLine points={trendPoints("nba")} />
                  <PerfMiniTable rows={perf7.rows.nba} />
                </div>

                <div className="perfCard">
                  <div className="perfCardHead">
                    <div style={{ fontWeight: 900 }}>NHL</div>
                    <div className="muted2" style={{ fontSize: 12 }}>
                      Avg: {pct(avgAcc(perf7.rows.nhl))}
                    </div>
                  </div>
                  <TrendLine points={trendPoints("nhl")} />
                  <PerfMiniTable rows={perf7.rows.nhl} />
                </div>

                <div className="perfCard">
                  <div className="perfCardHead">
                    <div style={{ fontWeight: 900 }}>NCAAM</div>
                    <div className="muted2" style={{ fontSize: 12 }}>
                      Avg: {pct(avgAcc(perf7.rows.ncaam))}
                    </div>
                  </div>
                  <TrendLine points={trendPoints("ncaam")} />
                  <PerfMiniTable rows={perf7.rows.ncaam} />
                </div>
              </div>
            )}

            <div className="muted2" style={{ fontSize: 12, marginTop: 10 }}>
              {perf7.loading ? "Updating…" : " "}
              {" "}
              Tip: Use <span className="badge">Tournament</span> mode on NCAAM pages for neutral-court feel + higher upset sensitivity.
            </div>
          </div>
        </div>
      </div>

      <div className="leagueGrid">
        <LeagueCard
          league="nba"
          title="NBA"
          meta={nba.data?.meta}
          games={nba.data?.games || []}
          loading={nba.loading}
          error={nba.error}
          onOpenLink={openNbaLink}
        />
        <LeagueCard
          league="nhl"
          title="NHL"
          meta={nhl.data?.meta}
          games={nhl.data?.games || []}
          loading={nhl.loading}
          error={nhl.error}
          onOpenLink={openNhlLink}
        />
        <LeagueCard
          league="ncaam"
          title="NCAAM"
          meta={ncaam.data?.meta}
          games={ncaam.data?.games || []}
          loading={ncaam.loading}
          error={ncaam.error}
          onOpenLink={openNcaamLink}
        />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn" to="/parlay-lab">
          Parlay Lab
        </Link>
        <Link className="btn" to="/upsets">
          Upset Watch
        </Link>
        <Link className="btn" to={openNcaamTournamentLink}>
          NCAAM Tournament Mode
        </Link>
      </div>
    </div>
  );
}
