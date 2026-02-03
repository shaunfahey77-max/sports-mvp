import { useEffect, useMemo, useState } from "react";

const DEFAULT_API_BASE = "http://127.0.0.1:3001";

function pct(x) {
  if (typeof x !== "number") return "—";
  return `${Math.round(x * 100)}%`;
}

function fmtSigned(x) {
  if (typeof x !== "number") return "—";
  const v = Number(x.toFixed(1));
  return v > 0 ? `+${v}` : `${v}`;
}

export default function PredictLiteCard({
  homeTeamId,     // numeric (balldontlie team id)
  awayTeamId,     // numeric (balldontlie team id)
  season = 2024,
  date,           // "YYYY-MM-DD" (optional but recommended)
  apiBase,        // optional override
  className = "",
}) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [error, setError] = useState(null);

  const base = apiBase || import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

  const url = useMemo(() => {
    if (!homeTeamId || !awayTeamId) return null;
    const u = new URL(`${base}/api/nba/predict-lite`);
    u.searchParams.set("home", String(homeTeamId));
    u.searchParams.set("away", String(awayTeamId));
    u.searchParams.set("season", String(season));
    if (date) u.searchParams.set("date", date);
    return u.toString();
  }, [base, homeTeamId, awayTeamId, season, date]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!url) return;
      setStatus("loading");
      setError(null);

      try {
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }

        if (!cancelled) {
          setData(json);
          setStatus("success");
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e?.message || "Unknown error");
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [url]);

  if (!homeTeamId || !awayTeamId) {
    return (
      <div className={`rounded-xl border border-white/10 bg-white/5 p-4 ${className}`}>
        <div className="text-sm text-white/70">Prediction</div>
        <div className="mt-1 text-white/60 text-sm">
          Waiting for matchup (home/away team IDs missing).
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-white/70">Prediction (ELO-Lite)</div>
          <div className="mt-1 text-white text-base font-semibold">
            {status === "success"
              ? `${data?.home?.abbr ?? "HOME"} vs ${data?.away?.abbr ?? "AWAY"}`
              : "Loading matchup…"}
          </div>
          <div className="text-xs text-white/50 mt-1">
            {date ? `As of ${date}` : `Season ${season}`}
          </div>
        </div>

        {status === "success" && (
          <div className="text-right">
            <div className="text-xs text-white/60">Home win</div>
            <div className="text-2xl font-bold text-white">
              {pct(data?.prediction?.home_win_prob)}
            </div>
            <div className="text-xs text-white/60 mt-1">
              Margin: <span className="text-white">{fmtSigned(data?.prediction?.projected_margin)}</span>
            </div>
          </div>
        )}
      </div>

      {status === "loading" && (
        <div className="mt-3 text-sm text-white/60">Fetching prediction…</div>
      )}

      {status === "error" && (
        <div className="mt-3 text-sm text-red-200">
          {error}
          <div className="mt-1 text-xs text-white/50">
            URL: {url}
          </div>
        </div>
      )}

      {status === "success" && (
        <>
          {/* Teams */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Home</div>
              <div className="text-white font-semibold">
                {data?.home?.name ?? "Home Team"} ({data?.home?.abbr ?? "—"})
              </div>
              <div className="mt-1 text-xs text-white/60">
                Elo: <span className="text-white">{data?.home?.elo ?? "—"}</span>
              </div>
              <div className="mt-1 text-xs text-white/60">
                Last10: <span className="text-white">{data?.home?.last10?.record ?? "—"}</span>{" "}
                • Margin <span className="text-white">{fmtSigned(data?.home?.last10?.avg_margin)}</span>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/60">Away</div>
              <div className="text-white font-semibold">
                {data?.away?.name ?? "Away Team"} ({data?.away?.abbr ?? "—"})
              </div>
              <div className="mt-1 text-xs text-white/60">
                Elo: <span className="text-white">{data?.away?.elo ?? "—"}</span>
              </div>
              <div className="mt-1 text-xs text-white/60">
                Last10: <span className="text-white">{data?.away?.last10?.record ?? "—"}</span>{" "}
                • Margin <span className="text-white">{fmtSigned(data?.away?.last10?.avg_margin)}</span>
              </div>
            </div>
          </div>

          {/* Explain */}
          {data?.explain && (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="text-xs text-white/60">Why this prediction</div>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                <ExplainPill label="Base Elo" value={data.explain.base_elo_diff} />
                <ExplainPill label="Home Adv" value={data.explain.home_advantage} />
                <ExplainPill label="Rest" value={data.explain.rest_adjustment} />
                <ExplainPill label="Form" value={data.explain.form_adjustment} />
                <ExplainPill label="Total" value={data.explain.elo_diff_total} strong />
              </div>
              <div className="mt-2 text-xs text-white/50">
                Positive favors home team. Model uses game results only (free tier).
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExplainPill({ label, value, strong }) {
  return (
    <div className={`rounded-md border border-white/10 bg-white/5 px-2 py-2 ${strong ? "bg-white/10" : ""}`}>
      <div className="text-[11px] text-white/60">{label}</div>
      <div className={`mt-0.5 ${strong ? "text-white font-semibold" : "text-white"}`}>
        {typeof value === "number" ? (value > 0 ? `+${value}` : `${value}`) : "—"}
      </div>
    </div>
  );
}
