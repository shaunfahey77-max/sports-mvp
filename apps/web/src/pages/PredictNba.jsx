import { useEffect, useMemo, useState } from "react";

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function pct(conf) {
  const n = Number(conf);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function levelFromPct(p) {
  if (p == null) return "—";
  if (p >= 75) return "HIGH";
  if (p >= 60) return "MED";
  return "LOW";
}

function normalizeForBar(conf) {
  const n = Number(conf);
  if (!Number.isFinite(n)) return 0;
  const min = 0.52;
  const max = 0.97;
  const clamped = Math.min(max, Math.max(min, n));
  return Math.round(((clamped - min) / (max - min)) * 100);
}

async function fetchJsonWithNiceErrors(url) {
  const res = await fetch(url);
  const text = await res.text(); // read once
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    // Prefer server-provided message
    const msg =
      body?.error ||
      body?.message ||
      (text && text.slice(0, 200)) ||
      `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

export default function PredictNba() {
  const leagueLabel = "NBA";

  const [date, setDate] = useState(() => todayUTCYYYYMMDD());

  // Games state (always try to show these)
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState("");
  const [games, setGames] = useState([]);

  // Predictions state (nice-to-have, can fail)
  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState("");
  const [payload, setPayload] = useState(null);

  // 1) Load NBA games (never optional)
  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      setGamesLoading(true);
      setGamesError("");

      try {
        const url = `/api/nba/games?date=${encodeURIComponent(date)}&expand=teams`;
        const data = await fetchJsonWithNiceErrors(url);

        const arr = Array.isArray(data) ? data : (data?.games ?? []);
        if (!cancelled) setGames(arr);
      } catch (e) {
        if (!cancelled) {
          setGames([]);
          setGamesError(e?.message || "Failed to load NBA games");
        }
      } finally {
        if (!cancelled) setGamesLoading(false);
      }
    }

    loadGames();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // 2) Load NBA predictions (allowed to fail gracefully)
  useEffect(() => {
    let cancelled = false;

    async function loadPredictions() {
      setPredLoading(true);
      setPredError("");
      setPayload(null);

      try {
        const url = `/api/nba/predict?date=${encodeURIComponent(date)}`;
        const data = await fetchJsonWithNiceErrors(url);

        // expected shape: { meta, predictions }
        const normalized =
          data && typeof data === "object"
            ? data
            : { meta: { league: "nba", date }, predictions: [] };

        if (!cancelled) setPayload(normalized);

        // If backend returns “safe error info” inside meta, surface it as a non-fatal warning
        const metaError = normalized?.meta?.error || normalized?.error;
        if (metaError && !cancelled) {
          setPredError(String(metaError));
        }
      } catch (e) {
        // Non-fatal: show warning, keep games visible
        if (!cancelled) {
          setPredError(
            e?.status === 429
              ? "NBA predictions temporarily rate-limited by provider (429). Try again in a bit."
              : (e?.message || "Failed to load NBA predictions")
          );
          setPayload({ meta: { league: "nba", date, error: e?.message }, predictions: [] });
        }
      } finally {
        if (!cancelled) setPredLoading(false);
      }
    }

    loadPredictions();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const meta = payload?.meta ?? {};
  const predictions = payload?.predictions ?? [];

  const model = meta?.model ?? "MVP rolling win%";
  const windowDays = meta?.windowDays ?? null;
  const historyFetched = meta?.historyGamesFetched ?? null;
  const withScores = meta?.historyGamesWithScores ?? null;
  const note = meta?.note ?? "";

  const sortedPreds = useMemo(() => {
    const arr = Array.isArray(predictions) ? [...predictions] : [];
    arr.sort((a, b) => {
      const ac = Number(a?.prediction?.confidence ?? a?.confidence);
      const bc = Number(b?.prediction?.confidence ?? b?.confidence);
      return (Number.isFinite(bc) ? bc : -1) - (Number.isFinite(ac) ? ac : -1);
    });
    return arr;
  }, [predictions]);

  const top2Ids = useMemo(() => {
    const top2 = sortedPreds.slice(0, 2);
    return new Set(top2.map((p) => p?.gameId || `${p?.home?.id}-${p?.away?.id}-${p?.date}`));
  }, [sortedPreds]);

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{leagueLabel} Predict</h1>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 14, opacity: 0.8 }}>Date (UTC)</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "6px 8px" }}
          />
        </label>

        <span style={{ fontSize: 12, opacity: 0.6 }}>Showing: {date} (UTC)</span>
      </div>

      <p style={{ opacity: 0.8, marginTop: 8 }}>
        NBA games always load. NBA predictions may be rate-limited by the provider.
      </p>

      {/* Predictions warning (NON-FATAL) */}
      {predLoading && <p>Loading predictions…</p>}
      {predError && (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,180,80,0.35)",
            background: "rgba(255,180,80,0.10)",
            color: "rgba(255,230,200,0.95)",
            fontSize: 13,
          }}
        >
          <b>Predictions unavailable:</b> {predError}
          <div style={{ marginTop: 6, opacity: 0.85 }}>
            You can still browse games for this date below.
          </div>
        </div>
      )}

      {/* Model box */}
      <div
        style={{
          marginTop: 12,
          padding: 14,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Model / Algorithm</div>
        <div style={{ opacity: 0.9, fontSize: 13, lineHeight: 1.5 }}>
          <div><b>Model:</b> {model}</div>
          {windowDays != null && <div><b>Window:</b> {windowDays} days</div>}
          {historyFetched != null && <div><b>History games:</b> {historyFetched}</div>}
          {withScores != null && <div><b>With scores:</b> {withScores}</div>}
          {note && <div style={{ marginTop: 6, opacity: 0.85 }}>{note}</div>}
        </div>
      </div>

      {/* Predictions list (if available) */}
      {sortedPreds.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 800 }}>Best Picks</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Sorted by confidence (desc)</div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
            {sortedPreds.map((p, idx) => {
              const homeName = p.home?.name || p.home?.abbr || p.homeTeam?.abbr || p.homeTeamId;
              const awayName = p.away?.name || p.away?.abbr || p.awayTeam?.abbr || p.awayTeamId;

              const winnerName = p.prediction?.winnerName;
              const conf = p.prediction?.confidence;
              const confPct = pct(conf);
              const level = levelFromPct(confPct);
              const barPct = normalizeForBar(conf);

              const key = p.gameId || `${p?.home?.id}-${p?.away?.id}-${p?.date}`;
              const isTop2 = top2Ids.has(key);

              return (
                <div
                  key={key}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: isTop2 ? "rgba(40,120,160,0.12)" : "rgba(0,0,0,0.15)",
                    outline: isTop2 ? "1px solid rgba(80,180,220,0.35)" : "none",
                  }}
                >
                  <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center" }}>
                    <span>{awayName} @ {homeName}</span>
                    {isTop2 && <span style={{ fontSize: 12, opacity: 0.85 }}>⭐ Top {idx + 1}</span>}
                  </div>

                  <div style={{ marginTop: 10, fontSize: 13, opacity: 0.95, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div><b>Pick:</b> {winnerName || "—"}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.14)",
                        }}
                      >
                        {level}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.9 }}>
                        <b>Conf:</b> {confPct == null ? "—" : `${confPct}%`}
                      </span>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.12)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${barPct}%`,
                          height: "100%",
                          background: "rgba(255,255,255,0.55)",
                        }}
                      />
                    </div>
                  </div>

                  {p.prediction?.factors && (
                    <details style={{ marginTop: 10, opacity: 0.95 }}>
                      <summary style={{ cursor: "pointer" }}>Why (factors)</summary>
                      <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(p.prediction.factors, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Games list (ALWAYS show this section, even if preds fail) */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontWeight: 800 }}>Games</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Source: /api/nba/games
          </div>
        </div>

        {gamesLoading && <p>Loading games…</p>}
        {gamesError && <p style={{ color: "crimson" }}>{gamesError}</p>}

        {!gamesLoading && !gamesError && games.length === 0 && (
          <p style={{ opacity: 0.75 }}>No NBA games returned for {date}.</p>
        )}

        {!gamesLoading && !gamesError && games.length > 0 && (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {games.map((g) => {
              const home = g?.homeTeam?.abbr || g?.homeTeamId || "HOME";
              const away = g?.awayTeam?.abbr || g?.awayTeamId || "AWAY";
              const key = g?.id || `${away}-${home}-${g?.date}`;

              return (
                <div
                  key={key}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{away} @ {home}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{g?.status || ""}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
