import { useEffect, useState } from "react";
import "./App.css";

export default function App() {
  const [health, setHealth] = useState({ loading: true, ok: false, error: null });

  useEffect(() => {
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setHealth({ loading: false, ok: !!data.ok, error: null }))
      .catch((err) => setHealth({ loading: false, ok: false, error: err.message }));
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1>Sports MVP</h1>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8, maxWidth: 520 }}>
        <div><strong>API Health</strong></div>

        {health.loading && <div>Checking…</div>}
        {!health.loading && health.ok && <div>✅ Connected</div>}
        {!health.loading && !health.ok && (
          <div>
            ❌ Not connected
            <div style={{ opacity: 0.75, marginTop: 6 }}>Error: {health.error}</div>
          </div>
        )}

        <div style={{ opacity: 0.65, marginTop: 10 }}>
          GET <code>/api/health</code> (proxied to <code>http://localhost:3000</code>)
        </div>
      </div>
    </div>
  );
}
