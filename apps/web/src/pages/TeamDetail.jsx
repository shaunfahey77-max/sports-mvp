import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

export default function TeamDetail() {
  const { id } = useParams();
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const res = await fetch(`http://127.0.0.1:3001/api/teams/${id}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setTeam(data);
      } catch (e) {
        setError(e?.message || "Failed to load team");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  return (
    <div style={{ padding: 24 }}>
      <Link to="/">← Back</Link>

      {loading && <p>Loading…</p>}
      {error && (
        <p style={{ color: "crimson" }}>
          {error} (Is the API running on 127.0.0.1:3001?)
        </p>
      )}

      {team && (
        <>
          <h1 style={{ marginTop: 12 }}>{team.name}</h1>
          <p>City: {team.city}</p>
          <p>ID: {team.id}</p>
        </>
      )}
    </div>
  );
}
