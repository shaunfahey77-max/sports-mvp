import { useEffect, useMemo, useState } from "react";

const DEFAULT_API_BASE = "http://127.0.0.1:3001";

function pct(x) {
  if (typeof x !== "number") return "—";
  return `${Math.round(x * 100)}%`;
}

function pct1(x) {
  if (typeof x !== "number") return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function fmtSigned(x) {
  if (typeof x !== "number") return "—";
  const v = Number(x.toFixed(1));
  return v > 0 ? `+${v}` : `${v}`;
}

function fmtEdgePct(x) {
  if (typeof x !== "number") return "—";
  const v = (x * 100);
  const s = v > 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
  return s;
}

// Moneyline -> implied probability
function impliedProbFromMoneyline(ml) {
  const x = Number(ml);
  if (!Number.isFinite(x) || x === 0) return null;
  if (x < 0) return Math.abs(x) / (Math.abs(x) + 100);
  return 100 / (x + 100);
}

export default function PredictLiteCard({
  homeTeamId,
  awayTeamId,
  season = 2024,
  date,
  apiBase,
  className = "",
  // NEW
  homeML = null,
  awayML = null,
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

    // optional: backend can ignore; future-proofing
    if (typeof homeML === "number") u.searchParams.set("home_ml", String(homeML));
    if (typeof awayML === "number") u.searchParams.set("away_ml", String(awayML));

    return u.toString();
  }, [base, homeTeamId, awayTeamId, season, date, homeML, awayML]);

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
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!homeTeamId || !awayTeamId) {
    return (
      <div className={`rounded-xl border border-white/10 bg-white/5 p-4 ${className}`}>
        <div className="text-sm text-white/70">Model</div>
        <div className="mt-1 text-white/60 text-sm">
          Waiting for matchup (home/away team IDs missing).
        </div>
      </div>
    );
  }

  const modelProb = data?.prediction?.home_win_prob;
  const impliedHome = typeof homeML === "number" ? impliedProbFromMoneyline(homeML) : null;
  const impliedAway = typeof awayML === "number" ? impliedProbFromMoneyline(awayML) : null;

  // Edge uses HOME implied (most common bettor workflow: evaluate one side)
  const edgeHome =
    typeof modelProb === "number" && typeof impliedHome === "number"
      ? modelProb - impliedHome
      : null;

  const edgeTone =
    typeof edgeHome === "number"
      ? edgeHome > 0
        ? "positive"
        : edgeHome < 0
        ? "negative"
        : "neutral"
      : "neutral";

  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-white/70">Model (ELO-Lite)</div>
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
            <div className="text-xs text-white/60">Model: Home win</div>
            <div className="text-2xl font-bold text-white">
              {pct(modelProb)}
            </div>
            <div className="text-xs text-white/60 mt-1">
              Margin: <span className="text-white">{fmtSigned(data?.prediction?.projected_margin)}</span>
            </div>
          </div>
        )}
      </div>

      {status === "loading" && (
        <div className="mt-3 text-sm text-white/60">Fetching model…</div>
      )}

      {status === "error" && (
        <div className="mt-3 text-sm text-red-200">
          {error}
          <div className="mt-1 text-xs text-white/50">URL: {url}</div>
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

          {/* Betting Insight */}
          <div className="mt-4 rounded-lg border border-white/10 bg-black/10 p-3">
            <div className="text-xs text-white/60">Betting Insight (Moneyline)</div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-[11px] text-white/60">Home ML</div>
                <div className="mt-0.5 text-white">
                  {typeof homeML === "number" ? (homeML > 0 ? `+${homeML}` : `${homeML}`) : "—"}
                </div>
                <div className="text-[11px] text-white/50 mt-1">
                  Implied: <span className="text-white">{pct1(impliedHome)}</span>
                </div>
              </div>

              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-[11px] text-white/60">Away ML</div>
                <div className="mt-0.5 text-white">
                  {typeof awayML === "number" ? (awayML > 0 ? `+${awayML}` : `${awayML}`) : "—"}
                </div>
                <div className="text-[11px] text-white/50 mt-1">
                  Implied: <span className="text-white">{pct1(impliedAway)}</span>
                </div>
              </div>

              <div
                className={`rounded-md border border-white/10 px-3 py-2 ${
                  edgeTone === "positive"
                    ? "bg-green-500/10"
                    : edgeTone === "negative"
                    ? "bg-red-500/10"
                    : "bg-white/5"
                }`}
              >
                <div className="text-[11px] text-white/60">Model Edge (Home)</div>
                <div
                  className={`mt-0.5 font-semibold ${
                    edgeTone === "positive"
                      ? "text-green-300"
                      : edgeTone === "negative"
                      ? "text-red-200"
                      : "text-white"
                  }`}
                >
                  {fmtEdgePct(edgeHome)}
                </div>
                <div className="text-[11px] text-white/50 mt-1">
                  {typeof edgeHome === "number"
                    ? edgeHome > 0
                      ? "Positive edge suggests potential value."
                      : edgeHome < 0
                      ? "No edge detected. Model suggests pass."
                      : "Neutral."
                    : "Enter ML odds to compute edge."}
                </div>
              </div>
            </div>

            <div className="mt-2 text-xs text-white/50">
              This is informational only — not betting advice. Positive edge means model probability exceeds implied odds.
            </div>
          </div>

          {/* Explain */}
          {data?.explain && (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="text-xs text-white/60">Why this model leans this way</div>
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
