import { useEffect, useState } from "react";
import PredictLiteCard from "../components/PredictLiteCard.jsx";

export default function Predict() {
  const [apiOk, setApiOk] = useState(null);
  const [apiErr, setApiErr] = useState(null);

  // quick sanity check from the browser (proves CORS + URL)
  useEffect(() => {
    const url =
      (import.meta.env.VITE_API_BASE || "http://127.0.0.1:3001") +
      "/api/nba/predict-lite?home=14&away=2&season=2024&date=2025-02-01";

    fetch(url)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j, status: r.status })))
      .then(({ ok, j, status }) => {
        if (!ok) throw new Error(j?.error || `API error ${status}`);
        setApiOk(j);
      })
      .catch((e) => setApiErr(String(e)));
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0f14] text-white p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">Predict (Debug)</h1>

        {/* PROVE THE PAGE IS RENDERING */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          If you can read this, the /predict route is rendering ✅
        </div>

        {/* PROVE THE API IS REACHABLE FROM BROWSER */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
          <div className="font-semibold">API check:</div>
          {apiErr && <div className="text-red-200 mt-1">{apiErr}</div>}
          {apiOk && (
            <div className="text-green-200 mt-1">
              API reachable ✅ ({apiOk.home?.abbr} vs {apiOk.away?.abbr})
            </div>
          )}
          {!apiErr && !apiOk && <div className="text-white/60 mt-1">Loading…</div>}
        </div>

        {/* THE CARD */}
        <PredictLiteCard
          homeTeamId={14}
          awayTeamId={2}
          season={2024}
          date="2025-02-01"
        />
      </div>
    </div>
  );
}
