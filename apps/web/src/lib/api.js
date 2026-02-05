const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (location.hostname === "localhost" ? "http://127.0.0.1:3001" : "");

async function request(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);
  const text = await res.text();

  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function getCombinedGames(date) {
  return request(`/api/games?date=${encodeURIComponent(date)}&expand=teams`);
}

export async function getPredictions({ league, date, windowDays }) {
  const w = windowDays ? `&window=${encodeURIComponent(windowDays)}` : "";
  return request(
    `/api/predictions?league=${encodeURIComponent(league)}&date=${encodeURIComponent(date)}${w}`
  );
}

export async function getNbaTeams() {
  return request(`/api/nba/teams`);
}
