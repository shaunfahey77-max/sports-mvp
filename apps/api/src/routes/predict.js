import express from "express";

const router = express.Router();

const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";
const NHL_API_BASE = "https://api-web.nhle.com/v1";

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value) {
  cache.set(key, { time: Date.now(), value });
}

async function fetchJson(url, { headers } = {}) {
  const cacheKey = `GET:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
  }

  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}

function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}

function toNhlTeamId(tri) {
  return `nhl-${String(tri || "").toLowerCase()}`;
}

function yyyymmddUTC(d) {
  return d.toISOString().slice(0, 10);
}

function addDaysUTC(dateYYYYMMDD, deltaDays) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return yyyymmddUTC(dt);
}

/** ---------- NBA helpers (balldontlie) ---------- */

async function getNbaTeamsMap() {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const url = `${NBA_API_BASE}/teams`;
  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });

  const teams = (json?.data || [])
    .filter((t) => Number(t?.id) >= 1 && Number(t?.id) <= 30);

  const byAbbr = new Map();
  const byId = new Map();
  for (const t of teams) {
    if (t?.abbreviation) {
      byAbbr.set(t.abbreviation, t);
      byId.set(t.id, t);
    }
  }
  return { byAbbr, byId };
}

async function getNbaGamesByDate(dateYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(dateYYYYMMDD)}`;
  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });
  const rows = json?.data || [];

  return rows.map((g) => {
    const homeAbbr = g?.home_team?.abbreviation;
    const awayAbbr = g?.visitor_team?.abbreviation;

    return {
      gameId: `nba-${g.id}`,
      date: String(g?.date || "").slice(0, 10),
      status: g?.status || "",
      home: { id: toNbaTeamId(homeAbbr), name: homeAbbr || "" },
      away: { id: toNbaTeamId(awayAbbr), name: awayAbbr || "" },
      _raw: g,
    };
  });
}

/**
 * Rolling win% for a team over a window ending the day BEFORE the selected date.
 * (So future dates don’t break / don’t include 0-0 games.)
 */
async function nbaTeamRollingWinPct(teamNumericId, endDateYYYYMMDD, windowDays) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const end = addDaysUTC(endDateYYYYMMDD, -1);
  const start = addDaysUTC(end, -(windowDays - 1));

  const url =
    `${NBA_API_BASE}/games?per_page=100` +
    `&team_ids[]=${encodeURIComponent(teamNumericId)}` +
    `&start_date=${encodeURIComponent(start)}` +
    `&end_date=${encodeURIComponent(end)}`;

  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });
  const games = json?.data || [];

  let played = 0;
  let wins = 0;

  for (const g of games) {
    const hs = g?.home_team_score;
    const as = g?.visitor_team_score;
    if (typeof hs !== "number" || typeof as !== "number") continue;
    if (hs === 0 && as === 0) continue;

    played++;

    const homeTeamId = g?.home_team?.id;
    const awayTeamId = g?.visitor_team?.id;

    const winner =
      hs > as ? homeTeamId : as > hs ? awayTeamId : null;

    if (winner && winner === teamNumericId) wins++;
  }

  if (played === 0) return { winPct: 0.5, games: 0, withScores: 0 };

  return { winPct: wins / played, games: games.length, withScores: played };
}

function confidenceFromDiff(diffAbs) {
  // diffAbs in [0..1]; map to [0.52..0.97]
  const base = 0.52;
  const span = 0.45;
  const c = base + diffAbs * span;
  return Math.max(0.52, Math.min(0.97, c));
}

