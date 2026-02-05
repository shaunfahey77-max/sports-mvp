// apps/web/src/lib/api.js

// Prefer explicit base (set in Vite env). Otherwise:
// - in dev (localhost) hit API directly at 127.0.0.1:3001
// - in prod, assume same-origin reverse proxy (""), so /api/... works
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (location.hostname === "localhost" ? "http://127.0.0.1:3001" : "");

async function request(path, { method = "GET", headers, body } = {}) {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore non-json responses
  }

  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) ||
      text ||
      `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return json;
}

/**
 * ✅ Combined games (legacy-safe)
 * Used by any screen still calling the "all games" endpoint.
 */
export async function getCombinedGames(date) {
  return request(`/api/games?date=${encodeURIComponent(date)}&expand=teams`);
}

/**
 * ✅ NEW: League-only games (premium + fast)
 * Predict "Games" tab + TeamDetail should use this.
 */
export async function getLeagueGames(league, date, { expandTeams = true } = {}) {
  const l = String(league || "nba").toLowerCase();
  const expand = expandTeams ? "&expand=teams" : "";
  return request(`/api/${encodeURIComponent(l)}/games?date=${encodeURIComponent(date)}${expand}`);
}

/**
 * ✅ Generic predictions endpoint (kept for compatibility)
 * /api/predictions?league=nba&date=...&window=...
 */
export async function getPredictions({ league, date, windowDays }) {
  const l = String(league || "nba").toLowerCase();
  const w =
    windowDays != null && windowDays !== ""
      ? `&window=${encodeURIComponent(windowDays)}`
      : "";
  return request(
    `/api/predictions?league=${encodeURIComponent(l)}&date=${encodeURIComponent(date)}${w}`
  );
}

/**
 * ✅ NEW: League-specific predict endpoint (recommended for Predict.jsx)
 * /api/nba/predict?date=...&window=...
 * /api/nhl/predict?date=...&window=...
 */
export async function getLeaguePredict(league, date, windowDays) {
  const l = String(league || "nba").toLowerCase();
  const w =
    windowDays != null && windowDays !== ""
      ? `&window=${encodeURIComponent(windowDays)}`
      : "";
  return request(`/api/${encodeURIComponent(l)}/predict?date=${encodeURIComponent(date)}${w}`);
}

/**
 * ✅ Teams
 */
export async function getNbaTeams() {
  return request(`/api/nba/teams`);
}
