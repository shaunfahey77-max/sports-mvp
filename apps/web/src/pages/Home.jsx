// apps/web/src/pages/Home.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function pct(conf) {
  const n = Number(conf);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function stripPrefix(idOrAbbr) {
  return String(idOrAbbr || "")
    .replace("nba-", "")
    .replace("nhl-", "")
    .replace("ncaam-", "")
    .toUpperCase();
}

function shortWinner(name) {
  const s = String(name || "—").trim();
  if (s.length <= 4) return s.toUpperCase();
  const first = s.split(" ")[0] || s;
  return first.slice(0, 4).toUpperCase();
}

function pickFromPredPayload(payload) {
  const preds = Array.isArray(payload?.predictions)
    ? payload.predictions
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload)
        ? payload
        : [];

  if (!preds.length) return null;

  const sorted = [...preds].sort((a, b) => {
    const ac = Number(a?.prediction?.confidence ?? a?.confidence ?? 0);
    const bc = Number(b?.prediction?.confidence ?? b?.confidence ?? 0);
    return bc - ac;
  });

  const p = sorted[0];
  const homeAbbr = p.home?.abbr || p.homeTeam?.abbr || stripPrefix(p.homeTeamId);
  const awayAbbr = p.away?.abbr || p.awayTeam?.abbr || stripPrefix(p.awayTeamId);

  return {
    away: awayAbbr || "AWAY",
    home: homeAbbr || "HOME",
    winnerName: p?.prediction?.winnerName || "—",
    confidence: p?.prediction?.confidence ?? p?.confidence ?? null,
    status: p?.status || "",
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let extra = "";
    try {
      const j = await res.json();
      if (j?.error) extra = ` — ${j.error}`;
    } catch {}
    throw new Error(`API error: ${res.status}${extra}`);
  }
  return res.json();
}

