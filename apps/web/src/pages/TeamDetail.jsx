import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

function inferLeagueFromTeamId(teamId) {
  if (typeof teamId !== "string") return null;
  if (teamId.startsWith("nba-")) return "nba";
  if (teamId.startsWith("nhl-")) return "nhl";
  return null;
}

function formatDateYYYYMMDD(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function TeamDetail() {
  const { id } = useParams();
  const league = useMemo(() => inferLeagueFromTeamId(id), [id]);

  const [team, setTeam] = useState(null);
  const [allTeamGames, setAllTeamGames] = useState([]); // all games involving this team
  const [date, setDate] = useState(() => formatDateYYYYMMDD(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Derived (filtered) view by date
  const gamesForDate = useMemo(() => {
    return allTeamGames.filter((g) => g.date === date);
  }, [allTeamGames, date]);

  useEffect(() => {
    async function load() {
      try {
        setError("");
        setLoading(true);
        setTeam(null);
        setAllTeamGames([]);

        if (!league) throw new Error(`Unknown team league for id: ${id}`);

        // 1) Team info
        const teamsRes = await fetch(`/api/${league}/teams`);
        if (!teamsRes.ok) throw new Error(`Teams API error: ${teamsRes.status}`);
        const teams = await teamsRes.json();

        const found = Array.isArray(teams) ? teams.find((t) => t.id === id) : null;
        if (!found) throw new Error(`Team not found: ${id}`);
        setTeam(found);

        // 2) All games (expand for abbr)
        const gamesRes = await fetch(`/api/${league}/games?expand=teams`);
        if (!gamesRes.ok) throw new Error(`Games API error: ${gamesRes.status}`);
        const games = await gamesRes.json();

        const filtered = Array.isArray(games)
          ? games.filter((g) => g.homeTeamId === id || g.awayTeamId === id)
          : [];

        filtered.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
        setAllTeamGames(filtered);
      } catch (e) {
        setError(e?.message || "Failed to load team");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id, league]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 12 }}>
        <Link to="/games" style={{ textDecoration: "none" }}>
          ← Back to Games
        </Link>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && !error && team && (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
            <h1 style={{ marginTop: 0, marginBottom: 0 }}>
              {team.name}{" "}
              <span style={{ fontSize: 14, opacity: 0.7, fontWeight: 600 }}>
                ({team.abbr})
              </span>
            </h1>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 14, opacity: 0.8 }}>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ padding: "6px 8px" }}
              />
            </label>
          </div>

          <p style={{ marginTop: 6, opacity: 0.85 }}>
            {team.city} • {league.toUpperCase()}
          </p>

          <h2 style={{ marginTop: 18, marginBottom: 8, fontSize: 18 }}>Games</h2>

          <p style={{ marginTop: 0, opacity: 0.75 }}>
            Showing {gamesForDate.length} on <b>{date}</b> • {allTeamGames.length} total for this team
          </p>

          {gamesForDate.length === 0 ? (
            <p>No games found for this team on {date}.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {gamesForDate.map((g) => {
                const away = g.awayTeam?.abbr || g.awayTeamId;
                const home = g.homeTeam?.abbr || g.homeTeamId;

                const isHome = g.homeTeamId === id;
                const vsText = isHome ? `vs ${away}` : `@ ${home}`;

                return (
                  <li key={g.id}>
                    {g.date} — {vsText}
                  </li>
                );
              })}
            </ul>
          )}

          {allTeamGames.length > 0 && (
            <>
              <h3 style={{ marginTop: 18, marginBottom: 8, fontSize: 16, opacity: 0.9 }}>
                All games for this team (stub)
              </h3>
              <ul style={{ paddingLeft: 18, opacity: 0.9 }}>
                {allTeamGames.map((g) => {
                  const away = g.awayTeam?.abbr || g.awayTeamId;
                  const home = g.homeTeam?.abbr || g.homeTeamId;
                  const isHome = g.homeTeamId === id;
                  const vsText = isHome ? `vs ${away}` : `@ ${home}`;
                  return (
                    <li key={g.id}>
                      {g.date} — {vsText}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
