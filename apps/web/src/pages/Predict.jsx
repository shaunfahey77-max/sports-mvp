// apps/web/src/pages/Predict.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

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

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function confidenceTone(p) {
  if (p == null) return "muted";
  if (p >= 75) return "good";
  if (p >= 60) return "mid";
  return "bad";
}

function formatTipTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * ESPN logo fallback (works well for MVP).
 * NBA: https://a.espncdn.com/i/teamlogos/nba/500/bos.png
 * NHL: https://a.espncdn.com/i/teamlogos/nhl/500/bos.png
 */
function logoUrl(league, abbr) {
  const a = String(abbr || "").toLowerCase();
  if (!a) return "";
  const l = String(league || "").toLowerCase();
  const sport = l === "nhl" ? "nhl" : "nba";
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${a}.png`;
}

function TeamAvatar({ league, abbr, name, size = 28 }) {
  const [imgOk, setImgOk] = useState(true);
  const url = logoUrl(league, abbr);
  const fallback = (abbr || name || "?").slice(0, 3).toUpperCase();

  useEffect(() => {
    setImgOk(true);
  }, [league, abbr]);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        overflow: "hidden",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
      }}
      title={name || abbr || ""}
    >
      {url && imgOk ? (
        <img
          src={url}
          alt={abbr || name || "team"}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setImgOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span style={{ fontSize: 11, opacity: 0.85, fontWeight: 800 }}>{fallback}</span>
      )}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        padding: 6,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(0,0,0,0.18)",
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 999,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 800,
              color: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.70)",
              background: active ? "rgba(80,180,220,0.18)" : "rgba(255,255,255,0.03)",
              boxShadow: active ? "0 0 0 1px rgba(80,180,220,0.20) inset" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Meter({ conf }) {
  const p = pct(conf);
  const tone = confidenceTone(p);

  // map conf 0.50–0.90 into 0–1 for bar fill
  const raw = Number(conf);
  const fill = clamp01((raw - 0.5) / (0.9 - 0.5));
  const fillPct = Math.round(fill * 100);

  const toneStyles = {
    good: {
      pillBg: "rgba(64, 195, 138, 0.16)",
      pillBorder: "rgba(64, 195, 138, 0.35)",
      bar: "linear-gradient(90deg, rgba(64,195,138,0.85), rgba(64,195,138,0.30))",
    },
    mid: {
      pillBg: "rgba(80, 180, 220, 0.14)",
      pillBorder: "rgba(80, 180, 220, 0.35)",
      bar: "linear-gradient(90deg, rgba(80,180,220,0.85), rgba(80,180,220,0.30))",
    },
    bad: {
      pillBg: "rgba(255, 107, 107, 0.12)",
      pillBorder: "rgba(255, 107, 107, 0.35)",
      bar: "linear-gradient(90deg, rgba(255,107,107,0.80), rgba(255,107,107,0.25))",
    },
    muted: {
      pillBg: "rgba(255,255,255,0.06)",
      pillBorder: "rgba(255,255,255,0.12)",
      bar: "linear-gradient(90deg, rgba(255,255,255,0.45), rgba(255,255,255,0.12))",
    },
  }[tone];

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 160 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 900,
            padding: "4px 10px",
            borderRadius: 999,
            background: toneStyles.pillBg,
            border: `1px solid ${toneStyles.pillBorder}`,
            color: "rgba(255,255,255,0.90)",
          }}
        >
          {p == null ? "—" : `${p}%`}
        </span>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{p == null ? "" : "confidence"}</span>
      </div>

      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.10)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${fillPct}%`, height: "100%", background: toneStyles.bar }} />
      </div>
    </div>
  );
}

/** ✅ Canonical team route helper */
function teamHref(leagueLower, teamId) {
  if (!teamId) return null;
  return `/league/${leagueLower}/team/${teamId}`;
}

/** ✅ Safe ID -> ABBR */
function stripPrefix(idOrAbbr) {
  return String(idOrAbbr || "").replace("nba-", "").replace("nhl-", "").toUpperCase();
}

