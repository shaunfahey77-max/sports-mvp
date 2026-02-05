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
  return String(idOrAbbr || "").replace("nba-", "").replace("nhl-", "").toUpperCase();
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

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");

      try {
        const [h, nbaGames, nhlGames, nbaPred, nhlPred] = await Promise.all([
          fetchJson("/api/health"),
          fetchJson(`/api/nba/games?date=${encodeURIComponent(date)}&expand=teams`),
          fetchJson(`/api/nhl/games?date=${encodeURIComponent(date)}&expand=teams`),
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
    // ✅ FIX: Home was being constrained/weird due to wrapper mismatch.
    // Wrap in full-width, then re-apply the normal container for consistent padding/max-width.
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
