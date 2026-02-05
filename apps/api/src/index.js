import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ✅ sanity route (proves we’re running THIS file)
app.get("/__ping", (_req, res) =>
  res.json({ ok: true, from: "apps/api/src/index.js" })
);

/**
 * Config
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";
const NHL_API_BASE = "https://api-web.nhle.com/v1";

/**
 * Caching
 * - short TTL for live pages
 * - longer TTL for heavy NBA history pulls
 */
const CACHE_TTL_MS = 60_000;
const HEAVY_CACHE_TTL_MS = 10 * 60_000;

const cache = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.ttl ?? CACHE_TTL_MS;
  if (Date.now() - hit.time > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}
function setCache(key, value, ttl = CACHE_TTL_MS) {
  cache.set(key, { time: Date.now(), ttl, value });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, { headers } = {}, { cacheTtlMs = CACHE_TTL_MS } = {}) {
  const cacheKey = `GET:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, { headers });

  // Handle rate limit explicitly
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Upstream 429 for ${url}${text ? ` — ${text}` : ""} — Too many requests, please try again later.`
    );
    err.status = 429;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Upstream error ${res.status} for ${url}${text ? ` — ${text}` : ""}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  setCache(cacheKey, data, cacheTtlMs);
  return data;
}

/**
 * Helpers
 */
function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}
function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}
function toNhlTeamId(triCode) {
  return `nhl-${String(triCode || "").toLowerCase()}`;
}
function wantExpandTeams(req) {
  const v = String(req.query.expand || "").toLowerCase();
  return v === "teams" || v === "true" || v === "1";
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function addDays(yyyyMmDd, deltaDays) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * ✅ NBA Team fallback (prevents UI breaking if upstream 429/any issue)
 * Abbr + city + name
 */
const NBA_TEAMS_FALLBACK = [
  ["ATL", "Atlanta", "Hawks"],
  ["BOS", "Boston", "Celtics"],
  ["BKN", "Brooklyn", "Nets"],
  ["CHA", "Charlotte", "Hornets"],
  ["CHI", "Chicago", "Bulls"],
  ["CLE", "Cleveland", "Cavaliers"],
  ["DAL", "Dallas", "Mavericks"],
  ["DEN", "Denver", "Nuggets"],
  ["DET", "Detroit", "Pistons"],
  ["GSW", "Golden State", "Warriors"],
  ["HOU", "Houston", "Rockets"],
  ["IND", "Indiana", "Pacers"],
  ["LAC", "Los Angeles", "Clippers"],
  ["LAL", "Los Angeles", "Lakers"],
  ["MEM", "Memphis", "Grizzlies"],
  ["MIA", "Miami", "Heat"],
  ["MIL", "Milwaukee", "Bucks"],
  ["MIN", "Minnesota", "Timberwolves"],
  ["NOP", "New Orleans", "Pelicans"],
  ["NYK", "New York", "Knicks"],
  ["OKC", "Oklahoma City", "Thunder"],
  ["ORL", "Orlando", "Magic"],
  ["PHI", "Philadelphia", "76ers"],
  ["PHX", "Phoenix", "Suns"],
  ["POR", "Portland", "Trail Blazers"],
  ["SAC", "Sacramento", "Kings"],
  ["SAS", "San Antonio", "Spurs"],
  ["TOR", "Toronto", "Raptors"],
  ["UTA", "Utah", "Jazz"],
  ["WAS", "Washington", "Wizards"],
].map(([abbr, city, name]) => ({
  id: toNbaTeamId(abbr),
  abbr,
  city,
  name: `${city} ${name}`,
}));

/**
 * NBA (balldontlie) — light endpoints
 */
async function getNbaTeams() {
  if (!NBA_API_KEY) {
    // no key → return fallback so UI doesn't explode
    return { teams: NBA_TEAMS_FALLBACK };
  }

  try {
    const url = `${NBA_API_BASE}/teams`;
    const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });
    const teams = (json?.data || [])
      .filter((t) => Number(t?.id) >= 1 && Number(t?.id) <= 30)
      .map((t) => ({
        id: toNbaTeamId(t.abbreviation),
        name: t.full_name || `${t.city} ${t.name}`.trim(),
        city: t.city || "",
        abbr: t.abbreviation || "",
        _source: { provider: "balldontlie", teamId: t.id },
      }));
    return { teams: teams.length ? teams : NBA_TEAMS_FALLBACK };
  } catch (_e) {
    // upstream error / 429 → fallback
    return { teams: NBA_TEAMS_FALLBACK };
  }
}