/** Normalize "games" payload (NBA + NHL) into one shape for rendering */
function normalizeGame(_activeLeague, g) {
  const homeTeam = g?.homeTeam || null;
  const awayTeam = g?.awayTeam || null;

  const homeTeamId = homeTeam?.id || g?.homeTeamId || "";
  const awayTeamId = awayTeam?.id || g?.awayTeamId || "";

  const homeAbbr = homeTeam?.abbr || stripPrefix(homeTeamId);
  const awayAbbr = awayTeam?.abbr || stripPrefix(awayTeamId);

  const homeName = homeTeam?.name || homeAbbr || homeTeamId || "HOME";
  const awayName = awayTeam?.name || awayAbbr || awayTeamId || "AWAY";

  const homeScore =
    typeof homeTeam?.score === "number"
      ? homeTeam.score
      : typeof g?.homeScore === "number"
        ? g.homeScore
        : null;

  const awayScore =
    typeof awayTeam?.score === "number"
      ? awayTeam.score
      : typeof g?.awayScore === "number"
        ? g.awayScore
        : null;

  return {
    id: g?.id || g?.gameId || `${awayAbbr}-${homeAbbr}-${g?.date || ""}`,
    date: g?.date || "",
    status: g?.status || "",
    home: { teamId: homeTeamId, abbr: homeAbbr, name: homeName, score: homeScore },
    away: { teamId: awayTeamId, abbr: awayAbbr, name: awayName, score: awayScore },
  };
}

