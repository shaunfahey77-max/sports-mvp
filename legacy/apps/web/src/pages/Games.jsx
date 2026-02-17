// apps/web/src/pages/Games.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getTeamLogo } from "../utils/teamLogo";

/**
 * LOCAL YYYY-MM-DD
 * This MUST match <input type="date"> semantics.
 */
function todayLocalYYYYMMDD() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function stripPrefix(idOrAbbr) {
  return String(idOrAbbr || "")
    .replace("nba-", "")
    .replace("nhl-", "")
    .replace("ncaam-", "")
    .toUpperCase();
}

function isNumericId(v) {
  const s = String(v ?? "").trim();
  return !!s && /^\d+$/.test(s);
}

/**
 * ESPN logo fallback (same behavior as Predict.jsx)
 * NBA:   https://a.espncdn.com/i/teamlogos/nba/500/bos.png
 * NHL:   https://a.espncdn.com/i/teamlogos/nhl/500/bos.png
 * NCAAM: https://a.espncdn.com/i/teamlogos/ncb/500/duke.png  (inconsistent; many 404)
 */
function logoUrlByAbbr(league, abbr) {
  const a = String(abbr || "").toLowerCase().trim();
  if (!a) return "";
  const l = String(league || "").toLowerCase();
  const sport = l === "nhl" ? "nhl" : l === "ncaam" ? "ncb" : "nba";
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${a}.png`;
}

/**
 * Better NCAAM fallback when you have numeric ESPN team id:
 * https://a.espncdn.com/i/teamlogos/ncaa/500/158.png
 */
function ncaamLogoFromEspnId(espnId) {
  const id = String(espnId || "").trim();
  if (!id) return "";
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
}

function TeamAvatar({ league, team, size = 28 }) {
  const [ok, setOk] = useState(true);

  const leagueLower = String(league || "").toLowerCase();

  const abbr =
    team?.abbr ||
    team?.abbreviation ||
    team?.code ||
    stripPrefix(team?.id || team?.teamId || "");

  const name = team?.name || team?.displayName || abbr || "";

  // Pull espnId if present (so we can use the more reliable ncaa/{id}.png endpoint)
  const espnId =
    team?.espnId ||
    team?.espnID ||
    team?.teamEspnId ||
    (isNumericId(team?.id) ? String(team.id) : "") ||
    (isNumericId(team?.teamId) ? String(team.teamId) : "") ||
    "";

  // ✅ Priority order (aligned with Predict.jsx, but safer):
  // 1) getTeamLogo() (direct logo fields Predictions likely relies on)
  // 2) NCAAM numeric id endpoint if we have an id
  // 3) ESPN by abbreviation (NBA/NHL reliable, NCAAM inconsistent but matches Predict behavior)
  const url =
    getTeamLogo(leagueLower, team) ||
    (leagueLower === "ncaam" ? ncaamLogoFromEspnId(espnId) : "") ||
    logoUrlByAbbr(leagueLower, abbr);

  const fallback = (abbr || name || "?").slice(0, 3).toUpperCase();

  useEffect(() => {
    setOk(true);
  }, [leagueLower, url, abbr, espnId]);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
      }}
      title={name || abbr || ""}
    >
      {url && ok ? (
        <img
          src={url}
          alt={abbr || name || "team"}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 900 }}>{fallback}</span>
      )}
    </div>
  );
}

function teamHref(leagueLower, teamId) {
  if (!teamId) return null;
  return `/league/${leagueLower}/team/${teamId}`;
}

function normalizeGame(activeLeague, g) {
  const homeTeam = g?.homeTeam || g?.home_team || null;
  const awayTeam = g?.awayTeam || g?.away_team || null;

  const homeTeamId = homeTeam?.id || g?.homeTeamId || g?.home_team_id || "";
  const awayTeamId = awayTeam?.id || g?.awayTeamId || g?.away_team_id || "";

  const homeAbbr =
    homeTeam?.abbr ||
    homeTeam?.abbreviation ||
    homeTeam?.code ||
    homeTeam?.short_name ||
    stripPrefix(homeTeamId);

  const awayAbbr =
    awayTeam?.abbr ||
    awayTeam?.abbreviation ||
    awayTeam?.code ||
    awayTeam?.short_name ||
    stripPrefix(awayTeamId);

  const homeName = homeTeam?.name || homeTeam?.full_name || homeTeam?.display_name || homeAbbr || "HOME";
  const awayName = awayTeam?.name || awayTeam?.full_name || awayTeam?.display_name || awayAbbr || "AWAY";

  const homeScore =
    typeof homeTeam?.score === "number"
      ? homeTeam.score
      : typeof g?.homeScore === "number"
        ? g.homeScore
        : typeof g?.home_team_score === "number"
          ? g.home_team_score
          : typeof g?.home_score === "number"
            ? g.home_score
            : null;

  const awayScore =
    typeof awayTeam?.score === "number"
      ? awayTeam.score
      : typeof g?.awayScore === "number"
        ? g.awayScore
        : typeof g?.away_team_score === "number"
          ? g.away_team_score
          : typeof g?.away_score === "number"
            ? g.away_score
            : null;

  // Capture logo-ish fields if present (so getTeamLogo can use them)
  const normalizeTeam = (t, id, abbr, name) => ({
    id,
    teamId: id,
    abbr: String(abbr || "").toUpperCase(),
    name,
    logo: t?.logo || t?.logos?.[0]?.href || t?.logos?.[0]?.url || null,
    logos: t?.logos || null,
    espnId: t?.espnId || t?.espnID || t?.teamEspnId || null,
  });

  return {
    id: g?.id || g?.gameId || `${awayAbbr}-${homeAbbr}-${g?.date || ""}`,
    date: g?.date || "",
    status: g?.status || g?.state || "",
    home: normalizeTeam(homeTeam, homeTeamId, homeAbbr, homeName),
    away: normalizeTeam(awayTeam, awayTeamId, awayAbbr, awayName),
  };
}

export default function Games({ league = "nba" }) {
  const { league: routeLeague } = useParams();
  const activeLeague = String(routeLeague || league || "nba").toLowerCase();

  const [gamesRaw, setGamesRaw] = useState([]);
  const [date, setDate] = useState(() => todayLocalYYYYMMDD());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const leagueLabel = useMemo(() => String(activeLeague).toUpperCase(), [activeLeague]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const url =
          activeLeague === "ncaam"
            ? `/api/ncaam/games?date=${encodeURIComponent(date)}&expand=teams`
            : `/api/${activeLeague}/games?date=${encodeURIComponent(date)}&expand=teams`;

        const res = await fetch(url);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (!cancelled) {
            setError(`Games API error: ${res.status}${text ? ` — ${text}` : ""}`);
            setGamesRaw([]);
          }
          return;
        }

        const data = await res.json();
        const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        if (!cancelled) setGamesRaw(rows);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Failed to load games");
          setGamesRaw([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeLeague, date]);

  const games = useMemo(() => {
    return (Array.isArray(gamesRaw) ? gamesRaw : []).map((g) => normalizeGame(activeLeague, g));
  }, [gamesRaw, activeLeague]);

  const pageBg = {
    minHeight: "100vh",
    padding: "28px 18px 48px",
    background:
      "radial-gradient(1200px 600px at 85% 20%, rgba(80,180,220,0.16), transparent 55%), radial-gradient(900px 500px at 15% 10%, rgba(120,90,220,0.14), transparent 60%), linear-gradient(180deg, rgba(7,12,18,1), rgba(8,14,24,1))",
    color: "rgba(255,255,255,0.92)",
  };

  const shell = { maxWidth: 1120, margin: "0 auto" };

  const card = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.22)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  };

  return (
    <div style={pageBg}>
      <div style={shell}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, letterSpacing: 0.2, opacity: 0.75, fontWeight: 900 }}>{leagueLabel}</div>
            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: 0.2 }}>Games</h1>
            <div style={{ fontSize: 13, opacity: 0.70 }}>Date-based slate (includes team logos).</div>
          </div>

          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, opacity: 0.70, fontWeight: 900 }}>Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.9)",
              }}
            />
          </label>
        </div>

        {/* Status */}
        <div style={{ marginTop: 16, ...card, padding: 14, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, opacity: 0.70 }}>
            Showing: <b>{date}</b> (local)
          </div>
          <div style={{ fontSize: 12, opacity: 0.70 }}>{loading ? "Loading…" : games.length ? `${games.length} games` : "—"}</div>
        </div>

        {error && (
          <div style={{ marginTop: 14, ...card, padding: 14, borderColor: "rgba(255,107,107,0.30)" }}>
            <div style={{ color: "rgba(255,107,107,0.95)", fontWeight: 900 }}>Error</div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>{error}</div>
          </div>
        )}

        {/* Games list */}
        <div style={{ marginTop: 16, ...card, padding: 14 }}>
          {!loading && !error && games.length === 0 && (
            <div style={{ marginTop: 6, opacity: 0.75 }}>No games scheduled for this date.</div>
          )}

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {games.map((g) => {
              const awayUrl = teamHref(activeLeague, g.away.id);
              const homeUrl = teamHref(activeLeague, g.home.id);

              const hasScores = typeof g.home.score === "number" || typeof g.away.score === "number";

              return (
                <div
                  key={g.id}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        {awayUrl ? (
                          <Link to={awayUrl} style={{ textDecoration: "none", color: "inherit" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <TeamAvatar league={activeLeague} team={g.away} />
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.away.abbr}</div>
                              <div style={{ opacity: 0.70, fontSize: 12 }}>{g.away.name}</div>
                            </div>
                          </Link>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <TeamAvatar league={activeLeague} team={g.away} />
                            <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.away.abbr}</div>
                            <div style={{ opacity: 0.70, fontSize: 12 }}>{g.away.name}</div>
                          </div>
                        )}

                        <div style={{ opacity: 0.65, fontWeight: 900 }}>@</div>

                        {homeUrl ? (
                          <Link to={homeUrl} style={{ textDecoration: "none", color: "inherit" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ opacity: 0.70, fontSize: 12 }}>{g.home.name}</div>
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.home.abbr}</div>
                              <TeamAvatar league={activeLeague} team={g.home} />
                            </div>
                          </Link>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ opacity: 0.70, fontSize: 12 }}>{g.home.name}</div>
                            <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.home.abbr}</div>
                            <TeamAvatar league={activeLeague} team={g.home} />
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.65 }}>
                        {g.status ? String(g.status) : ""}
                        {g.date ? (g.status ? " • " : "") + String(g.date) : ""}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(0,0,0,0.20)",
                        minWidth: 130,
                        textAlign: "right",
                        fontWeight: 950,
                      }}
                    >
                      {hasScores ? (
                        <span>
                          {g.away.score ?? "—"} <span style={{ opacity: 0.6 }}>–</span> {g.home.score ?? "—"}
                        </span>
                      ) : (
                        <span style={{ opacity: 0.70, fontWeight: 800 }}>No score</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
