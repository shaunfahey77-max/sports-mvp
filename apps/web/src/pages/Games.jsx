import { useEffect, useState } from "react";

export default function Games({ league = "nba" }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        setLoading(true);

        // Uses Vite proxy: /api -> http://127.0.0.1:3001
        const res = await fetch(`/api/${league}/games`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const data = await res.json();
        setGames(data);
      } catch (e) {
        setError(e.message || "Failed to load games");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [league]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>{league.toUpperCase()} Games</h1>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && !error && (
        <ul style={{ paddingLeft: 18 }}>
          {games.map((g) => (
            <li key={g.id}>
              {g.date} — {g.awayTeamId} @ {g.homeTeamId}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