async function buildNbaPredictions(dateYYYYMMDD, windowDays) {
  const schedule = await getNbaGamesByDate(dateYYYYMMDD);
  if (!schedule.length) {
    return {
      meta: {
        league: "nba",
        date: dateYYYYMMDD,
        windowDays,
        historyGamesFetched: 0,
        historyGamesWithScores: 0,
        note: "No NBA games scheduled for this date (or upstream returned none).",
      },
      predictions: [],
    };
  }

  const { byAbbr } = await getNbaTeamsMap();

  let historyFetchedTotal = 0;
  let withScoresTotal = 0;

  const predictions = [];

  for (const g of schedule) {
    const homeAbbr = g?.home?.name;
    const awayAbbr = g?.away?.name;

    const homeTeam = byAbbr.get(homeAbbr);
    const awayTeam = byAbbr.get(awayAbbr);

    // If mapping fails, skip safely (don’t 500)
    if (!homeTeam || !awayTeam) continue;

    const homeStats = await nbaTeamRollingWinPct(homeTeam.id, dateYYYYMMDD, windowDays);
    const awayStats = await nbaTeamRollingWinPct(awayTeam.id, dateYYYYMMDD, windowDays);

    historyFetchedTotal += (homeStats.games + awayStats.games);
    withScoresTotal += (homeStats.withScores + awayStats.withScores);

    const diff = homeStats.winPct - awayStats.winPct;

    const winner = diff >= 0 ? g.home : g.away; // if tied, pick home
    const conf = confidenceFromDiff(Math.abs(diff));

    predictions.push({
      gameId: g.gameId,
      date: dateYYYYMMDD,
      status: g.status,
      home: g.home,
      away: g.away,
      prediction: {
        winnerTeamId: winner.id,
        winnerName: winner.name,
        confidence: conf,
        factors: {
          windowDays,
          homeWinPct: homeStats.winPct,
          awayWinPct: awayStats.winPct,
          homeGames: homeStats.withScores,
          awayGames: awayStats.withScores,
          winPctDiff: diff,
          note: "MVP model: rolling win% from last N days of results",
        },
      },
    });
  }

  return {
    meta: {
      league: "nba",
      date: dateYYYYMMDD,
      windowDays,
      historyGamesFetched: historyFetchedTotal,
      historyGamesWithScores: withScoresTotal,
      note: "Predictions based on rolling win%",
      model: "MVP rolling win%",
    },
    predictions,
  };
}

/** ---------- NHL helpers (nhle) ---------- */

async function getNhlGamesByDate(dateYYYYMMDD) {
  const url = `${NHL_API_BASE}/schedule/${encodeURIComponent(dateYYYYMMDD)}`;
  const json = await fetchJson(url);

  const gameWeek = Array.isArray(json?.gameWeek) ? json.gameWeek : [];
  const day = gameWeek.find((d) => d?.date === dateYYYYMMDD);
  const games = Array.isArray(day?.games) ? day.games : [];

  return games.map((g) => {
    const homeTri = g?.homeTeam?.abbrev;
    const awayTri = g?.awayTeam?.abbrev;

    return {
      gameId: `nhl-${g.id}`,
      date: dateYYYYMMDD,
      status: g?.gameState || g?.gameStateId || "",
      home: { id: toNhlTeamId(homeTri), name: homeTri || "" },
      away: { id: toNhlTeamId(awayTri), name: awayTri || "" },
    };
  });
}

async function buildNhlPredictions(dateYYYYMMDD, windowDays) {
  // Keep it simple/stable: use schedule only, neutral confidence,
  // but you can later plug in standings/rolling.
  const schedule = await getNhlGamesByDate(dateYYYYMMDD);

  if (!schedule.length) {
    return {
      meta: {
        league: "nhl",
        date: dateYYYYMMDD,
        windowDays,
        historyGamesFetched: 0,
        historyGamesWithScores: 0,
        note: "No NHL games scheduled for this date (or upstream returned none).",
      },
      predictions: [],
    };
  }

  const predictions = schedule.map((g) => ({
    gameId: g.gameId,
    date: g.date,
    status: g.status,
    home: g.home,
    away: g.away,
    prediction: {
      winnerTeamId: g.home.id,
      winnerName: g.home.name,
      confidence: 0.60,
      factors: {
        windowDays,
        note: "Stable NHL placeholder model (schedule-based).",
      },
    },
  }));

  return {
    meta: {
      league: "nhl",
      date: dateYYYYMMDD,
      windowDays,
      historyGamesFetched: 0,
      historyGamesWithScores: 0,
      note: "Schedule-based NHL predictions (stable).",
      model: "NHL schedule-based",
    },
    predictions,
  };
}

/** ---------- Routes ---------- */

router.get("/nba/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Number(req.query.windowDays || 14);

  try {
    const out = await buildNbaPredictions(date, windowDays);
    res.json(out);
  } catch (e) {
    // ✅ never hard-fail the UI for “no games / upstream”
    res.json({
      meta: {
        league: "nba",
        date,
        windowDays,
        historyGamesFetched: 0,
        historyGamesWithScores: 0,
        note: "NBA predict returned safely with error info.",
        error: String(e?.message || e),
      },
      predictions: [],
    });
  }
});

router.get("/nhl/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Number(req.query.windowDays || 14);

  try {
    const out = await buildNhlPredictions(date, windowDays);
    res.json(out);
  } catch (e) {
    res.json({
      meta: {
        league: "nhl",
        date,
        windowDays,
        historyGamesFetched: 0,
        historyGamesWithScores: 0,
        note: "NHL predict returned safely with error info.",
        error: String(e?.message || e),
      },
      predictions: [],
    });
  }
});

export default router;
