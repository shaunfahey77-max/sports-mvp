// legacy/apps/web/src/pages/Home.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getMatchupLogos } from "../lib/teamLogos";

const LEAGUES = ["nba", "nhl", "ncaam"];

function todayUTC() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function pct01(x, digits = 1) {
  const n = clamp01(x);
  if (n == null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtEdge(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}`;
}

function normLeague(raw) {
  const l = String(raw || "nba").toLowerCase();
  if (l === "nba" || l === "nhl" || l === "ncaam") return l;
  return "nba";
}

/** Extract normalized pick fields from your unified-ish contract. */
function extractPick(g) {
  const pick =
    g?.market?.pick ??
    g?.pick?.pickSide ??
    g?.pickSide ??
    g?.pick ??
    null;

  // common "no pick" values in this project
  const pickStr = pick == null ? null : String(pick).toLowerCase().trim();
  const hasPick =
    pickStr &&
    pickStr !== "pass" &&
    pickStr !== "no pick" &&
    pickStr !== "nopick" &&
    pickStr !== "none" &&
    pickStr !== "—";

  const winProb =
    g?.market?.winProb ??
    g?.pick?.winProb ??
    g?.winProb ??
    null;

  const edge =
    g?.market?.edge ??
    g?.pick?.edge ??
    g?.edge ??
    null;

  const confidence =
    g?.market?.confidence ??
    g?.pick?.confidence ??
    g?.confidence ??
    null;

  const why =
    g?.why ??
    g?.pick?.why ??
    g?.market?.why ??
    null;

  return {
    pick: hasPick ? String(pick).toUpperCase() : null,
    winProb: clamp01(winProb),
    edge: Number.isFinite(Number(edge)) ? Number(edge) : null,
    confidence: clamp01(confidence),
    why: why && typeof why === "object" ? why : null,
  };
}

/** Derive matchup + home/away objects across different payload shapes */
function getTeamsFromGame(g) {
  const home = g?.home || g?.homeTeam || {};
  const away = g?.away || g?.awayTeam || {};
  return { home, away };
}

function matchupText(g, home, away) {
  return (
    g?.matchup ||
    `${away?.abbr || away?.name || "AWAY"} @ ${home?.abbr || home?.name || "HOME"}`
  );
}

function tierFromConfidence(conf) {
  const c = clamp01(conf);
  if (c == null) return { label: "—", tone: "muted" };
  if (c >= 0.7) return { label: "HIGH", tone: "good" };
  if (c >= 0.6) return { label: "MED", tone: "warn" };
  return { label: "LOW", tone: "bad" };
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

export default function Home() {
  const [date, setDate] = useState(todayUTC());

  // performance (7d) for credibility strip
  const [perf, setPerf] = useState(null);

  // predictions by league for selected date
  const [pred, setPred] = useState({ nba: null, nhl: null, ncaam: null });

  // upset candidates count + spotlight (we’ll prefer ncaam)
  const [upsets, setUpsets] = useState({ nba: null, nhl: null, ncaam: null });

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Load 7-day performance once
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/performance?leagues=${LEAGUES.join(",")}&days=7`);
        const j = await r.json();
        if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`);
        if (!dead) setPerf(j);
      } catch (e) {
        if (!dead) setErr(String(e?.message || e));
      }
    })();
    return () => { dead = true; };
  }, []);

  // Load predictions + upsets for the selected date
  useEffect(() => {
    let dead = false;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const predReqs = LEAGUES.map(async (l) => {
          const r = await fetch(`/api/predictions?league=${encodeURIComponent(l)}&date=${encodeURIComponent(date)}`);
          const j = await r.json();
          if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status} (${l})`);
          return [l, j];
        });

        // Upsets: cheap “count + top row” pull for each league
        const upsetReqs = LEAGUES.map(async (l) => {
          const r = await fetch(
            `/api/upsets?league=${encodeURIComponent(l)}&date=${encodeURIComponent(date)}&mode=watch&minWin=0.20&limit=20`
          );
          const j = await r.json();
          if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status} (upsets ${l})`);
          return [l, j];
        });

        const predPairs = await Promise.all(predReqs);
        const upsetPairs = await Promise.all(upsetReqs);

        if (dead) return;

        const predObj = { nba: null, nhl: null, ncaam: null };
        for (const [l, j] of predPairs) predObj[l] = j;

        const upsetObj = { nba: null, nhl: null, ncaam: null };
        for (const [l, j] of upsetPairs) upsetObj[l] = j;

        setPred(predObj);
        setUpsets(upsetObj);
      } catch (e) {
        if (!dead) setErr(String(e?.message || e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();

    return () => { dead = true; };
  }, [date]);

  const perfRows = useMemo(() => perf?.rows || {}, [perf]);

  // -------- Aggregation (single source of truth for UI) --------
  const leagueAgg = useMemo(() => {
    const out = {};
    for (const league of LEAGUES) {
      const payload = pred?.[league];
      const games = safeArr(payload?.games);

      const normalized = games.map((g) => {
        const { home, away } = getTeamsFromGame(g);
        const matchup = matchupText(g, home, away);
        const pickData = extractPick(g);

        const logos = getMatchupLogos(league, away, home, matchup, { size: 56 });

        return {
          gameId: g?.gameId || `${league}-${date}-${matchup}`,
          league,
          matchup,
          home,
          away,
          ...logos,
          ...pickData,
        };
      });

      const picks = normalized.filter((x) => x.pick);
      const picksCount = picks.length;

      const gamesCount = normalized.length;

      const highConfCount = picks.filter((x) => clamp01(x.confidence) != null && x.confidence >= 0.7).length;

      const avgEdge =
        picksCount > 0
          ? picks.reduce((a, x) => a + (Number.isFinite(x.edge) ? x.edge : 0), 0) / picksCount
          : null;

      const bestEdgePick =
        picksCount > 0
          ? picks
              .filter((x) => Number.isFinite(x.edge))
              .slice()
              .sort((a, b) => (b.edge ?? -999) - (a.edge ?? -999))[0] || null
          : null;

      const strongestPick =
        picksCount > 0
          ? picks
              .filter((x) => clamp01(x.winProb) != null)
              .slice()
              .sort((a, b) => (b.winProb ?? -1) - (a.winProb ?? -1))[0] || null
          : null;

      // performance rollup (last 7 days)
      const rows7 = Array.isArray(perfRows?.[league]) ? perfRows[league] : [];
      const wins7 = rows7.reduce((a, r) => a + (Number(r?.wins) || 0), 0);
      const losses7 = rows7.reduce((a, r) => a + (Number(r?.losses) || 0), 0);
      const wr7 = wins7 + losses7 > 0 ? wins7 / (wins7 + losses7) : null;

      // upsets for this date
      const upsetPayload = upsets?.[league];
      const upsetRows = safeArr(upsetPayload?.rows);
      const upsetCount = upsetRows.length;
      const upsetSpotlight = upsetRows[0] || null;

      out[league] = {
        league,
        source: payload?.meta?.source || payload?.meta?.model || "—",
        gamesCount,
        picksCount,
        highConfCount,
        avgEdge,
        bestEdgePick,
        strongestPick,
        upsetCount,
        upsetSpotlight,
        wr7,
        wins7,
        losses7,
        normalized, // for top picks table
      };
    }
    return out;
  }, [pred, upsets, perfRows, date]);

  // Today signal strip (all leagues)
  const todaySignals = useMemo(() => {
    const allGames = LEAGUES.reduce((a, l) => a + (leagueAgg?.[l]?.gamesCount || 0), 0);
    const allPicks = LEAGUES.reduce((a, l) => a + (leagueAgg?.[l]?.picksCount || 0), 0);
    const highConf = LEAGUES.reduce((a, l) => a + (leagueAgg?.[l]?.highConfCount || 0), 0);
    const upsetAlerts = LEAGUES.reduce((a, l) => a + (leagueAgg?.[l]?.upsetCount || 0), 0);

    const bestEdge = LEAGUES
      .map((l) => leagueAgg?.[l]?.bestEdgePick)
      .filter(Boolean)
      .sort((a, b) => (b.edge ?? -999) - (a.edge ?? -999))[0] || null;

    return { allGames, allPicks, highConf, upsetAlerts, bestEdge };
  }, [leagueAgg]);

  // Top picks (across leagues) for Home table
  const topPicks = useMemo(() => {
    const merged = LEAGUES.flatMap((l) => (leagueAgg?.[l]?.normalized || []).filter((x) => x.pick));
    // prioritize edge, then confidence, then winProb
    merged.sort((a, b) => {
      const ae = Number.isFinite(a.edge) ? a.edge : -999;
      const be = Number.isFinite(b.edge) ? b.edge : -999;
      if (be !== ae) return be - ae;

      const ac = a.confidence ?? -1;
      const bc = b.confidence ?? -1;
      if (bc !== ac) return bc - ac;

      const aw = a.winProb ?? -1;
      const bw = b.winProb ?? -1;
      return bw - aw;
    });
    return merged.slice(0, 10);
  }, [leagueAgg]);

  // Upset spotlight: prefer NCAAM; else best by winProb
  const upsetOfDay = useMemo(() => {
    const preferred = leagueAgg?.ncaam?.upsetSpotlight;
    if (preferred) return preferred;

    const merged = LEAGUES.flatMap((l) => safeArr(upsets?.[l]?.rows));
    merged.sort((a, b) => (Number(b?.winProb) || 0) - (Number(a?.winProb) || 0));
    return merged[0] || null;
  }, [leagueAgg, upsets]);

  // -------- UI --------
  return (
    <div>
      {/* Header */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="slateHeader">
          <div style={{ minWidth: 0 }}>
            <div className="h1" style={{ fontSize: 26 }}>Premium Dashboard</div>
            <div className="sub">
              Daily command center: signals → picks → upsets. Use <b>2026-02-04</b> as your demo test day.
            </div>
          </div>

          <div className="pills">
            <span className="badge">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pill"
              style={{ padding: "6px 10px", background: "rgba(255,255,255,.04)" }}
            />
            <button className="pill" onClick={() => setDate("2026-02-04")}>Test: 2026-02-04</button>
            <Link className="pill" to="/performance">Performance</Link>
            <Link className="pill" to={`/upsets?league=ncaam&date=${encodeURIComponent(date)}`}>Upsets</Link>
          </div>
        </div>

        {err && <div className="badge bad" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      {/* Today Signal Strip */}
      <div className="grid" style={{ marginBottom: 14 }}>
        <div className="kpi" style={{ gridColumn: "span 12" }}>
          <div className="label">Today signals • {date}</div>

          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span className="badge">Games: <b>{todaySignals.allGames}</b></span>
            <span className="badge">Picks issued: <b>{todaySignals.allPicks}</b></span>
            <span className="badge good">High confidence: <b>{todaySignals.highConf}</b></span>
            <span className="badge warn">Upset alerts: <b>{todaySignals.upsetAlerts}</b></span>
            <span className="badge">
              Best edge:{" "}
              <b>
                {todaySignals.bestEdge
                  ? `${todaySignals.bestEdge.matchup} (${fmtEdge(todaySignals.bestEdge.edge)})`
                  : "—"}
              </b>
            </span>
          </div>

          <div className="sub" style={{ marginTop: 8 }}>
            Quick read: picks are sorted by edge; upset alerts use underdog win% threshold (min 20%).
          </div>
        </div>
      </div>

      {/* League summary cards (premium, informative) */}
      <div className="grid" style={{ marginBottom: 14 }}>
        {LEAGUES.map((l) => {
          const a = leagueAgg?.[l];
          if (!a) return null;

          const strong = a.strongestPick;
          const edgeBest = a.bestEdgePick;

          return (
            <div key={l} className="card" style={{ gridColumn: "span 4", padding: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="label">{l.toUpperCase()}</div>
                  <div className="sub">source: {a.source}</div>
                </div>
                <Link className="badge" to={`/league/${l}?date=${encodeURIComponent(date)}`}>
                  Open
                </Link>
              </div>

              <div className="hr" />

              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <span className="badge">Games: <b>{a.gamesCount}</b></span>
                <span className="badge">Picks: <b>{a.picksCount}</b></span>
                <span className="badge good">High conf: <b>{a.highConfCount}</b></span>
                <span className="badge">Avg edge: <b>{a.avgEdge != null ? fmtEdge(a.avgEdge) : "—"}</b></span>
                <span className="badge warn">Upsets: <b>{a.upsetCount}</b></span>
              </div>

              <div className="hr" />

              <div className="sub">
                <b>7-day win rate:</b> {pct01(a.wr7)} <span style={{ opacity: 0.7 }}>({a.wins7}-{a.losses7})</span>
              </div>

              <div className="sub" style={{ marginTop: 6 }}>
                <b>Strongest:</b>{" "}
                {strong
                  ? `${strong.matchup} — ${strong.pick} ${pct01(strong.winProb)}`
                  : "—"}
              </div>

              <div className="sub" style={{ marginTop: 4 }}>
                <b>Best edge:</b>{" "}
                {edgeBest
                  ? `${edgeBest.matchup} — ${fmtEdge(edgeBest.edge)}`
                  : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Top Picks Table */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="slateHeader">
          <div>
            <div className="h1" style={{ fontSize: 20 }}>Top Picks (by Edge)</div>
            <div className="sub">Across all leagues for {date}. Click a league to drill in.</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="badge" to={`/league/nba?date=${encodeURIComponent(date)}`}>NBA</Link>
            <Link className="badge" to={`/league/nhl?date=${encodeURIComponent(date)}`}>NHL</Link>
            <Link className="badge" to={`/league/ncaam?date=${encodeURIComponent(date)}`}>NCAAM</Link>
          </div>
        </div>

        {loading ? (
          <div className="sub">Loading…</div>
        ) : topPicks.length === 0 ? (
          <div className="sub">No picks issued for this date.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {topPicks.map((x) => {
              const t = tierFromConfidence(x.confidence);
              return (
                <div key={x.gameId} className="gameRow">
                  <div className="matchup">
                    {x.awayLogo ? <img className="logo" src={x.awayLogo} alt="" /> : <span className="logo" />}
                    {x.homeLogo ? <img className="logo" src={x.homeLogo} alt="" /> : <span className="logo" />}
                    <span style={{ marginRight: 8, opacity: 0.8 }} className="badge">{x.league.toUpperCase()}</span>
                    <span>{x.matchup}</span>
                  </div>

                  <div className="metaChips">
                    <span className="chip">Pick: {x.pick || "—"}</span>
                    <span className="chip">Win: {pct01(x.winProb)}</span>
                    <span className="chip">Edge: {fmtEdge(x.edge)}</span>
                    <span className={`chip ${t.tone}`}>Conf: {t.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upset Spotlight */}
      <div className="card" style={{ padding: 14 }}>
        <div className="slateHeader">
          <div>
            <div className="h1" style={{ fontSize: 20 }}>Upset Spotlight</div>
            <div className="sub">Tournament-grade view. Defaults to NCAAM when available.</div>
          </div>
          <Link className="badge" to={`/upsets?league=ncaam&date=${encodeURIComponent(date)}`}>
            View Upset Watch
          </Link>
        </div>

        <div className="hr" />

        {loading ? (
          <div className="sub">Loading…</div>
        ) : !upsetOfDay ? (
          <div className="sub">No upset candidates for current filters.</div>
        ) : (
          <div className="gameRow" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div className="matchup">
                {upsetOfDay?.away?.logo ? <img className="logo" src={upsetOfDay.away.logo} alt="" /> : <span className="logo" />}
                {upsetOfDay?.home?.logo ? <img className="logo" src={upsetOfDay.home.logo} alt="" /> : <span className="logo" />}
                <span>{upsetOfDay.matchup}</span>
              </div>

              {(() => {
                const why = upsetOfDay?.why || upsetOfDay?.pick?.why;
                const whyObj = why && typeof why === "object" ? why : null;
                if (!whyObj) return <div className="sub2" style={{ marginTop: 6 }}>Why: —</div>;

                return (
                  <div style={{ marginTop: 6 }}>
                    <div className="sub2">
                      <b>Why:</b> {whyObj.headline || "—"}
                    </div>
                    {safeArr(whyObj?.bullets).length > 0 && (
                      <ul className="whyList" style={{ marginTop: 6 }}>
                        {safeArr(whyObj.bullets).slice(0, 5).map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="metaChips" style={{ flex: "0 0 auto" }}>
              <span className="chip warn">Dog win: {pct01(upsetOfDay.winProb)}</span>
              <span className="chip">Pick: {String(upsetOfDay?.pick?.pickSide || "—").toUpperCase()}</span>
              <span className="chip">Edge: {fmtEdge(upsetOfDay?.pick?.edge)}</span>
              <span className="chip">{upsetOfDay?.signals?.usedModelWinProb ? "Model winProb" : "Fallback"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
