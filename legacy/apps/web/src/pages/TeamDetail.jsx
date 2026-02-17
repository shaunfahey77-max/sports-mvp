// apps/web/src/pages/TeamDetail.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getNbaTeams } from "../lib/api";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

/**
 * ESPN logo fallback (works well for MVP).
 * NBA: https://a.espncdn.com/i/teamlogos/nba/500/bos.png
 * NHL: https://a.espncdn.com/i/teamlogos/nhl/500/bos.png
 */
function logoUrl(league, abbr) {
  const a = String(abbr || "").toLowerCase();
  if (!a) return "";
  const l = String(league || "").toLowerCase();
  const sport = l === "nhl" ? "nhl" : "nba";
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${a}.png`;
}

function TeamAvatar({ league, abbr, name, size = 34 }) {
  const [imgOk, setImgOk] = useState(true);
  const url = logoUrl(league, abbr);
  const fallback = (abbr || name || "?").slice(0, 3).toUpperCase();

  useEffect(() => setImgOk(true), [league, abbr]);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
      }}
      title={name || abbr || ""}
    >
      {url && imgOk ? (
        <img
          src={url}
          alt={abbr || name || "team"}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setImgOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 900 }}>{fallback}</span>
      )}
    </div>
  );
}

function stripPrefix(teamId) {
  return String(teamId || "")
    .replace("nba-", "")
    .replace("nhl-", "")
    .toUpperCase();
}

export default function TeamDetail() {
  const { league, teamId } = useParams();
  const activeLeague = String(league || "").toLowerCase();

  const [date, setDate] = useState(() => todayUTCYYYYMMDD());
  const [games, setGames] = useState([]);
  const [teamName, setTeamName] = useState(teamId);
  const [teamAbbr, setTeamAbbr] = useState(stripPrefix(teamId));
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      setErr("");
      setLoading(true);

      try {
        // ✅ league-specific games endpoint (fast + clean)
        const url = `/api/${activeLeague}/games?date=${encodeURIComponent(date)}&expand=teams`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API ${res.status} for ${url}`);
        const rows = await res.json();

        if (!alive) return;
        setGames(Array.isArray(rows) ? rows : []);

        // Resolve team display name
        if (activeLeague === "nba") {
          const teams = await getNbaTeams();
          if (!alive) return;
          const match = (teams || []).find((t) => t.id === teamId);
          if (match) {
            setTeamName(match.name || match.abbr || teamId);
            setTeamAbbr((match.abbr || stripPrefix(teamId)).toUpperCase());
          } else {
            setTeamName(stripPrefix(teamId));
            setTeamAbbr(stripPrefix(teamId));
          }
        } else {
          // NHL (no /api/nhl/teams yet): just use ID-derived abbr
          setTeamName(stripPrefix(teamId));
          setTeamAbbr(stripPrefix(teamId));
        }
      } catch (e) {
        if (!alive) return;
        setErr(String(e?.message || e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [activeLeague, teamId, date]);

  const teamGames = useMemo(() => {
    return (games || []).filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  }, [games, teamId]);

  const accent = activeLeague === "nhl" ? "var(--nhl)" : "var(--nba)";

  return (
    <div>
      <div className="badge" style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <span className="dot" style={{ background: accent }} />
        {String(activeLeague).toUpperCase()}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <TeamAvatar league={activeLeague} abbr={teamAbbr} name={teamName} size={40} />
        <div>
          <h1 className="h1" style={{ marginBottom: 2 }}>{teamName}</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Team detail (MVP). Slate snapshot + navigation.
          </p>
        </div>
      </div>

      <div className="panel">
        <div
          className="panelHead"
          style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <div style={{ fontWeight: 760, display: "flex", alignItems: "center", gap: 10 }}>
            Games on
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.9)",
              }}
            />
            <span className="muted">{loading ? "Loading…" : ""}</span>
          </div>

          <div className="controls" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {/* ✅ these routes exist in App.jsx */}
            <Link className="tab active" to={`/league/${activeLeague}`}>
              Back to {String(activeLeague).toUpperCase()} (Predictions)
            </Link>
            <Link className="tab" to={`/league/${activeLeague}/hub`}>
              Back to Hub
            </Link>
          </div>
        </div>

        <div className="list">
          {err ? <div className="error">Error: {err}</div> : null}

          {teamGames.length ? (
            teamGames.map((g) => {
              const homeAbbr = g.homeTeam?.abbr || stripPrefix(g.homeTeamId);
              const awayAbbr = g.awayTeam?.abbr || stripPrefix(g.awayTeamId);

              const hs = typeof g.homeScore === "number" ? g.homeScore : "-";
              const as = typeof g.awayScore === "number" ? g.awayScore : "-";

              const isHome = g.homeTeamId === teamId;
              const opponentId = isHome ? g.awayTeamId : g.homeTeamId;
              const opponentAbbr = isHome ? awayAbbr : homeAbbr;

              return (
                <div className="card" key={g.id}>
                  <div className="row" style={{ alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <TeamAvatar league={activeLeague} abbr={awayAbbr} name={awayAbbr} size={28} />
                      <div style={{ fontWeight: 820 }}>{awayAbbr} @ {homeAbbr}</div>
                      <TeamAvatar league={activeLeague} abbr={homeAbbr} name={homeAbbr} size={28} />
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="muted" style={{ fontWeight: 900 }}>{as}–{hs}</div>

                      {/* ✅ match App.jsx route */}
                      <Link className="tab" to={`/team/${activeLeague}/${opponentId}`} title="Open opponent">
                        vs {opponentAbbr}
                      </Link>
                    </div>
                  </div>

                  <div className="kicker">{g.status}</div>
                </div>
              );
            })
          ) : (
            <div className="card">
              <div className="muted">No games found for this team on this date.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
