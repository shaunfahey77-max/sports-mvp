import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

function inferLeagueFromTeamId(teamId) {
  if (typeof teamId !== "string") return null;
  if (teamId.startsWith("nba-")) return "nba";
  if (teamId.startsWith("nhl-")) return "nhl";
  return null;
}

export default function TeamDetail() {
  const { id } = useParams(); // e.g. "nba-bos"
  const league = useMemo(() => inferLeagueFromTeamId(id), [id]);

  const [team, setTeam] = useState(null);
  const [teamGames, setTeamGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        setLoading(true);
        setTeam(null);
        setTeamGames([]);

        if (!league) {
          throw new Error(`Unknown team league for id: ${id}`);
        }

        // Fetch team list, find the team
        const teamsRes = await fetch(`/api/${league}/teams`);
        if (!teamsRes.ok) throw new Error(`Teams API error: ${teamsRes.status}`);
        const teams = await teamsRes.json();

        const found = Array.isArray(teams) ? teams.find((t) => t.id === id) : null;
        if (!found) throw new Error(`Team not found: ${id}`);

        setTeam(found);

        // Fetch games (no date = all stub games). Expand so UI can show abbr/names.
        const gamesRes = await fetch(`/api/${league}/games?expand=teams`);
        if (!gamesRes.ok) throw new Error(`Games API error: ${gamesRes.status}`);
        const games = await gamesRes.json();

        const filtered = Array.isArray(games)
          ? games.filter((g) => g.homeTeamId === id || g.awayTeamId === id)
          : [];

        // Sort by date ascending (YYYY-MM-DD sorts lexicographically)
        filtered.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));

        setTeamGames(filtered);
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
          <h1 style={{ marginTop: 0, marginBottom: 6 }}>
            {team.name}{" "}
            <span style={{ fontSize: 14, opacity: 0.7, fontWeight: 600 }}>
              ({team.abbr})
            </span>
          </h1>

          <p style={{ marginTop: 0, opacity: 0.85 }}>
            {team.city} • {league.toUpperCase()}
          </p>

          <h2 style={{ marginTop: 18, marginBottom: 8, fontSize: 18 }}>
            Games
          </h2>

          {teamGames.length === 0 ? (
            <p>No games found for this team.</p>
          ) : (
            <ul style={{ paddingLeft: 18 }}>
              {teamGames.map((g) => {
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
        </>
      )}
    </div>
  );
}