async function getNbaGamesByDate(dateYYYYMMDD, expandTeams) {
  if (!NBA_API_KEY) {
    throw new Error("Missing NBA_API_KEY. Add it to apps/api/.env to enable NBA live data.");
  }

  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(dateYYYYMMDD)}`;
  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });
  const rows = json?.data || [];

  return rows.map((g) => {
    const homeAbbr = g?.home_team?.abbreviation;
    const awayAbbr = g?.visitor_team?.abbreviation;

    const base = {
      league: "nba",
      id: `nba-${g.id}`,
      date: String(g?.date || "").slice(0, 10),
      status: g?.status || "",
      homeScore: typeof g?.home_team_score === "number" ? g.home_team_score : null,
      awayScore: typeof g?.visitor_team_score === "number" ? g.visitor_team_score : null,
      homeTeamId: toNbaTeamId(homeAbbr),
      awayTeamId: toNbaTeamId(awayAbbr),
    };

    if (!expandTeams) return base;

    return {
      ...base,
      homeTeam: {
        id: toNbaTeamId(homeAbbr),
        name: g?.home_team?.full_name || "",
        city: g?.home_team?.city || "",
        abbr: homeAbbr || "",
        score: typeof g?.home_team_score === "number" ? g.home_team_score : null,
      },
      awayTeam: {
        id: toNbaTeamId(awayAbbr),
        name: g?.visitor_team?.full_name || "",
        city: g?.visitor_team?.city || "",
        abbr: awayAbbr || "",
        score: typeof g?.visitor_team_score === "number" ? g.visitor_team_score : null,
      },
    };
  });
}

/**
 * ✅ NEW: Bulk NBA history fetch (league-wide) in a date window.
 * This avoids the per-team spam that causes 429s.
 */
async function getNbaGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  if (!NBA_API_KEY) {
    throw new Error("Missing NBA_API_KEY. Add it to apps/api/.env to enable NBA live data.");
  }

  const cacheKey = `NBA_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const all = [];
  const perPage = 100;

  // balldontlie v1 supports pagination with `page` + `per_page`
  for (let page = 1; page <= 10; page++) {
    const url =
      `${NBA_API_BASE}/games?per_page=${perPage}` +
      `&page=${page}` +
      `&start_date=${encodeURIComponent(startYYYYMMDD)}` +
      `&end_date=${encodeURIComponent(endYYYYMMDD)}`;

    const json = await fetchJson(
      url,
      { headers: { Authorization: NBA_API_KEY } },
      { cacheTtlMs: HEAVY_CACHE_TTL_MS }
    );

    const rows = json?.data || [];
    all.push(...rows);

    if (rows.length < perPage) break;

    // tiny pause to reduce burstiness (helps avoid 429)
    await sleep(150);
  }

  setCache(cacheKey, all, HEAVY_CACHE_TTL_MS);
  return all;
}

function computeWinPctFromGames(rows) {
  // rows are balldontlie games objects
  const W = new Map(); // teamAbbr -> wins
  const G = new Map(); // teamAbbr -> games

  for (const g of rows) {
    const home = g?.home_team?.abbreviation;
    const away = g?.visitor_team?.abbreviation;

    const hs = g?.home_team_score;
    const as = g?.visitor_team_score;

    // only count completed games with numeric scores
    if (typeof hs !== "number" || typeof as !== "number") continue;

    if (!home || !away) continue;

    G.set(home, (G.get(home) || 0) + 1);
    G.set(away, (G.get(away) || 0) + 1);

    if (hs > as) W.set(home, (W.get(home) || 0) + 1);
    else if (as > hs) W.set(away, (W.get(away) || 0) + 1);
  }

  const pct = new Map();
  for (const [abbr, games] of G.entries()) {
    const wins = W.get(abbr) || 0;
    pct.set(abbr, games > 0 ? wins / games : 0.5);
  }
  return { pct, gamesCount: G };
}

/**
 * NHL (api-web.nhle.com) — games endpoint
 */
