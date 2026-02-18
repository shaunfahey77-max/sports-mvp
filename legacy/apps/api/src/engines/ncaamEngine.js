// apps/api/src/engines/ncaamEngine.js
// Clean engine contract: getNcaamGames, buildNcaamPredictions, predict
// CBBD-first using process.env.CBBD_API_KEY, with ESPN fallback (to avoid breaking).

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
    throw new Error(`NCAAM invalid date: "${date}" (expected YYYY-MM-DD)`);
  }
  return date;
}

async function httpJson(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
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

// -------- CBBD (CollegeBasketballData) --------
// We keep this tolerant because providers vary. If you confirm the exact endpoint you want,
// we can lock it down to one canonical URL.
function cbbdHeaders() {
  const key = process.env.CBBD_API_KEY || "";
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// Candidate endpoints (try in order). We only need a date -> games list.
function cbbdCandidateUrls(date) {
  // These are "best guess" patterns used by many sports-data APIs.
  // If your CBBD docs specify a different path, swap it here.
  const d = encodeURIComponent(date);
  return [
    `https://api.collegebasketballdata.com/games?date=${d}`,
    `https://api.collegebasketballdata.com/games?startDate=${d}&endDate=${d}`,
    `https://api.collegebasketballdata.com/games?dates[]=${d}`,
    `https://api.collegebasketballdata.com/scoreboard?date=${d}`,
  ];
}

function normalizeCbbdGame(date, row) {
  // Try to detect common fields.
  const idRaw =
    row?.gameId ??
    row?.id ??
    row?.game_id ??
    row?.eventId ??
    row?.event_id ??
    null;

  const id = idRaw != null ? `ncaam-${String(idRaw)}` : null;

  const status =
    row?.status ??
    row?.gameStatus ??
    row?.state ??
    row?.game_state ??
    row?.finalStatus ??
    "Scheduled";

  const home = row?.homeTeam || row?.home || row?.teams?.home || row?.competitors?.home || {};
  const away = row?.awayTeam || row?.away || row?.teams?.away || row?.competitors?.away || {};

  const homeAbbr = (home?.abbreviation || home?.abbr || home?.shortName || home?.teamAbbr || "").toUpperCase();
  const awayAbbr = (away?.abbreviation || away?.abbr || away?.shortName || away?.teamAbbr || "").toUpperCase();

  const homeName = home?.name || home?.teamName || home?.displayName || home?.shortName || null;
  const awayName = away?.name || away?.teamName || away?.displayName || away?.shortName || null;

  const homeScore = Number.isFinite(home?.score) ? home.score : (Number.isFinite(row?.homeScore) ? row.homeScore : null);
  const awayScore = Number.isFinite(away?.score) ? away.score : (Number.isFinite(row?.awayScore) ? row.awayScore : null);

  const completed =
    String(status).toLowerCase() === "final" ||
    String(status).toLowerCase() === "completed" ||
    (homeScore != null && awayScore != null && String(status).toLowerCase() !== "scheduled");

  return {
    league: "ncaam",
    id,
    date,
    status,
    homeScore,
    awayScore,
    homeTeamId: homeAbbr ? `ncaam-${homeAbbr.toLowerCase()}` : null,
    awayTeamId: awayAbbr ? `ncaam-${awayAbbr.toLowerCase()}` : null,
    homeTeam: {
      id: homeAbbr ? `ncaam-${homeAbbr.toLowerCase()}` : null,
      name: homeName,
      city: home?.city || null,
      abbr: homeAbbr || null,
      score: homeScore,
    },
    awayTeam: {
      id: awayAbbr ? `ncaam-${awayAbbr.toLowerCase()}` : null,
      name: awayName,
      city: away?.city || null,
      abbr: awayAbbr || null,
      score: awayScore,
    },
    completed,
    _source: { provider: "cbbd" },
  };
}

async function tryFetchCbbdGames(date) {
  const key = process.env.CBBD_API_KEY || "";
  if (!key) return null;

  const headers = cbbdHeaders();
  const urls = cbbdCandidateUrls(date);

  let lastErr = null;

  for (const url of urls) {
    try {
      const json = await httpJson(url, { headers });
      // common response shapes: {data:[...]}, {games:[...]}, [...]
      const rows =
        Array.isArray(json) ? json :
        Array.isArray(json?.data) ? json.data :
        Array.isArray(json?.games) ? json.games :
        Array.isArray(json?.events) ? json.events :
        null;

      if (!rows || rows.length === 0) continue;

      const games = rows.map((r) => normalizeCbbdGame(date, r)).filter((g) => g.id);
      if (games.length) return games;
    } catch (e) {
      lastErr = e;
      // keep trying next candidate
    }
  }

  // If CBBD is present but none of our candidate URLs worked, bubble a *soft* failure up to caller.
  // Caller will fallback to ESPN.
  return { _cbbdFailed: true, error: lastErr?.message || "CBBD fetch failed" };
}

// -------- ESPN fallback (only to prevent total breakage) --------
async function fetchEspnGames(date) {
  // ESPN scoreboard endpoint
  const url = `https://site.web.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${encodeURIComponent(
    date.replaceAll("-", "")
  )}`;

  const json = await httpJson(url);
  const events = Array.isArray(json?.events) ? json.events : [];

  return events.map((ev) => {
    const id = ev?.id != null ? `ncaam-${String(ev.id)}` : null;

    const comps = ev?.competitions?.[0];
    const competitors = Array.isArray(comps?.competitors) ? comps.competitors : [];
    const home = competitors.find((c) => c?.homeAway === "home") || {};
    const away = competitors.find((c) => c?.homeAway === "away") || {};

    const homeScore = home?.score != null ? Number(home.score) : null;
    const awayScore = away?.score != null ? Number(away.score) : null;

    const status = comps?.status?.type?.description || comps?.status?.type?.name || "Scheduled";
    const completed = !!comps?.status?.type?.completed || (homeScore != null && awayScore != null && String(status).toLowerCase() === "final");

    const homeAbbr = (home?.team?.abbreviation || "").toUpperCase();
    const awayAbbr = (away?.team?.abbreviation || "").toUpperCase();

    return {
      league: "ncaam",
      id,
      date,
      status,
      homeScore,
      awayScore,
      homeTeamId: homeAbbr ? `ncaam-${homeAbbr.toLowerCase()}` : null,
      awayTeamId: awayAbbr ? `ncaam-${awayAbbr.toLowerCase()}` : null,
      homeTeam: {
        id: homeAbbr ? `ncaam-${homeAbbr.toLowerCase()}` : null,
        name: home?.team?.displayName || home?.team?.name || null,
        city: null,
        abbr: homeAbbr || null,
        score: homeScore,
      },
      awayTeam: {
        id: awayAbbr ? `ncaam-${awayAbbr.toLowerCase()}` : null,
        name: away?.team?.displayName || away?.team?.name || null,
        city: null,
        abbr: awayAbbr || null,
        score: awayScore,
      },
      completed,
      _source: { provider: "espn" },
    };
  }).filter((g) => g.id);
}

export async function getNcaamGames(date, opts = {}) {
  const d = requiredDate(date);
  const expandTeams = !!opts.expandTeams;

  const cacheKey = `ncaam:games:${d}:expand=${expandTeams ? 1 : 0}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // CBBD-first
  const cbbdResult = await tryFetchCbbdGames(d);

  let games;
  if (Array.isArray(cbbdResult)) {
    games = cbbdResult;
  } else {
    // fallback to ESPN if CBBD missing/unreachable
    games = await fetchEspnGames(d);
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

export async function buildNcaamPredictions(date, opts = {}) {
  const d = requiredDate(date);
  const force = !!opts.force;

  const cacheKey = `ncaam:pred:${d}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const games = await getNcaamGames(d, { expandTeams: true });

  // IMPORTANT: return a prediction row per game so scoring can grade all completed games.
  const preds = games.map((g) => {
    const winProb = 0.52;     // baseline placeholder
    const edge = 0.02;
    const confidence = 0.55;
    const pickSide = "home";

    return {
      league: "ncaam",
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
      _source: { model: "ncaam-baseline-v1", provider: g?._source?.provider || "cbbd/espn" },
    };
  });

  cacheSet(cacheKey, preds);
  return preds;
}

export async function predict(date, opts = {}) {
  return buildNcaamPredictions(date, opts);
}