export default function Home() {
  const date = useMemo(() => todayUTCYYYYMMDD(), []);
  const windowDays = useMemo(() => {
    const env = Number(import.meta?.env?.VITE_PREDICTIONS_WINDOW);
    return Number.isFinite(env) ? env : 5;
  }, []);

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState(null);
  const [err, setErr] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  const [nba, setNba] = useState({ gamesCount: null, topPick: null, meta: null });
  const [nhl, setNhl] = useState({ gamesCount: null, topPick: null, meta: null });

  // ✅ NEW: NCAAM state (games only for now)
  const [ncaam, setNcaam] = useState({ gamesCount: null });

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");

      try {
        const [h, nbaGames, nhlGames, ncaamGames, nbaPred, nhlPred] = await Promise.all([
          fetchJson("/api/health"),
          fetchJson(`/api/nba/games?date=${encodeURIComponent(date)}&expand=teams`),
          fetchJson(`/api/nhl/games?date=${encodeURIComponent(date)}&expand=teams`),
          // ✅ NEW: NCAAM games (your API expects ?date=... not dates[]=...)
          fetchJson(`/api/ncaam/games?date=${encodeURIComponent(date)}&expand=teams`),
          fetchJson(`/api/nba/predict?date=${encodeURIComponent(date)}&window=${encodeURIComponent(windowDays)}`),
          fetchJson(`/api/nhl/predict?date=${encodeURIComponent(date)}&window=${encodeURIComponent(windowDays)}`),
        ]);

        if (!alive) return;

        setHealth(h);

        const nbaGamesCount = Array.isArray(nbaGames)
          ? nbaGames.length
          : Array.isArray(nbaGames?.games)
            ? nbaGames.games.length
            : 0;

        const nhlGamesCount = Array.isArray(nhlGames)
          ? nhlGames.length
          : Array.isArray(nhlGames?.games)
            ? nhlGames.games.length
            : 0;

        const ncaamGamesCount = Array.isArray(ncaamGames)
          ? ncaamGames.length
          : Array.isArray(ncaamGames?.games)
            ? ncaamGames.games.length
            : 0;

        setNba({
          gamesCount: nbaGamesCount,
          topPick: pickFromPredPayload(nbaPred),
          meta: nbaPred?.meta || null,
        });

        setNhl({
          gamesCount: nhlGamesCount,
          topPick: pickFromPredPayload(nhlPred),
          meta: nhlPred?.meta || null,
        });

        setNcaam({
          gamesCount: ncaamGamesCount,
        });

        setLastUpdated(new Date().toLocaleString());
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [date, windowDays]);

  return (
    <div className="homeFull">
      <div className="container">
        <div className="home">
          <div className="homeHero">
            <div>
              <h1 className="homeTitle">Sports MVP</h1>
              <div className="homeSub">Today at a glance — games by date + model predictions with confidence.</div>
            </div>

            <div className="homeMeta">
              <div className={`statusPill ${health?.ok ? "ok" : "bad"}`}>API: {health?.ok ? "Online" : "Offline"}</div>
              <div className="mutedSmall">Window: {windowDays}d</div>
              <div className="mutedSmall">Last updated: {lastUpdated || "—"}</div>
            </div>
          </div>

          {err ? (
            <div className="homeError">
              <div className="homeErrorTitle">Couldn’t load dashboard</div>
              <div className="homeErrorBody">{err}</div>
              <div className="homeErrorActions">
                <Link className="btnPrimary" to="/league/nba">
                  Open NBA
                </Link>
                <Link className="btnGhost" to="/league/nhl">
                  Open NHL
                </Link>
                <Link className="btnGhost" to="/league/ncaam">
                  Open NCAAM
                </Link>
              </div>
            </div>
          ) : null}

          <div className="homeGrid">
            <LeagueCard
              league="NBA"
              to="/league/nba"
              accent="nba"
              date={date}
              loading={loading}
              gamesCount={nba.gamesCount}
              topPick={nba.topPick}
              meta={nba.meta}
            />

            <LeagueCard
              league="NHL"
              to="/league/nhl"
              accent="nhl"
              date={date}
              loading={loading}
              gamesCount={nhl.gamesCount}
              topPick={nhl.topPick}
              meta={nhl.meta}
            />

            {/* ✅ NEW: NCAAM (games-only card for now) */}
            <NcaamCard date={date} loading={loading} gamesCount={ncaam.gamesCount} />
          </div>

          <div className="homeFooterCard">
            <div className="homeFooterLeft">
              <div className="homeFooterTitle">Upset Watch</div>
              <div className="homeFooterBody">
                Underdog candidates with real win equity (based on today’s model slate). Mounted now — full page lives in
                the logged-in area.
              </div>
            </div>
            <div className="homeFooterRight">
              <Link className="btnPrimary" to="/upsets">
                Open Upsets
              </Link>
              <Link className="btnGhost" to="/league/nba">
                NBA Slate
              </Link>
              <Link className="btnGhost" to="/league/nhl">
                NHL Slate
              </Link>
              <Link className="btnGhost" to="/league/ncaam">
                NCAAM Slate
              </Link>
            </div>
          </div>

          <div className="homeFooterCard">
            <div className="homeFooterLeft">
              <div className="homeFooterTitle">What this is</div>
              <div className="homeFooterBody">
                MVP-first: stable API + premium UX. The model card on each league page explains training window, samples,
                and adjustments (rest / home advantage).
              </div>
            </div>
            <div className="homeFooterRight">
              <Link className="btnGhost" to="/league/nba">
                NBA Predictions
              </Link>
              <Link className="btnGhost" to="/league/nhl">
                NHL Predictions
              </Link>
              <Link className="btnGhost" to="/league/ncaam">
                NCAAM Games
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeagueCard({ league, to, accent, date, loading, gamesCount, topPick, meta }) {
  const modelLine = meta?.model ? meta.model : "Model: —";
  const note = meta?.note ? meta.note : "";

  return (
    <div className={`leagueCard ${accent}`}>
      <div className="leagueCardHead">
        <div className="leagueBadge">
          <span className="leagueDot" />
          {league}
        </div>
        <div className="mutedSmall">{date}</div>
      </div>

      <div className="leagueCardTitle">{league} Games & Predictions</div>
      <div className="leagueCardSub">{loading ? "Loading…" : gamesCount != null ? `${gamesCount} games today` : "—"}</div>

      <div className="leagueCardPick">
        <div className="pickLabel">Top pick</div>
        {loading ? (
          <div className="pickRow skeleton" />
        ) : topPick ? (
          <div className="pickRow">
            <div className="pickMatch">
              <span className="pickTeam">{topPick.away}</span>
              <span className="mutedSmall">@</span>
              <span className="pickTeam">{topPick.home}</span>
            </div>
            <div className="pickRight">
              <span className="pickWinner">Pick {shortWinner(topPick.winnerName)}</span>
              <span className="pickConf">{pct(topPick.confidence)}</span>
            </div>
          </div>
        ) : (
          <div className="mutedSmall">No predictions yet.</div>
        )}
      </div>

      <div className="leagueCardMeta">
        <div className="mutedSmall">{modelLine}</div>
        {note ? (
          <div className="mutedSmall" style={{ opacity: 0.65 }}>
            {note}
          </div>
        ) : null}
      </div>

      <div className="leagueCardActions">
        <Link className="btnPrimary" to={to}>
          Open {league}
        </Link>
        <Link className="btnGhost" to={to}>
          Predictions
        </Link>
      </div>
    </div>
  );
}

/**
 * ✅ NCAAM card (games-only for now)
 * Uses existing button classes so it matches your theme.
 */
function NcaamCard({ date, loading, gamesCount }) {
  return (
    <div className="leagueCard ncaam">
      <div className="leagueCardHead">
        <div className="leagueBadge">
          <span className="leagueDot" />
          NCAAM
        </div>
        <div className="mutedSmall">{date}</div>
      </div>

      <div className="leagueCardTitle">NCAAM Games</div>
      <div className="leagueCardSub">{loading ? "Loading…" : gamesCount != null ? `${gamesCount} games today` : "—"}</div>

      <div className="leagueCardPick">
        <div className="pickLabel">Top 25</div>
        <div className="mutedSmall" style={{ opacity: 0.85 }}>
          AP Top 25 is live in the API.
        </div>
      </div>

      <div className="leagueCardMeta">
        <div className="mutedSmall">Games-only (predictions coming soon)</div>
      </div>

      <div className="leagueCardActions">
        <Link className="btnPrimary" to="/league/ncaam">
          Open NCAAM
        </Link>
        <Link className="btnGhost" to="/league/ncaam">
          Games
        </Link>
      </div>
    </div>
  );
}
