import { useEffect, useState } from "react";
import "./App.css";

export default function App() {
  const [health, setHealth] = useState({
    loading: true,
    ok: false,
    error: null,
  });

  const [teamsState, setTeamsState] = useState({
    loading: true,
    data: [],
    error: null,
  });

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setHealth({ loading: false, ok: !!data.ok, error: null }))
      .catch((err) =>
        setHealth({ loading: false, ok: false, error: err.message })
      );
  }, []);

  useEffect(() => {
    fetch("/api/teams")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setTeamsState({ loading: false, data, error: null }))
      .catch((err) =>
        setTeamsState({ loading: false, data: [], error: err.message })
      );
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Sports MVP</h1>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
          maxWidth: 520,
        }}
      >
        <strong>API Health</strong>
        <div style={{ marginTop: 8 }}>
          {health.loading && "Checking…"}
          {!health.loading && health.ok && "✅ Connected"}
          {!health.loading && !health.ok && `❌ Not connected: ${health.error}`}
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
          maxWidth: 720,
        }}
      >
        <strong>Teams</strong>

        <div style={{ marginTop: 10 }}>
          {teamsState.loading && "Loading teams…"}
          {!teamsState.loading && teamsState.error && `❌ ${teamsState.error}`}
        </div>

        {!teamsState.loading && !teamsState.error && (
          <ul style={{ marginTop: 10 }}>
            {teamsState.data.map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong> <span style={{ opacity: 0.7 }}>— {t.city}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
