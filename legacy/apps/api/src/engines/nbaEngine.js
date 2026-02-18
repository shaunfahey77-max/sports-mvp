// apps/api/src/engines/nbaEngine.js
// Clean engine contract: getNbaGames, buildNbaPredictions, predict
// Uses balldontlie v1 (or whatever your existing upstream is), with small in-memory cache.

const NBA_API_BASE = "https://api.balldontlie.io/v1";

// Cache (process memory). Good enough for local + small deploys.
const _cache = new Map(); // key -> { ts, data }
const DEFAULT_TTL_MS = 1000 * 60 * 10; // 10 minutes

function cacheGet(key, ttlMs = DEFAULT_TTL_MS) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttlMs) return null;
  return hit.data;
}
function cacheSet(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}

function requiredDate(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`NBA invalid date: "${date}" (expected YYYY-MM-DD)`);
  }
  return date;
}

async function httpJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const text = await res.text();

    if (!res.ok) {
      // Preserve 429 clarity
      if (res.status === 429) {
        throw new Error(`Upstream 429 for ${url} — Too many requests, please try again later.`);
      }
      throw new Error(`Upstream ${res.status} for ${url} — ${text.slice(0, 300)}`);
    }

    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

function nbaHeaders() {
  // If you have BALLEDONTLIE_API_KEY set, use it.
  const key =
    process.env.BALLDONTLIE_API_KEY ||
    process.env.BDL_API_KEY ||
    process.env.NBA_API_KEY ||
    "";

  return key ? { Authorization: key } : {};
}

function normalizeTeam(team) {
  if (!team) return null;
  return {
    id: team.id != null ? `nba-${String(team.id)}` : null,
    name: team.full_name || team.name || null,
    city: team.city || null,
    abbr: (team.abbreviation || team.abbr || "").toUpperCase() || null,
  };
}

function normalizeGameRow(row) {
  // balldontlie v1 shape:
  // row: { id, date, status, home_team_score, visitor_team_score, home_team, visitor_team, postseason, ... }
  const id = row?.id != null ? `nba-${String(row.id)}` : null;
  const status = row?.status || "";
  const homeScore = Number.isFinite(row?.home_team_score) ? row.home_team_score : null;
  const awayScore = Number.isFinite(row?.visitor_team_score) ? row.visitor_team_score : null;

  const completed =
    String(status).toLowerCase() === "final" ||
    String(status).toLowerCase() === "final/ot" ||
    (homeScore != null && awayScore != null && String(status).length > 0 && String(status).toLowerCase() !== "scheduled");

  return {
    league: "nba",
    id,
    date: (row?.date || "").slice(0, 10),
    status: status || (completed ? "Final" : "Scheduled"),
    homeScore,
    awayScore,
    homeTeamId: row?.home_team?.id != null ? `nba-${row.home_team.id}` : null,
    awayTeamId: row?.visitor_team?.id != null ? `nba-${row.visitor_team.id}` : null,
    homeTeam: normalizeTeam(row?.home_team),
    awayTeam: normalizeTeam(row?.visitor_team),
    completed,
    _source: { provider: "balldontlie" },
  };
}

export async function getNbaGames(date, opts = {}) {
  const d = requiredDate(date);
  const expandTeams = !!opts.expandTeams;

  const cacheKey = `nba:games:${d}:expand=${expandTeams ? 1 : 0}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // balldontlie supports dates[]=YYYY-MM-DD
  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(d)}`;
  const json = await httpJson(url, { headers: nbaHeaders() });

  const rows = Array.isArray(json?.data) ? json.data : [];
  const games = rows.map(normalizeGameRow);

  // If expandTeams=false, strip embedded team objects (some callers may want lean payload).
  const out = expandTeams
    ? games
    : games.map((g) => ({
        ...g,
        homeTeam: undefined,
        awayTeam: undefined,
      }));

  cacheSet(cacheKey, out);
  return out;
}

// Minimal “premium-lite” prediction builder used by scoring cron.
// Replace logic later with your real model inputs.
// Key: MUST return one prediction row per game to allow grading.
export async function buildNbaPredictions(date, opts = {}) {
  const d = requiredDate(date);
  const force = !!opts.force;

  const cacheKey = `nba:pred:${d}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const games = await getNbaGames(d, { expandTeams: true });

  const preds = games.map((g) => {
    // Baseline: slightly home-leaning, deterministic.
    const winProb = 0.52;
    const edge = 0.02;
    const confidence = 0.55;
    const pickSide = "home";

    return {
      league: "nba",
      gameId: g.id,
      date: g.date,
      status: g.status,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      completed: !!g.completed,

      // model outputs used by Upsets/Score/Performance
      winProb,
      edge,
      confidence,
      pickSide,
      _source: { model: "nba-baseline-v1", provider: g?._source?.provider || "balldontlie" },
    };
  });

  cacheSet(cacheKey, preds);
  return preds;
}

// Generic runner expects an engine export called predict()
export async function predict(date, opts = {}) {
  return buildNbaPredictions(date, opts);
}