async function getNhlGamesByDate(dateYYYYMMDD, expandTeams) {
  const url = `${NHL_API_BASE}/schedule/${encodeURIComponent(dateYYYYMMDD)}`;
  const json = await fetchJson(url);

  const gameWeek = Array.isArray(json?.gameWeek) ? json.gameWeek : [];
  const day = gameWeek.find((d) => d?.date === dateYYYYMMDD);
  const games = Array.isArray(day?.games) ? day.games : [];

  return games.map((g) => {
    const homeTri = g?.homeTeam?.abbrev;
    const awayTri = g?.awayTeam?.abbrev;

    const base = {
      league: "nhl",
      id: `nhl-${g.id}`,
      date: dateYYYYMMDD,
      status: g?.gameState || g?.gameStateId || "",
      homeScore: typeof g?.homeTeam?.score === "number" ? g.homeTeam.score : null,
      awayScore: typeof g?.awayTeam?.score === "number" ? g.awayTeam.score : null,
      homeTeamId: toNhlTeamId(homeTri),
      awayTeamId: toNhlTeamId(awayTri),
    };

    if (!expandTeams) return base;

    return {
      ...base,
      homeTeam: {
        id: toNhlTeamId(homeTri),
        name: g?.homeTeam?.placeName?.default
          ? `${g.homeTeam.placeName.default} ${g.homeTeam?.commonName?.default || ""}`.trim()
          : g?.homeTeam?.commonName?.default || homeTri || "",
        city: g?.homeTeam?.placeName?.default || "",
        abbr: homeTri || "",
        score: typeof g?.homeTeam?.score === "number" ? g.homeTeam.score : null,
      },
      awayTeam: {
        id: toNhlTeamId(awayTri),
        name: g?.awayTeam?.placeName?.default
          ? `${g.awayTeam.placeName.default} ${g.awayTeam?.commonName?.default || ""}`.trim()
          : g?.awayTeam?.commonName?.default || awayTri || "",
        city: g?.awayTeam?.placeName?.default || "",
        abbr: awayTri || "",
        score: typeof g?.awayTeam?.score === "number" ? g.awayTeam.score : null,
      },
    };
  });
}

/**
 * ✅ NEW: shared helper that returns the NBA predict payload (same as /api/nba/predict)
 */
async function buildNbaPredictPayload(date, windowDays) {
  const endHist = addDays(date, -1);
  const startHist = addDays(endHist, -(windowDays - 1));

  const meta = {
    league: "nba",
    date,
    windowDays,
    historyStart: startHist,
    historyEnd: endHist,
    note: "Predictions based on rolling win% (bulk history fetch; avoids per-team spam).",
  };

  try {
    const todaysGames = await getNbaGamesByDate(date, true);
    const histRows = await getNbaGamesInRange(startHist, endHist);
    const { pct, gamesCount } = computeWinPctFromGames(histRows);

    const predictions = todaysGames.map((g) => {
      const homeAbbr = g?.homeTeam?.abbr || (g.homeTeamId || "").replace("nba-", "").toUpperCase();
      const awayAbbr = g?.awayTeam?.abbr || (g.awayTeamId || "").replace("nba-", "").toUpperCase();

      const homePct = pct.has(homeAbbr) ? pct.get(homeAbbr) : 0.5;
      const awayPct = pct.has(awayAbbr) ? pct.get(awayAbbr) : 0.5;

      const diff = awayPct - homePct;
      const winnerIsAway = diff >= 0;

      const confidence = clamp(0.5 + Math.abs(diff) * 0.49, 0.51, 0.99);

      return {
        gameId: g.id,
        date,
        status: g.status,
        home: { id: g.homeTeamId, name: homeAbbr },
        away: { id: g.awayTeamId, name: awayAbbr },
        prediction: {
          winnerTeamId: winnerIsAway ? g.awayTeamId : g.homeTeamId,
          winnerName: winnerIsAway ? awayAbbr : homeAbbr,
          confidence,
          factors: {
            windowDays,
            homeWinPct: homePct,
            awayWinPct: awayPct,
            homeGames: gamesCount.get(homeAbbr) || 0,
            awayGames: gamesCount.get(awayAbbr) || 0,
            winPctDiff: awayPct - homePct,
          },
        },
      };
    });

    return {
      meta: {
        ...meta,
        historyGamesFetched: histRows.length,
        historyTeamsSeen: pct.size,
      },
      predictions,
    };
  } catch (e) {
    // never hard-fail
    return {
      meta: {
        ...meta,
        error: String(e?.message || e),
        note: "NBA predict returned safely with error info (upstream may be rate-limiting or missing key).",
      },
      predictions: [],
    };
  }
}

