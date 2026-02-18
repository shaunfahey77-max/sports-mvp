// apps/api/src/engines/nhlEngine.js
// Clean engine contract: getNhlGames, buildNhlPredictions, predict
// Uses NHL public schedule endpoint (api-web.nhle.com), with cache.

const NHL_SCHEDULE_BASE = "https://api-web.nhle.com/v1";

const _cache = new Map();
const DEFAULT_TTL_MS = 1000 * 60 * 10;

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
    throw new Error(`NHL invalid date: "${date}" (expected YYYY-MM-DD)`);
  }
  return date;
}

async function httpJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();

    if (!res.ok) {
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

function normalizeNhlGame(date, g) {
  // NHL schedule returns games under gameWeek[].games[]
  const idNum = g?.id ?? g?.gameId ?? null;
  const id = idNum != null ? `nhl-${String(idNum)}` : null;

  const home = g?.homeTeam || {};
  const away = g?.awayTeam || {};

  const homeScore = Number.isFinite(home?.score) ? home.score : (Number.isFinite(g?.homeTeamScore) ? g.homeTeamScore : null);
  const awayScore = Number.isFinite(away?.score) ? away.score : (Number.isFinite(g?.awayTeamScore) ? g.awayTeamScore : null);

  const state = (g?.gameState || g?.gameStateId || g?.gameType || "").toString();
  const status =
    g?.gameState === "FINAL" || g?.gameState === "OFF"
      ? "OFF"
      : g?.gameState || g?.gameStatus || g?.gameStateId || "Scheduled";

  // "OFF" is commonly used by nhle schedule as final/off.
  const completed =
    status === "OFF" ||
    String(g?.gameState || "").toUpperCase() === "FINAL" ||
    (homeScore != null && awayScore != null && String(status).toLowerCase() !== "scheduled");

  const homeAbbr = (home?.abbrev || home?.abbreviation || home?.triCode || "").toUpperCase();
  const awayAbbr = (away?.abbrev || away?.abbreviation || away?.triCode || "").toUpperCase();

  return {
    league: "nhl",
    id,
    date,
    status,
    homeScore,
    awayScore,
    homeTeamId: homeAbbr ? `nhl-${homeAbbr.toLowerCase()}` : null,
    awayTeamId: awayAbbr ? `nhl-${awayAbbr.toLowerCase()}` : null,
    homeTeam: {
      id: homeAbbr ? `nhl-${homeAbbr.toLowerCase()}` : null,
      name: home?.placeName?.default || home?.name?.default || home?.name || null,
      city: home?.placeName?.default || null,
      abbr: homeAbbr || null,
      score: homeScore,
    },
    awayTeam: {
      id: awayAbbr ? `nhl-${awayAbbr.toLowerCase()}` : null,
      name: away?.placeName?.default || away?.name?.default || away?.name || null,
      city: away?.placeName?.default || null,
      abbr: awayAbbr || null,
      score: awayScore,
    },
    completed,
    _source: { provider: "nhle" },
  };
}

export async function getNhlGames(date, opts = {}) {
  const d = requiredDate(date);
  const expandTeams = !!opts.expandTeams;

  const cacheKey = `nhl:games:${d}:expand=${expandTeams ? 1 : 0}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${NHL_SCHEDULE_BASE}/schedule/${encodeURIComponent(d)}`;
  const json = await httpJson(url);

  const gameWeeks = Array.isArray(json?.gameWeek) ? json.gameWeek : [];
  let games = [];
  for (const wk of gameWeeks) {
    if (wk?.date !== d) continue;
    const wkGames = Array.isArray(wk?.games) ? wk.games : [];
    games = wkGames.map((g) => normalizeNhlGame(d, g));
    break;
  }

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

export async function buildNhlPredictions(date, opts = {}) {
  const d = requiredDate(date);
  const force = !!opts.force;

  const cacheKey = `nhl:pred:${d}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const games = await getNhlGames(d, { expandTeams: true });

  const preds = games.map((g) => {
    // Slightly more conservative than NBA baseline.
    const winProb = 0.515;
    const edge = 0.015;
    const confidence = 0.54;
    const pickSide = "home";

    return {
      league: "nhl",
      gameId: g.id,
      date: g.date,
      status: g.status,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      completed: !!g.completed,

      winProb,
      edge,
      confidence,
      pickSide,
      _source: { model: "nhl-baseline-v1", provider: g?._source?.provider || "nhle" },
    };
  });

  cacheSet(cacheKey, preds);
  return preds;
}

export async function predict(date, opts = {}) {
  return buildNhlPredictions(date, opts);
}
