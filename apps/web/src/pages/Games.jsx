import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

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

export default function Games({ league = "nba" }) {
  const [games, setGames] = useState([]);
  const [date, setDate] = useState(() => todayLocalYYYYMMDD());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const leagueLabel = useMemo(() => String(league).toUpperCase(), [league]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        // IMPORTANT: send the date string EXACTLY as YYYY-MM-DD
        const url = `/api/${league}/games?date=${encodeURIComponent(
          date
        )}&expand=teams`;

        const res = await fetch(url);

        if (!res.ok) {
          if (!cancelled) {
            setError(`Games API error: ${res.status}`);
            setGames([]);
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setGames(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Failed to load games");
          setGames([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [league, date]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{leagueLabel} Games</h1>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 14, opacity: 0.8 }}>Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)} // keep string
            style={{ padding: "6px 8px" }}
          />
        </label>

        <span style={{ fontSize: 12, opacity: 0.6 }}>
          Showing: {date} (local)
        </span>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {!loading && !error && games.length === 0 && (
        <p style={{ opacity: 0.75 }}>No games scheduled for this date.</p>
      )}

      {!loading && !error && games.length > 0 && (
        <ul style={{ paddingLeft: 18 }}>
          {games.map((g) => {
            const away = g.awayTeam?.abbr || g.awayTeam?.name || g.awayTeamId;
            const home = g.homeTeam?.abbr || g.homeTeam?.name || g.homeTeamId;

            return (
              <li key={g.id}>
                {g.date} —{" "}
                <Link to={`/teams/${g.awayTeamId}`} style={{ fontWeight: 700 }}>
                  {away}
                </Link>{" "}
                @{" "}
                <Link to={`/teams/${g.homeTeamId}`} style={{ fontWeight: 700 }}>
                  {home}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