/**
 * ✅ NEW: safe NHL “prediction” placeholder so UI never breaks
 * - If game is live/final, pick current leader
 * - Else pick home with low confidence
 */
async function buildNhlPredictPayload(date) {
  const meta = {
    league: "nhl",
    date,
    note: "Placeholder NHL picks (leader if live/final; otherwise home). Replace with real model later.",
  };

  try {
    const games = await getNhlGamesByDate(date, true);

    const predictions = games.map((g) => {
      const home = g.homeTeam?.abbr || (g.homeTeamId || "").replace("nhl-", "").toUpperCase();
      const away = g.awayTeam?.abbr || (g.awayTeamId || "").replace("nhl-", "").toUpperCase();

      const hs = Number(g.homeScore ?? g.homeTeam?.score ?? 0);
      const as = Number(g.awayScore ?? g.awayTeam?.score ?? 0);

      const status = String(g.status || "").toLowerCase();
      const started =
        status.includes("live") ||
        status.includes("final") ||
        status.includes("off") ||
        status.includes("in progress") ||
        status.includes("ongoing");

      const winnerName = started ? (hs >= as ? home : away) : home;
      const winnerTeamId = winnerName === home ? g.homeTeamId : g.awayTeamId;

      const confidence = started
        ? clamp(0.55 + Math.abs(hs - as) / 10, 0.55, 0.95)
        : 0.55;

      return {
        gameId: g.id,
        date,
        status: g.status,
        home: { id: g.homeTeamId, name: home },
        away: { id: g.awayTeamId, name: away },
        prediction: {
          winnerTeamId,
          winnerName,
          confidence,
          factors: { placeholder: true },
        },
      };
    });

    return { meta, predictions };
  } catch (e) {
    return {
      meta: { ...meta, error: String(e?.message || e) },
      predictions: [],
    };
  }
}

/**
 * Routes
 */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "sports-mvp-api", time: new Date().toISOString() })
);

/**
 * ✅ Ensure /api/nba/teams never 404s (your UI was hitting this and failing)
 */
app.get("/api/nba/teams", async (_req, res) => {
  const { teams } = await getNbaTeams();
  res.json(teams);
});

// Games (by date)
app.get("/api/nba/games", async (req, res) => {
  try {
    const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const expand = wantExpandTeams(req);
    const games = await getNbaGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/nhl/games", async (req, res) => {
  try {
    const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const expand = wantExpandTeams(req);
    const games = await getNhlGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * ✅ NBA Predict (rolling win% using BULK history fetch)
 * Query:
 *   /api/nba/predict?date=YYYY-MM-DD&window=14
 */
app.get("/api/nba/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Math.max(3, Math.min(30, Number(req.query.window || 14)));
  const payload = await buildNbaPredictPayload(date, windowDays);
  res.json(payload);
});

/**
 * ✅ NEW: The missing endpoint your UI is calling
 * Query:
 *   /api/predictions?league=nba&date=YYYY-MM-DD&window=14
 *   /api/predictions?league=nhl&date=YYYY-MM-DD
 */
app.get("/api/predictions", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Math.max(3, Math.min(30, Number(req.query.window || 14)));

  if (league === "nba") {
    const payload = await buildNbaPredictPayload(date, windowDays);
    return res.json({
      league,
      date,
      count: payload.predictions?.length || 0,
      ...payload,
    });
  }

  if (league === "nhl") {
    const payload = await buildNhlPredictPayload(date);
    return res.json({
      league,
      date,
      count: payload.predictions?.length || 0,
      ...payload,
    });
  }

  return res.status(400).json({
    error: "Unsupported league. Use league=nba or league=nhl",
    got: league,
  });
});

/**
 * Combined games endpoint (optional, safe)
 */
app.get("/api/games", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const expandTeams = wantExpandTeams(req);

  let nbaGames = [];
  let nhlGames = [];
  let nbaError = null;
  let nhlError = null;

  try {
    nbaGames = await getNbaGamesByDate(date, expandTeams);
  } catch (e) {
    nbaError = String(e?.message || e);
  }

  try {
    nhlGames = await getNhlGamesByDate(date, expandTeams);
  } catch (e) {
    nhlError = String(e?.message || e);
  }

  res.json({
    date,
    expandTeams,
    counts: { total: nbaGames.length + nhlGames.length, nba: nbaGames.length, nhl: nhlGames.length },
    games: [...nbaGames, ...nhlGames],
    errors: { nba: nbaError, nhl: nhlError },
  });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
