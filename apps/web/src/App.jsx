import { useEffect, useState } from "react";
import "./App.css";

export default function App() {
  const [health, setHealth] = useState({
    loading: true,
    ok: false,
    error: null,
  });

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) =>
        setHealth({ loading: false, ok: !!data.ok, error: null })
      )
      .catch((err) =>
        setHealth({ loading: false, ok: false, error: err.message })
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
          maxWidth: 420,
        }}
      >
        <strong>API Health</strong>

        {health.loading && <div>Checking…</div>}
        {!health.loading && health.ok && <div>✅ Connected</div>}
        {!health.loading && !health.ok && (
          <div>❌ Not connected: {health.error}</div>
        )}

        <div style={{ marginTop: 8, opacity: 0.6 }}>
          GET <code>/api/health</code>
        </div>
      </div>
    </div>
  );
}
