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
 * ESPN logo fallback.
 * NBA:   https://a.espncdn.com/i/teamlogos/nba/500/bos.png
 * NHL:   https://a.espncdn.com/i/teamlogos/nhl/500/bos.png
 * NCAAM: https://a.espncdn.com/i/teamlogos/ncb/500/duke.png   (abbr-based; NOT reliable for all schools)
 */
function logoUrl(league, abbr) {
  const a = String(abbr || "").toLowerCase();
  if (!a) return "";
  const l = String(league || "").toLowerCase();
  const sport = l === "nhl" ? "nhl" : l === "ncaam" ? "ncb" : "nba";
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${a}.png`;
}

// ✅ NCAAM reliable logo by ESPN numeric team id (from your /api/ncaam/games payload)
function ncaamLogoFromEspnId(espnId) {
  const id = String(espnId || "").trim();
  if (!id) return "";
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
}

function TeamAvatar({ league, abbr, name, logo, espnId, size = 28 }) {
  const [imgOk, setImgOk] = useState(true);

  // Prefer:
  // 1) explicit logo passed in
  // 2) NCAAM numeric ESPN id logo
  // 3) ESPN-by-abbr fallback (NBA/NHL + last resort)
  const leagueLower = String(league || "").toLowerCase();
  const url = logo || (leagueLower === "ncaam" ? ncaamLogoFromEspnId(espnId) : "") || logoUrl(league, abbr);

  const fallback = (abbr || name || "?").slice(0, 3).toUpperCase();

  useEffect(() => {
    setImgOk(true);
  }, [league, abbr, logo, espnId]);

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
            type="button"
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

function teamHref(leagueLower, teamId) {
  if (!teamId) return null;
  return `/league/${leagueLower}/team/${teamId}`;
}

function stripPrefix(idOrAbbr) {
  return String(idOrAbbr || "")
    .replace("nba-", "")
    .replace("nhl-", "")
    .replace("ncaam-", "")
    .toUpperCase();
}

function normalizeGame(activeLeague, g) {
  const homeTeam = g?.homeTeam || g?.home_team || null;
  const awayTeam = g?.awayTeam || g?.away_team || null;

  const homeTeamId = homeTeam?.id || g?.homeTeamId || g?.home_team_id || "";
  const awayTeamId = awayTeam?.id || g?.awayTeamId || g?.away_team_id || "";

  const homeAbbr =
    homeTeam?.abbr ||
    homeTeam?.abbreviation ||
    homeTeam?.code ||
    homeTeam?.short_name ||
    stripPrefix(homeTeamId);
  const awayAbbr =
    awayTeam?.abbr ||
    awayTeam?.abbreviation ||
    awayTeam?.code ||
    awayTeam?.short_name ||
    stripPrefix(awayTeamId);

  const homeName = homeTeam?.name || homeTeam?.full_name || homeTeam?.display_name || homeAbbr || "HOME";
  const awayName = awayTeam?.name || awayTeam?.full_name || awayTeam?.display_name || awayAbbr || "AWAY";

  const homeScore =
    typeof homeTeam?.score === "number"
      ? homeTeam.score
      : typeof g?.homeScore === "number"
        ? g.homeScore
        : typeof g?.home_team_score === "number"
          ? g.home_team_score
          : typeof g?.home_score === "number"
            ? g.home_score
            : null;

  const awayScore =
    typeof awayTeam?.score === "number"
      ? awayTeam.score
      : typeof g?.awayScore === "number"
        ? g.awayScore
        : typeof g?.away_team_score === "number"
          ? g.away_team_score
          : typeof g?.away_score === "number"
            ? g.away_score
            : null;

  const date = g?.date || g?.start_time || g?.startTime || "";
  const status = g?.status || g?.state || "";

  // ✅ NCAAM: your /api/ncaam/games returns espnId on homeTeam/awayTeam and also top-level homeTeamEspnId/awayTeamEspnId
  const homeEspnId = homeTeam?.espnId || g?.homeTeamEspnId || null;
  const awayEspnId = awayTeam?.espnId || g?.awayTeamEspnId || null;

  // ✅ If backend ever adds logo on games, prefer it; otherwise build from ESPN id for NCAAM
  const homeLogo = homeTeam?.logo || (activeLeague === "ncaam" ? ncaamLogoFromEspnId(homeEspnId) : "");
  const awayLogo = awayTeam?.logo || (activeLeague === "ncaam" ? ncaamLogoFromEspnId(awayEspnId) : "");

  return {
    id: g?.id || g?.gameId || `${awayAbbr}-${homeAbbr}-${date || ""}`,
    date,
    status,
    home: {
      teamId: homeTeamId,
      abbr: String(homeAbbr || "").toUpperCase(),
      name: homeName,
      score: homeScore,
      espnId: homeEspnId,
      logo: homeLogo || null,
    },
    away: {
      teamId: awayTeamId,
      abbr: String(awayAbbr || "").toUpperCase(),
      name: awayName,
      score: awayScore,
      espnId: awayEspnId,
      logo: awayLogo || null,
    },
  };
}

function normalizePredictionRow(p) {
  const home = p?.home || {};
  const away = p?.away || {};
  const pred = p?.prediction || p || {};
  const conf = pred?.confidence ?? p?.confidence ?? null;

  return {
    gameId: p?.gameId || p?.id || `${away.abbr}-${home.abbr}-${p?.date || ""}`,
    status: p?.status || "",
    date: p?.date || "",
    home: {
      id: home?.id || p?.homeTeamId || "",
      abbr: home?.abbr || stripPrefix(home?.id || p?.homeTeamId || ""),
      name: home?.name || home?.abbr || "",
      logo: home?.logo || null,
      espnId: home?.espnId || stripPrefix(home?.id || p?.homeTeamId || ""), // harmless; not required for preds
    },
    away: {
      id: away?.id || p?.awayTeamId || "",
      abbr: away?.abbr || stripPrefix(away?.id || p?.awayTeamId || ""),
      name: away?.name || away?.abbr || "",
      logo: away?.logo || null,
      espnId: away?.espnId || stripPrefix(away?.id || p?.awayTeamId || ""),
    },
    winnerTeamId: pred?.winnerTeamId || "",
    winnerName: pred?.winnerName || "",
    confidence: conf,
  };
}

export default function Predict({ league = "nba" }) {
  const { league: routeLeague } = useParams();
  const activeLeague = String(routeLeague || league || "nba").toLowerCase();

  const [date, setDate] = useState(() => todayUTCYYYYMMDD());
  const [windowDays, setWindowDays] = useState(() => {
    const env = Number(import.meta?.env?.VITE_PREDICTIONS_WINDOW);
    return Number.isFinite(env) ? env : 14;
  });
  const [view, setView] = useState("predictions");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [predPayload, setPredPayload] = useState(null);
  const [gamesPayload, setGamesPayload] = useState(null);

  const leagueLabel = useMemo(() => String(activeLeague).toUpperCase(), [activeLeague]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        if (view === "games") {
          setPredPayload(null);

          const url =
            activeLeague === "ncaam"
              ? `/api/ncaam/games?date=${encodeURIComponent(date)}&expand=teams`
              : `/api/${activeLeague}/games?date=${encodeURIComponent(date)}&expand=teams`;

          const res = await fetch(url);
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            if (!cancelled) {
              setError(`API error: ${res.status}${text ? ` — ${text}` : ""}`);
              setGamesPayload(null);
            }
            return;
          }

          const data = await res.json();
          const normalized = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
          if (!cancelled) setGamesPayload(normalized);
          return;
        }

        setGamesPayload(null);

        const url = `/api/${activeLeague}/predict?date=${encodeURIComponent(date)}&window=${encodeURIComponent(windowDays)}`;
        const res = await fetch(url);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (!cancelled) {
            setError(`API error: ${res.status}${text ? ` — ${text}` : ""}`);
            setPredPayload(null);
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) setPredPayload(data);
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

  const meta = predPayload?.meta ?? {};
  const predictionsRaw = Array.isArray(predPayload?.predictions) ? predPayload.predictions : [];
  const predictions = useMemo(() => predictionsRaw.map(normalizePredictionRow), [predictionsRaw]);

  const sorted = useMemo(() => {
    const arr = [...predictions];
    arr.sort((a, b) => (Number(b.confidence) || -1) - (Number(a.confidence) || -1));
    return arr;
  }, [predictions]);

  const top3 = sorted.slice(0, 3);

  const games = useMemo(() => {
    const rows = Array.isArray(gamesPayload) ? gamesPayload : [];
    const normalized = rows.map((g) => normalizeGame(activeLeague, g));
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

  const shell = { maxWidth: 1120, margin: "0 auto" };

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

  const hubUrl = `/league/${activeLeague}/hub`;

  const segmentedOptions = [
    { value: "games", label: "Games" },
    { value: "predictions", label: "Predictions" },
  ];

  return (
    <div style={pageBg}>
      <div style={shell}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background:
                    activeLeague === "nhl"
                      ? "rgba(64,195,138,0.9)"
                      : activeLeague === "ncaam"
                        ? "rgba(255, 107, 107, 0.9)"
                        : "rgba(80,180,220,0.9)",
                  boxShadow: "0 0 0 6px rgba(255,255,255,0.04)",
                }}
              />
              <div style={{ fontSize: 12, letterSpacing: 0.2, opacity: 0.75, fontWeight: 800 }}>{leagueLabel}</div>

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
              {view === "games" ? "Date-based slate (clean games list)." : "Date-based slate + premium model picks (PASS discipline)."}
            </div>
          </div>

          <Segmented value={view} onChange={setView} options={segmentedOptions} />
        </div>

        {/* Controls */}
        <div style={{ marginTop: 16, ...card, padding: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label htmlFor="predict-date" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, opacity: 0.70, fontWeight: 800 }}>Date</span>
                <input
                  id="predict-date"
                  name="predictDate"
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

              {view === "predictions" && (
                <label htmlFor="predict-window" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, opacity: 0.70, fontWeight: 800 }}>Window</span>
                  <select
                    id="predict-window"
                    name="predictWindow"
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
                    {[7, 10, 14, 21, 30, 45].map((d) => (
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
                    ? `${sorted.length} picks`
                    : "—"}
            </div>
          </div>
        </div>

        {/* Meta note */}
        {view === "predictions" && meta?.note && (
          <div style={{ marginTop: 14, ...card, padding: 14 }}>
            <div style={{ fontWeight: 900 }}>Note</div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>{meta.note}</div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, ...card, padding: 14, borderColor: "rgba(255,107,107,0.30)" }}>
            <div style={{ color: "rgba(255,107,107,0.95)", fontWeight: 900 }}>Error</div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>{error}</div>
          </div>
        )}

        {/* CONTENT */}
        {view === "games" ? (
          <div style={{ marginTop: 16, ...card, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 900 }}>Games</div>
              <div style={{ fontSize: 12, opacity: 0.60 }}>{games.length ? `${games.length} scheduled` : ""}</div>
            </div>

            {!loading && !error && games.length === 0 && (
              <div style={{ marginTop: 10, opacity: 0.75 }}>
                No games returned for <b>{date}</b>.
              </div>
            )}

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {games.map((g) => {
                const tip = formatTipTime(g.status) || formatTipTime(g.date);
                const hasScores = typeof g.home.score === "number" || typeof g.away.score === "number";

                const awayUrl = teamHref(activeLeague, g.away.teamId);
                const homeUrl = teamHref(activeLeague, g.home.teamId);

                return (
                  <div
                    key={g.id}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.03)",
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          {awayUrl ? (
                            <Link to={awayUrl} style={{ textDecoration: "none", color: "inherit" }} title="Open team page">
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <TeamAvatar
                                  league={activeLeague}
                                  abbr={g.away.abbr}
                                  name={g.away.name}
                                  logo={g.away.logo}
                                  espnId={g.away.espnId}
                                />
                                <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.away.abbr}</div>
                              </div>
                            </Link>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <TeamAvatar
                                league={activeLeague}
                                abbr={g.away.abbr}
                                name={g.away.name}
                                logo={g.away.logo}
                                espnId={g.away.espnId}
                              />
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.away.abbr}</div>
                            </div>
                          )}

                          <div style={{ opacity: 0.65, fontWeight: 800 }}>@</div>

                          {homeUrl ? (
                            <Link to={homeUrl} style={{ textDecoration: "none", color: "inherit" }} title="Open team page">
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.home.abbr}</div>
                                <TeamAvatar
                                  league={activeLeague}
                                  abbr={g.home.abbr}
                                  name={g.home.name}
                                  logo={g.home.logo}
                                  espnId={g.home.espnId}
                                />
                              </div>
                            </Link>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>{g.home.abbr}</div>
                              <TeamAvatar
                                league={activeLeague}
                                abbr={g.home.abbr}
                                name={g.home.name}
                                logo={g.home.logo}
                                espnId={g.home.espnId}
                              />
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
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 340px", gap: 14 }}>
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
                  {top3.map((p) => (
                    <div
                      key={p.gameId}
                      style={{
                        ...subcard,
                        padding: 12,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 14,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <TeamAvatar
                              league={activeLeague}
                              abbr={p.away.abbr}
                              name={p.away.name}
                              logo={p.away.logo}
                              espnId={p.away.espnId}
                            />
                            <div style={{ fontWeight: 950 }}>{p.away.abbr}</div>
                          </div>
                          <div style={{ opacity: 0.65, fontWeight: 800 }}>@</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 950 }}>{p.home.abbr}</div>
                            <TeamAvatar
                              league={activeLeague}
                              abbr={p.home.abbr}
                              name={p.home.name}
                              logo={p.home.logo}
                              espnId={p.home.espnId}
                            />
                          </div>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.70 }}>
                          Pick:{" "}
                          <b style={{ opacity: 0.95 }}>
                            {p.winnerName || (p.winnerTeamId === p.home.id ? p.home.abbr : p.away.abbr)}
                          </b>
                          {p.status ? <span style={{ opacity: 0.7 }}> • {String(p.status)}</span> : null}
                        </div>
                      </div>

                      <Meter conf={p.confidence} />
                    </div>
                  ))}
                </div>
              </div>

              {/* All Picks */}
              <div style={{ ...card, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 900 }}>All Picks</div>
                  <div style={{ fontSize: 12, opacity: 0.60 }}>{sorted.length ? `${sorted.length} games` : ""}</div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {sorted.map((p) => (
                    <div
                      key={p.gameId}
                      style={{
                        ...subcard,
                        padding: 12,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 14,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <TeamAvatar
                              league={activeLeague}
                              abbr={p.away.abbr}
                              name={p.away.name}
                              logo={p.away.logo}
                              espnId={p.away.espnId}
                            />
                            <div style={{ fontWeight: 950 }}>{p.away.abbr}</div>
                          </div>
                          <div style={{ opacity: 0.65, fontWeight: 800 }}>@</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ fontWeight: 950 }}>{p.home.abbr}</div>
                            <TeamAvatar
                              league={activeLeague}
                              abbr={p.home.abbr}
                              name={p.home.name}
                              logo={p.home.logo}
                              espnId={p.home.espnId}
                            />
                          </div>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.70 }}>
                          Pick:{" "}
                          <b style={{ opacity: 0.95 }}>
                            {p.winnerName || (p.winnerTeamId === p.home.id ? p.home.abbr : p.away.abbr)}
                          </b>
                        </div>
                      </div>

                      <Meter conf={p.confidence} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT */}
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              <div style={{ ...card, padding: 14, position: "sticky", top: 16 }}>
                <div style={{ fontWeight: 950 }}>Model</div>
                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
                  <div>
                    <b>Model:</b> {meta?.model ?? "Premium"}
                  </div>
                  <div>
                    <b>League:</b> {leagueLabel}
                  </div>
                  <div>
                    <b>Window:</b> {windowDays}d
                  </div>
                  {meta?.historyGamesFetched != null && (
                    <div>
                      <b>Samples:</b> {meta.historyGamesFetched}
                    </div>
                  )}
                  {meta?.noPickCount != null && (
                    <div>
                      <b>PASS:</b> {meta.noPickCount}
                    </div>
                  )}
                  {meta?.note && <div style={{ marginTop: 10, opacity: 0.75 }}>{meta.note}</div>}
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
