// apps/web/src/pages/Predict.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getTeamLogo } from "../lib/teamLogos";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function normalizeLeague(raw) {
  const l = String(raw || "nba").toLowerCase();
  if (l === "nba") return "nba";
  if (l === "nhl") return "nhl";
  if (l === "ncaam") return "ncaam";
  return "nba";
}

function TierBadge({ tier }) {
  const t = tier || "PASS";
  return (
    <span className={`tier-badge tier-${t}`}>
      <span className="tier-dot" />
      {t}
    </span>
  );
}

function EdgeText({ edge }) {
  const val = typeof edge === "number" ? edge : null;
  return <span className="edge-mono">EDGE: {val == null ? "—" : val.toFixed(3)}</span>;
}

function WhyPanel({ why }) {
  const bullets = Array.isArray(why?.bullets) ? why.bullets : [];
  if (!bullets.length) return null;

  return (
    <div className="why-panel">
      <div className="why-title">{why?.headline || "Why"}</div>
      <ul className="why-list">
        {bullets.slice(0, 6).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Predict() {
  const nav = useNavigate();
  const { league: leagueParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [league, setLeague] = useState(() => normalizeLeague(leagueParam));
  const [date, setDate] = useState(() => searchParams.get("date") || todayUTCYYYYMMDD());
  const [tournament, setTournament] = useState(
    () => String(searchParams.get("mode") || "").toLowerCase() === "tournament"
  );

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  // Sync league with route
  useEffect(() => {
    setLeague(normalizeLeague(leagueParam));
  }, [leagueParam]);

  // Sync date/mode with query (back/forward + direct loads)
  useEffect(() => {
    const qDate = searchParams.get("date");
    const qTournament = String(searchParams.get("mode") || "").toLowerCase() === "tournament";

    if (qDate && qDate !== date) setDate(qDate);
    if (qTournament !== tournament) setTournament(qTournament);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("league", league);
    params.set("date", date);
    if (league === "ncaam" && tournament) params.set("mode", "tournament");
    return `/api/predictions?${params.toString()}`;
  }, [league, date, tournament]);

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch(url);
        const j = await r.json();
        if (!alive) return;
        setData(j);
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [url]);

  function goLeague(nextLeague) {
    const l = normalizeLeague(nextLeague);
    const qp = new URLSearchParams(searchParams);
    qp.set("date", date);
    if (l !== "ncaam") qp.delete("mode");
    nav(`/league/${l}?${qp.toString()}`);
  }

  function toggleTournament() {
    if (league !== "ncaam") return;
    const next = !tournament;

    const qp = new URLSearchParams(searchParams);
    qp.set("date", date);
    if (next) qp.set("mode", "tournament");
    else qp.delete("mode");

    setSearchParams(qp, { replace: true });
    setTournament(next);
  }

  function setDateAndQuery(nextDate) {
    setDate(nextDate);
    const qp = new URLSearchParams(searchParams);
    qp.set("date", nextDate);
    if (league !== "ncaam") qp.delete("mode");
    setSearchParams(qp, { replace: true });
  }

  const meta = data?.meta || {};
  const games = data?.games ?? data?.predictions ?? [];

  return (
    <div className="container">
      <div className="card">
        <div className="cardHeader">
          <div>
            <div className="h1" style={{ fontSize: 22, margin: 0 }}>Predictions</div>
            <p className="sub" style={{ marginTop: 6 }}>Tier + Edge + Why (premium contract)</p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="tabs">
              <button className={`tab ${league === "nba" ? "tabActive" : ""}`} onClick={() => goLeague("nba")}>NBA</button>
              <button className={`tab ${league === "nhl" ? "tabActive" : ""}`} onClick={() => goLeague("nhl")}>NHL</button>
              <button className={`tab ${league === "ncaam" ? "tabActive" : ""}`} onClick={() => goLeague("ncaam")}>NCAAM</button>
            </div>

            <input className="input" type="date" value={date} onChange={(e) => setDateAndQuery(e.target.value)} />

            {league === "ncaam" && (
              <button className={`btn ${tournament ? "btnPrimary" : ""}`} onClick={toggleTournament}>
                Tournament: {tournament ? "ON" : "OFF"}
              </button>
            )}
          </div>
        </div>

        <div className="cardBody">
          <div className="row" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <div className="muted">
                {(meta?.league ? meta.league.toUpperCase() : league.toUpperCase())} • {date} • Mode:{" "}
                <span style={{ color: "rgba(255,255,255,0.86)" }}>
                  {meta?.mode || (league === "ncaam" && tournament ? "tournament" : "regular")}
                </span>
              </div>
              <div className="muted2" style={{ marginTop: 6 }}>
                Model: {meta?.model || "—"} • Games: {games.length}
                {typeof meta?.noPickCount === "number" ? ` • PASS: ${meta.noPickCount}` : ""}
              </div>
            </div>

            <div className="muted2" style={{ textAlign: "right" }}>
              {loading ? "Loading…" : err ? `Error: ${err}` : ""}
            </div>
          </div>

          {!loading && !err && games.length === 0 && (
            <div className="muted" style={{ padding: "14px 0" }}>No games returned.</div>
          )}

          {games.map((g) => {
            const tier = g?.market?.tier || "PASS";
            const edge = g?.market?.edge ?? null;
            const pick = g?.market?.pick;
            const recName = g?.market?.recommendedTeamName || "";

            const home = g?.home || {};
            const away = g?.away || {};

            const awayLogo = getTeamLogo(league, away);
            const homeLogo = getTeamLogo(league, home);

            return (
              <div className="row" key={g.gameId} style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="gameTop">
                    <div className="teamLine">
                      {awayLogo ? <img className="logo" src={awayLogo} alt="" /> : null}
                      <strong>{away.abbr || away.name}</strong>
                      <span className="muted2">at</span>
                      {homeLogo ? <img className="logo" src={homeLogo} alt="" /> : null}
                      <strong>{home.abbr || home.name}</strong>
                      <span className="muted2" style={{ marginLeft: 8 }}>{g.status || ""}</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <TierBadge tier={tier} />
                      <EdgeText edge={edge} />
                      <span className="muted">{pick ? `Pick: ${recName}` : "No pick"}</span>
                    </div>
                  </div>

                  <WhyPanel why={g?.why} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
