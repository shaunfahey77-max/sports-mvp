import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const res = await fetch("http://127.0.0.1:3001/api/teams");
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setTeams(data);
      } catch (e) {
        setError(e?.message || "Failed to load teams");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Teams</h1>

      {loading && <p>Loading…</p>}
      {error && (
        <p style={{ color: "crimson" }}>
          {error} (Is the API running on 127.0.0.1:3001?)
        </p>
      )}

      {!loading && !error && (
        <ul>
          {teams.map((t) => (
            <li key={t.id}>
              <Link to={`/teams/${t.id}`}>{t.name}</Link> — {t.city}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
