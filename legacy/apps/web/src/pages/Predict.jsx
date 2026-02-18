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

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function asNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function toPct(p) {
  const x = asNum(p);
  if (x == null) return "—";
  return `${Math.round(x * 100)}%`;
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
  // premium contract: {headline, bullets:[]}
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

/**
 * Try to parse "AWAY @ HOME" (or "AWAY at HOME") into teams.
 */
function splitMatchup(matchup) {
  const s = String(matchup || "").trim();
  if (!s) return null;

  // common formats:
  // "MICH @ PUR"
  // "Michigan @ Purdue"
  // "Michigan at Purdue"
  const at = s.includes(" @ ") ? " @ " : s.toLowerCase().includes(" at ") ? " at " : null;
  if (!at) return null;

  const [a, h] = s.split(at);
  const away = String(a || "").trim();
  const home = String(h || "").trim();
  if (!away || !home) return null;
  return { away, home };
}

/**
 * Convert NCAAM ESPN-predict rows (gameId, matchup, pickSide, winProb, edge, tier, confidence)
 * into the premium-ish contract used by the UI (home/away/market).
 * Optionally merge with /api/ncaam/games for better team names/abbr.
 */
function normalizeNcaamToPremium(predictJson, gamesJson) {
  const meta = predictJson?.meta || {};
  const predGames = Array.isArray(predictJson?.games) ? predictJson.games : [];

  const slateGames = Array.isArray(gamesJson?.games) ? gamesJson.games : [];
  const byGameId = new Map();
  for (const g of slateGames) {
    if (g?.gameId) byGameId.set(String(g.gameId), g);
  }

  const out = predGames.map((p) => {
    const gameId = p?.gameId ? String(p.gameId) : null;
    const slate = gameId ? byGameId.get(gameId) : null;

    // Slate games endpoint you showed returns {home, away} objects with names.
    const slateHome = slate?.home || slate?.homeTeam || null;
    const slateAway = slate?.away || slate?.awayTeam || null;

    // Fall back to parsing matchup
    const parsed = splitMatchup(p?.matchup);
    const awayLabel = parsed?.away || p?.away || "";
    const homeLabel = parsed?.home || p?.home || "";

    const away = {
      id: slateAway?.id || null,
      abbr: slateAway?.abbr || (awayLabel.length <= 5 ? awayLabel : null),
      name: slateAway?.name || awayLabel || "AWAY",
      logo: slateAway?.logo || null,
    };

    const home = {
      id: slateHome?.id || null,
      abbr: slateHome?.abbr || (homeLabel.length <= 5 ? homeLabel : null),
      name: slateHome?.name || homeLabel || "HOME",
      logo: slateHome?.logo || null,
    };

    const pickSide = p?.pickSide || null; // "home" | "away" | null
    const winProb = asNum(p?.winProb);
    const edge = asNum(p?.edge);
    const confidence = asNum(p?.confidence);

    let recommendedTeamName = null;
    if (pickSide === "home") recommendedTeamName = home?.name || home?.abbr || "Home";
    if (pickSide === "away") recommendedTeamName = away?.name || away?.abbr || "Away";

    const tier = p?.tier || null;

    return {
      gameId: gameId || null,
      league: "ncaam",
      date: meta?.date || null,
      status: slate?.status || slate?.state || p?.status || "Scheduled",

      home,
      away,

      // premium-ish market contract expected by your UI + upsets route
      market: {
        tier: tier || (winProb != null ? (winProb >= 0.64 ? "A" : winProb >= 0.59 ? "B" : winProb >= 0.55 ? "C" : "D") : "PASS"),
        pick: pickSide,
        winProb: winProb, // picked-side win probability
        edge: edge,
        confidence: confidence != null ? clamp(confidence, 0.05, 0.95) : null,
        recommendedTeamName,
        recommendedTeamId: pickSide === "home" ? home?.id : pickSide === "away" ? away?.id : null,
      },

      // minimal factors so Upset Watch can still compute a gap without CBBD
      // (record rank model doesn’t have margins/recent; keep them null)
      factors: {
        homeWinPct: null,
        awayWinPct: null,
        homeMarginPerGame: null,
        awayMarginPerGame: null,
        homeRecentWinPct: null,
        awayRecentWinPct: null,
      },

      why: null,
      _raw: { predict: p, slate },
    };
  });

  return { meta, games: out };
}

/**
 * Detect whether a response looks like the premium contract.
 */
function looksPremium(j) {
  const games = Array.isArray(j?.games) ? j.games : Array.isArray(j?.predictions) ? j.predictions : null;
  if (!games || !games.length) return false;
  const g0 = games[0];
  return !!(g0?.home && g0?.away && (g0?.market || g0?.pick));
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
  const [data, setData] = useState(null); // normalized premium-ish payload: {meta, games}

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

  const premiumUrl = useMemo(() => {
    // Preferred unified endpoint
    const params = new URLSearchParams();
    params.set("league", league);
    params.set("date", date);
    if (league === "ncaam" && tournament) params.set("mode", "tournament");
    return `/api/predictions?${params.toString()}`;
  }, [league, date, tournament]);

  useEffect(() => {
    let alive = true;

    async function fetchJson(url) {
      const r = await fetch(url);
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = j?.error || `Request failed (${r.status})`;
        const e = new Error(msg);
        e.status = r.status;
        throw e;
      }
      return j;
    }

    async function run() {
      setLoading(true);
      setErr("");

      try {
        // 1) Try unified /api/predictions first
        let j = null;
        try {
          j = await fetchJson(premiumUrl);
        } catch (e) {
          // if unified endpoint missing or fails, fallback below
          j = null;
        }

        // If it already looks premium, normalize lightly and use it
        if (j && looksPremium(j)) {
          const meta = j?.meta || {};
          const games = Array.isArray(j?.games) ? j.games : Array.isArray(j?.predictions) ? j.predictions : [];
          if (!alive) return;
          setData({ meta, games });
          return;
        }

        // 2) League-specific fallbacks (keeps you stable)
        if (league === "ncaam") {
          // Fetch ESPN slate + ESPN picks and merge
          const [slate, picks] = await Promise.all([
            fetchJson(`/api/ncaam/games?date=${encodeURIComponent(date)}`),
            fetchJson(`/api/ncaam/predict?date=${encodeURIComponent(date)}`),
          ]);

          const normalized = normalizeNcaamToPremium(picks, slate);

          const meta = {
            ...(normalized?.meta || {}),
            league: "ncaam",
            date,
            mode: tournament ? "tournament" : "regular",
            // show source/model clearly
            model: picks?.meta?.model || normalized?.meta?.model || "NCAAM",
            source: picks?.meta?.source || normalized?.meta?.source || "espn-scoreboard",
          };

          if (!alive) return;
          setData({ meta, games: normalized.games || [] });
          return;
        }

        // NBA/NHL: try /api/{league}/predict as a last resort
        const legacy = await fetchJson(`/api/${league}/predict?date=${encodeURIComponent(date)}`);
        const meta = legacy?.meta || { league, date };
        const games = Array.isArray(legacy?.games) ? legacy.games : [];

        if (!alive) return;
        setData({ meta, games });
      } catch (e) {
        if (!alive) return;
        setData(null);
        setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [premiumUrl, league, date, tournament]);

  const meta = data?.meta || {};
  const games = Array.isArray(data?.games) ? data.games : [];

  return (
    <div className="container">
      <div className="card">
        <div className="cardHeader">
          <div>
            <div className="h1" style={{ fontSize: 22, margin: 0 }}>
              Predictions
            </div>
            <p className="sub" style={{ marginTop: 6 }}>
              Tier + Edge + Win% + Confidence (premium contract)
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="tabs">
              <button className={`tab ${league === "nba" ? "tabActive" : ""}`} onClick={() => goLeague("nba")}>
                NBA
              </button>
              <button className={`tab ${league === "nhl" ? "tabActive" : ""}`} onClick={() => goLeague("nhl")}>
                NHL
              </button>
              <button className={`tab ${league === "ncaam" ? "tabActive" : ""}`} onClick={() => goLeague("ncaam")}>
                NCAAM
              </button>
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
                {(meta?.league ? String(meta.league).toUpperCase() : league.toUpperCase())} • {date} • Mode:{" "}
                <span style={{ color: "rgba(255,255,255,0.86)" }}>
                  {meta?.mode || (league === "ncaam" && tournament ? "tournament" : "regular")}
                </span>
              </div>

              <div className="muted2" style={{ marginTop: 6 }}>
                Model: {meta?.model || "—"} • Games: {games.length}
                {typeof meta?.noPickCount === "number" ? ` • PASS: ${meta.noPickCount}` : ""}
                {meta?.source ? ` • Source: ${meta.source}` : ""}
              </div>
            </div>

            <div className="muted2" style={{ textAlign: "right" }}>
              {loading ? "Loading…" : err ? `Error: ${err}` : ""}
            </div>
          </div>

          {!loading && !err && games.length === 0 && (
            <div className="muted" style={{ padding: "14px 0" }}>
              No games returned.
            </div>
          )}

          {games.map((g) => {
            const home = g?.home || g?.homeTeam || {};
            const away = g?.away || g?.awayTeam || {};

            // Support both shapes: g.market (preferred) or legacy top-level fields
            const market = g?.market || g?.pick || {};
            const tier = market?.tier || g?.tier || "PASS";
            const edge = market?.edge ?? g?.edge ?? null;
            const winProb = market?.winProb ?? g?.winProb ?? null;
            const conf = market?.confidence ?? g?.confidence ?? null;
            const pickSide = market?.pick ?? g?.pickSide ?? null;

            const recName =
              market?.recommendedTeamName ||
              (pickSide === "home" ? (home?.name || home?.abbr) : pickSide === "away" ? (away?.name || away?.abbr) : "") ||
              "";

            const awayLogo = getTeamLogo(league, away);
            const homeLogo = getTeamLogo(league, home);

            return (
              <div className="row" key={g.gameId || `${away?.abbr || away?.name}-at-${home?.abbr || home?.name}`} style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="gameTop">
                    <div className="teamLine">
                      {awayLogo ? <img className="logo" src={awayLogo} alt="" /> : null}
                      <strong>{away.abbr || away.name || "AWAY"}</strong>
                      <span className="muted2">at</span>
                      {homeLogo ? <img className="logo" src={homeLogo} alt="" /> : null}
                      <strong>{home.abbr || home.name || "HOME"}</strong>
                      <span className="muted2" style={{ marginLeft: 8 }}>
                        {g.status || ""}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <TierBadge tier={tier} />
                      <EdgeText edge={typeof edge === "number" ? edge : asNum(edge)} />
                      <span className="pill">Win: {toPct(winProb)}</span>
                      <span className="pill">Conf: {toPct(conf)}</span>
                      <span className="muted">{pickSide ? `Pick: ${recName}` : "No pick"}</span>
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