export default function Predict({ league = "nba" }) {
  const { league: routeLeague } = useParams();
  const activeLeague = String(routeLeague || league || "nba").toLowerCase();

  const [date, setDate] = useState(() => todayUTCYYYYMMDD());
  const [windowDays, setWindowDays] = useState(() => {
    const env = Number(import.meta?.env?.VITE_PREDICTIONS_WINDOW);
    return Number.isFinite(env) ? env : 5;
  });
  const [view, setView] = useState("predictions"); // "games" | "predictions"

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [predPayload, setPredPayload] = useState(null);
  const [gamesPayload, setGamesPayload] = useState(null);

  const leagueLabel = useMemo(() => String(activeLeague).toUpperCase(), [activeLeague]);

  // Load predictions OR games depending on tab
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        if (view === "games") {
          // ✅ clear stale predictions state
          setPredPayload(null);

          const url = `/api/${activeLeague}/games?date=${encodeURIComponent(date)}&expand=teams`;
          const res = await fetch(url);

          if (!res.ok) {
            let extra = "";
            try {
              const j = await res.json();
              if (j?.error) extra = ` — ${j.error}`;
            } catch {}
            if (!cancelled) {
              setError(`API error: ${res.status}${extra}`);
              setGamesPayload(null);
            }
            return;
          }

          const data = await res.json();
          const normalized = Array.isArray(data) ? data : [];
          if (!cancelled) setGamesPayload(normalized);
          return;
        }

        // view === "predictions"
        // ✅ clear stale games state
        setGamesPayload(null);

        const url = `/api/${activeLeague}/predict?date=${encodeURIComponent(date)}&window=${encodeURIComponent(
          windowDays
        )}`;
        const res = await fetch(url);

        if (!res.ok) {
          let extra = "";
          try {
            const j = await res.json();
            if (j?.error) extra = ` — ${j.error}`;
          } catch {}
          if (!cancelled) {
            setError(`API error: ${res.status}${extra}`);
            setPredPayload(null);
          }
          return;
        }

        const data = await res.json();

        let normalized;
        if (Array.isArray(data)) {
          normalized = { meta: { league: activeLeague, date, windowDays }, predictions: data };
        } else if (data && typeof data === "object") {
          normalized = data;
        } else {
          normalized = { meta: { league: activeLeague, date, windowDays }, predictions: [] };
        }

        if (!cancelled) setPredPayload(normalized);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Failed to load");
          if (view === "games") setGamesPayload(null);
          else setPredPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeLeague, date, windowDays, view]);

  // Predictions derived
  const meta = predPayload?.meta ?? predPayload ?? {};
  const predictions = Array.isArray(predPayload?.predictions)
    ? predPayload.predictions
    : Array.isArray(predPayload?.data)
      ? predPayload.data
      : [];

  const model = meta?.model ?? "Elo";
  const note = meta?.note ?? "";

  const historyFetched =
    meta?.historyGamesFetched ??
    meta?.historyMatchupsFetched ??
    meta?.historyFetched ??
    null;

  const withScores =
    meta?.historyGamesWithScores ??
    meta?.matchupsWithScores ??
    meta?.historyWithScores ??
    null;

  const sorted = useMemo(() => {
    const arr = [...predictions];
    arr.sort((a, b) => {
      const ac = Number(a?.prediction?.confidence ?? a?.confidence);
      const bc = Number(b?.prediction?.confidence ?? b?.confidence);
      return (Number.isFinite(bc) ? bc : -1) - (Number.isFinite(ac) ? ac : -1);
    });
    return arr;
  }, [predictions]);

  const top3 = sorted.slice(0, 3);

  // Games derived
  const games = useMemo(() => {
    const rows = Array.isArray(gamesPayload) ? gamesPayload : [];
    const normalized = rows.map((g) => normalizeGame(activeLeague, g));

    // sort by tip time if present; otherwise by date
    normalized.sort((a, b) => {
      const ad = new Date(a.status || a.date || 0).getTime();
      const bd = new Date(b.status || b.date || 0).getTime();
      return ad - bd;
    });

    return normalized;
  }, [gamesPayload, activeLeague]);

  const pageBg = {
    minHeight: "100vh",
    padding: "28px 18px 48px",
    background:
      "radial-gradient(1200px 600px at 85% 20%, rgba(80,180,220,0.16), transparent 55%), radial-gradient(900px 500px at 15% 10%, rgba(120,90,220,0.14), transparent 60%), linear-gradient(180deg, rgba(7,12,18,1), rgba(8,14,24,1))",
    color: "rgba(255,255,255,0.92)",
  };

  const shell = {
    maxWidth: 1120,
    margin: "0 auto",
  };

  const card = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.22)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  };

  const subcard = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
  };

  const linkStyle = {
    textDecoration: "none",
    color: "inherit",
  };

  // ✅ RECOMMENDED: canonical hub link (optional but useful)
  const hubUrl = `/league/${activeLeague}/hub`;

  return (
    <div style={pageBg}>
      <div style={shell}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: activeLeague === "nhl" ? "rgba(64,195,138,0.9)" : "rgba(80,180,220,0.9)",
                  boxShadow: "0 0 0 6px rgba(255,255,255,0.04)",
                }}
              />
              <div style={{ fontSize: 12, letterSpacing: 0.2, opacity: 0.75, fontWeight: 800 }}>
                {leagueLabel}
              </div>

              {/* ✅ tiny hub shortcut so the hub is discoverable */}
              <Link
                to={hubUrl}
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  fontWeight: 900,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  textDecoration: "none",
                  color: "rgba(255,255,255,0.82)",
                }}
                title="Open hub (legacy layout)"
              >
                Hub
              </Link>
            </div>

            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: 0.2 }}>Games & Predictions</h1>

            <div style={{ fontSize: 13, opacity: 0.70 }}>
              {view === "games"
                ? "Date-based slate (clean games list)."
                : "Date-based slate + model picks (future dates supported)."}
            </div>
          </div>

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "games", label: "Games" },
              { value: "predictions", label: "Predictions" },
            ]}
          />
        </div>

        {/* Controls */}
        <div style={{ marginTop: 16, ...card, padding: 14 }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.70, fontWeight: 800 }}>Date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.25)",
                    color: "rgba(255,255,255,0.9)",
                  }}
                />
              </label>

              {/* Window only matters for Predictions */}
              {view === "predictions" && (
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, opacity: 0.70, fontWeight: 800 }}>Window</span>
                  <select
                    value={windowDays}
                    onChange={(e) => setWindowDays(Number(e.target.value))}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.25)",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 800,
                    }}
                  >
                    {[3, 5, 7, 10, 14].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ fontSize: 12, opacity: 0.60 }}>
                Showing: <b>{date}</b>
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.60 }}>
              {loading
                ? "Loading…"
                : view === "games"
                  ? games.length
                    ? `${games.length} games`
                    : "—"
                  : sorted.length
                    ? `${sorted.length} games`
                    : "—"}
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 14, ...card, padding: 14, borderColor: "rgba(255,107,107,0.30)" }}>
            <div style={{ color: "rgba(255,107,107,0.95)", fontWeight: 900 }}>Error</div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>{error}</div>
          </div>
        )}

        {/* CONTENT */}
        {view === "games" ? (
          // =========================
          // GAMES VIEW (premium list)
          // =========================
          <div style={{ marginTop: 16, ...card, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 900 }}>Games</div>
              <div style={{ fontSize: 12, opacity: 0.60 }}>
                {games.length ? `${games.length} scheduled` : ""}
              </div>
            </div>

            {!loading && !error && games.length === 0 && (
              <div style={{ marginTop: 10, opacity: 0.75 }}>
                No games returned for <b>{date}</b>.
              </div>
            )}

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {games.map((g) => {
                // ✅ NHL "FUT" won't parse; status time only if it parses, else fall back to date
                const tip = formatTipTime(g.status) || formatTipTime(g.date);
                const hasScores = typeof g.home.score === "number" || typeof g.away.score === "number";

                const awayUrl = teamHref(activeLeague, g.away.teamId);
                const homeUrl = teamHref(activeLeague, g.home.teamId);

                return (
                  <div key={g.id} style={{ ...subcard, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          {awayUrl ? (
                            <Link to={awayUrl} style={linkStyle} title="Open team page">
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <TeamAvatar league={activeLeague} abbr={g.away.abbr} name={g.away.name} />
                                <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.away.abbr}</div>
                              </div>
                            </Link>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <TeamAvatar league={activeLeague} abbr={g.away.abbr} name={g.away.name} />
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.away.abbr}</div>
                            </div>
                          )}

                          <div style={{ opacity: 0.65, fontWeight: 800 }}>@</div>

                          {homeUrl ? (
                            <Link to={homeUrl} style={linkStyle} title="Open team page">
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.home.abbr}</div>
                                <TeamAvatar league={activeLeague} abbr={g.home.abbr} name={g.home.name} />
                              </div>
                            </Link>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.home.abbr}</div>
                              <TeamAvatar league={activeLeague} abbr={g.home.abbr} name={g.home.name} />
                            </div>
                          )}
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.65 }}>
                          {tip ? `${tip}` : ""}
                          {g.status ? ` • ${String(g.status)}` : ""}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div
                          style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.10)",
                            background: "rgba(0,0,0,0.20)",
                            minWidth: 120,
                            textAlign: "right",
                            fontWeight: 900,
                          }}
                        >
                          {hasScores ? (
                            <span>
                              {g.away.score ?? "—"} <span style={{ opacity: 0.6 }}>–</span> {g.home.score ?? "—"}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.70, fontWeight: 800 }}>No score</span>
                          )}
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.60, whiteSpace: "nowrap" }}>
                          <span style={{ opacity: 0.85, fontWeight: 800 }}>Tap</span>{" "}
                          <span style={{ opacity: 0.65 }}>teams</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // =========================
          // PREDICTIONS VIEW (premium layout)
          // =========================
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "1fr 340px",
              gap: 14,
            }}
          >
            {/* LEFT */}
            <div style={{ display: "grid", gap: 14 }}>
              {/* Top Picks */}
              <div style={{ ...card, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 900 }}>Top Picks</div>
                  <div style={{ fontSize: 12, opacity: 0.60 }}>Sorted by confidence</div>
                </div>

                {!loading && !error && top3.length === 0 && (
                  <div style={{ marginTop: 10, opacity: 0.75 }}>
                    No predictions returned for <b>{date}</b>.
                  </div>
                )}

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {top3.map((p, idx) => {
                    const homeAbbr = p.home?.abbr || p.homeTeam?.abbr || stripPrefix(p.homeTeamId);
                    const awayAbbr = p.away?.abbr || p.awayTeam?.abbr || stripPrefix(p.awayTeamId);

                    const homeTeamId = p.home?.id || p.homeTeamId || "";
                    const awayTeamId = p.away?.id || p.awayTeamId || "";

                    const homeName = p.home?.name || homeAbbr;
                    const awayName = p.away?.name || awayAbbr;

                    const winnerName = p.prediction?.winnerName || "—";
                    const conf = p.prediction?.confidence ?? p.confidence;

                    const awayUrl = teamHref(activeLeague, awayTeamId);
                    const homeUrl = teamHref(activeLeague, homeTeamId);

                    return (
                      <div key={p.gameId || `${awayAbbr}-${homeAbbr}-${p.date}-${idx}`} style={{ ...subcard, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 900,
                                  padding: "3px 10px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  background: "rgba(80,180,220,0.12)",
                                  opacity: 0.95,
                                }}
                              >
                                #{idx + 1}
                              </span>

                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                {awayUrl ? (
                                  <Link to={awayUrl} style={linkStyle} title="Open team page">
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <TeamAvatar league={activeLeague} abbr={awayAbbr} name={awayName} />
                                      <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{awayAbbr}</div>
                                    </div>
                                  </Link>
                                ) : (
                                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <TeamAvatar league={activeLeague} abbr={awayAbbr} name={awayName} />
                                    <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{awayAbbr}</div>
                                  </div>
                                )}

                                <div style={{ opacity: 0.65, fontWeight: 800 }}>@</div>

                                {homeUrl ? (
                                  <Link to={homeUrl} style={linkStyle} title="Open team page">
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{homeAbbr}</div>
                                      <TeamAvatar league={activeLeague} abbr={homeAbbr} name={homeName} />
                                    </div>
                                  </Link>
                                ) : (
                                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{homeAbbr}</div>
                                    <TeamAvatar league={activeLeague} abbr={homeAbbr} name={homeName} />
                                  </div>
                                )}
                              </div>
                            </div>

                            <div style={{ fontSize: 12, opacity: 0.65 }}>
                              {formatTipTime(p.status) || formatTipTime(p.date)} {p.status ? `• ${p.status}` : ""}
                            </div>

                            <div style={{ fontSize: 13, opacity: 0.90 }}>
                              <b>Pick:</b>{" "}
                              <span
                                style={{
                                  padding: "3px 10px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(0,0,0,0.20)",
                                }}
                              >
                                {winnerName}
                              </span>
                            </div>
                          </div>

                          <Meter conf={conf} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* All Predictions */}
              <div style={{ ...card, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 900 }}>All Predictions</div>
                  <div style={{ fontSize: 12, opacity: 0.60 }}>{sorted.length ? `${sorted.length} games` : ""}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {sorted.map((p, idx) => {
                    const homeAbbr = p.home?.abbr || p.homeTeam?.abbr || stripPrefix(p.homeTeamId);
                    const awayAbbr = p.away?.abbr || p.awayTeam?.abbr || stripPrefix(p.awayTeamId);

                    const homeTeamId = p.home?.id || p.homeTeamId || "";
                    const awayTeamId = p.away?.id || p.awayTeamId || "";

                    const homeName = p.home?.name || homeAbbr;
                    const awayName = p.away?.name || awayAbbr;

                    const winnerName = p.prediction?.winnerName || "—";
                    const conf = p.prediction?.confidence ?? p.confidence;

                    const awayUrl = teamHref(activeLeague, awayTeamId);
                    const homeUrl = teamHref(activeLeague, homeTeamId);

                    return (
                      <div key={p.gameId || `${awayAbbr}-${homeAbbr}-${p.date}-${idx}`} style={{ ...subcard, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            {awayUrl ? (
                              <Link to={awayUrl} style={linkStyle} title="Open team page">
                                <TeamAvatar league={activeLeague} abbr={awayAbbr} name={awayName} />
                              </Link>
                            ) : (
                              <TeamAvatar league={activeLeague} abbr={awayAbbr} name={awayName} />
                            )}

                            <div style={{ display: "grid", gap: 4 }}>
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>
                                {awayAbbr} <span style={{ opacity: 0.65 }}>@</span> {homeAbbr}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.65 }}>
                                {formatTipTime(p.status) || formatTipTime(p.date)} {p.status ? `• ${p.status}` : ""}
                              </div>
                            </div>

                            {homeUrl ? (
                              <Link to={homeUrl} style={linkStyle} title="Open team page">
                                <TeamAvatar league={activeLeague} abbr={homeAbbr} name={homeName} />
                              </Link>
                            ) : (
                              <TeamAvatar league={activeLeague} abbr={homeAbbr} name={homeName} />
                            )}
                          </div>

                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 900,
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(0,0,0,0.20)",
                              }}
                            >
                              Pick {winnerName?.split(" ")?.[0] || winnerName}
                            </span>
                            <Meter conf={conf} />
                          </div>
                        </div>

                        {p.prediction?.factors && (
                          <details style={{ marginTop: 10, opacity: 0.95 }}>
                            <summary style={{ cursor: "pointer", opacity: 0.85 }}>Why (factors)</summary>
                            <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap", opacity: 0.9 }}>
                              {JSON.stringify(p.prediction.factors, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT: Model panel */}
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              <div style={{ ...card, padding: 14, position: "sticky", top: 16 }}>
                <div style={{ fontWeight: 950 }}>Model</div>
                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                  <div>
                    <b>Model:</b> {model}
                  </div>
                  <div>
                    <b>League:</b> {leagueLabel}
                  </div>
                  <div>
                    <b>Window:</b> {windowDays}d
                  </div>
                  {historyFetched != null && (
                    <div>
                      <b>Samples:</b> {historyFetched}
                    </div>
                  )}
                  {withScores != null && (
                    <div>
                      <b>With scores:</b> {withScores}
                    </div>
                  )}
                  {note && <div style={{ marginTop: 10, opacity: 0.75 }}>{note}</div>}
                </div>

                <div style={{ marginTop: 12, ...subcard, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>Future date behavior</div>
                  <div style={{ fontSize: 12, opacity: 0.70, marginTop: 6 }}>
                    Predictions for <b>{leagueLabel}</b> on <b>{date}</b> use history from the prior <b>{windowDays}d</b>.
                  </div>
                </div>

                <div style={{ marginTop: 12, fontSize: 12, opacity: 0.60 }}>
                  Tip: if a logo doesn’t load, ESPN may not match the abbreviation. We can add a local override map next.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Responsive fallback */}
        <style>{`
          @media (max-width: 980px) {
            div[style*="grid-template-columns: 1fr 340px"] {
              grid-template-columns: 1fr !important;
            }
            div[style*="position: sticky"] {
              position: static !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
