import { useEffect, useMemo, useState } from "react";

function formatDateYYYYMMDD(d) {
  // local date -> YYYY-MM-DD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Games({ league = "nba" }) {
  const [games, setGames] = useState([]);
  const [date, setDate] = useState(() => formatDateYYYYMMDD(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const leagueLabel = useMemo(() => league.toUpperCase(), [league]);

  useEffect(() => {
    async function load() {
      try {
        setError("");
        setLoading(true);

        // If you're using a Vite proxy, this is perfect:
        // /api -> http://127.0.0.1:3001
        //
        // Uses the new API: ?date=YYYY-MM-DD&expand=teams
        const res = await fetch(
          `/api/${league}/games?date=${encodeURIComponent(date)}&expand=teams`
        );

        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const data = await res.json();
        setGames(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e?.message || "Failed to load games");
        setGames([]);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [league, date]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>{leagueLabel} Games</h1>

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

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && !error && games.length === 0 && <p>No games found.</p>}

      {!loading && !error && games.length > 0 && (
        <ul style={{ paddingLeft: 18 }}>
          {games.map((g) => {
            const away = g.awayTeam?.abbr || g.awayTeam?.name || g.awayTeamId;
            const home = g.homeTeam?.abbr || g.homeTeam?.name || g.homeTeamId;

            return (
              <li key={g.id}>
                {g.date} — {away} @ {home}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
