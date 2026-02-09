// apps/api/src/routes/predict.js
import express from "express";

const router = express.Router();

/**
 * Upstreams
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";
const NHL_API_BASE = "https://api-web.nhle.com/v1";

// ✅ Most reliable ESPN scoreboard host for single-day
const ESPN_SITE_V2 = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_NCAAM_PATH = "basketball/mens-college-basketball";

/**
 * Cache
 */
const CACHE_TTL_MS = 60_000;
const HEAVY_CACHE_TTL_MS = 20 * 60_000; // heavier cache helps avoid repeat upstream hits
const cache = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > hit.ttl) {
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
  const auth = headers?.Authorization ? String(headers.Authorization) : "";
  const cacheKey = `GET:${url}:AUTH=${auth}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, { headers });

  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Upstream 429 for ${url}${text ? ` — ${text}` : ""} — Too many requests, please try again later.`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
  }

  const data = await res.json();
  setCache(cacheKey, data, cacheTtlMs);
  return data;
}

/**
 * Date + params
 */
function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}
function readDateFromReq(req) {
  const d1 = normalizeDateParam(req.query.date);
  const d2 = normalizeDateParam(req.query["dates[]"]);
  return d1 || d2 || new Date().toISOString().slice(0, 10);
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function readWindowFromReq(req, def, min, max) {
  const raw = req.query.windowDays ?? req.query.window ?? def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return clamp(n, min, max);
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
function toEspnYYYYMMDD(dateYYYYMMDD) {
  return dateYYYYMMDD.replaceAll("-", "");
}
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shared decision helpers (NO default-home)
 */
function confidenceFromEdge(edge, edgeScale) {
  if (!Number.isFinite(edge)) return 0.5;
  const p = 1 / (1 + Math.exp(-edge / edgeScale));
  return clamp(p, 0.52, 0.97);
}
function pickFromEdge(edge, minEdgeForPick = 0.10) {
  if (!Number.isFinite(edge)) return { side: null, note: "invalid_edge" };
  if (Math.abs(edge) < minEdgeForPick) return { side: null, note: "toss_up" };
  return { side: edge > 0 ? "home" : "away", note: "ok" };
}

/**
 * Team IDs
 */
function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}
function toNhlTeamId(tri) {
  return `nhl-${String(tri || "").toLowerCase()}`;
}
function toNcaamTeamId(espnTeamId) {
  return `ncaam-${String(espnTeamId || "")}`;
}

/* =========================================================
   NBA — rate-limit safe: delay + retry + heavy cache
   ========================================================= */

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
    };
  });
}

// ✅ IMPORTANT: slow paging + multi retry on 429
const NBA_PAGE_DELAY_MS = 450;
const NBA_429_RETRIES = 6;

async function fetchNbaPage(url) {
  for (let attempt = 0; attempt <= NBA_429_RETRIES; attempt++) {
    try {
      return await fetchJson(
        url,
        { headers: { Authorization: NBA_API_KEY } },
        { cacheTtlMs: HEAVY_CACHE_TTL_MS }
      );
    } catch (e) {
      const msg = String(e?.message || e);
      if (!msg.includes("Upstream 429")) throw e;

      // backoff: 0.6s, 1.2s, 2.4s, ...
      const backoff = 600 * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }
  throw new Error(`Upstream 429 for ${url} — exceeded retry limit`);
}

async function getNbaGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const cacheKey = `NBA_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const all = [];
  const perPage = 100;

  for (let page = 1; page <= 15; page++) {
    const url =
      `${NBA_API_BASE}/games?per_page=${perPage}` +
      `&page=${page}` +
      `&start_date=${encodeURIComponent(startYYYYMMDD)}` +
      `&end_date=${encodeURIComponent(endYYYYMMDD)}`;

    const json = await fetchNbaPage(url);
    const rows = json?.data || [];
    all.push(...rows);

    if (rows.length < perPage) break;
    await sleep(NBA_PAGE_DELAY_MS);
  }

  setCache(cacheKey, all, HEAVY_CACHE_TTL_MS);
  return all;
}

function buildNbaTeamStatsFromHistory(histRows, recentGames = 6) {
  const byTeamGames = new Map();

  function add(teamId, game) {
    if (!byTeamGames.has(teamId)) byTeamGames.set(teamId, []);
    byTeamGames.get(teamId).push(game);
  }

  for (const g of histRows) {
    const hs = g?.home_team_score;
    const as = g?.visitor_team_score;
    if (typeof hs !== "number" || typeof as !== "number") continue;
    if (hs === 0 && as === 0) continue;

    const homeAbbr = g?.home_team?.abbreviation;
    const awayAbbr = g?.visitor_team?.abbreviation;
    if (!homeAbbr || !awayAbbr) continue;

    const homeId = toNbaTeamId(homeAbbr);
    const awayId = toNbaTeamId(awayAbbr);
    const date = String(g?.date || "").slice(0, 10);

    add(homeId, { date, my: hs, opp: as });
    add(awayId, { date, my: as, opp: hs });
  }

  const out = new Map();

  for (const [teamId, games] of byTeamGames.entries()) {
    games.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    let played = 0, wins = 0, pf = 0, pa = 0;
    for (const g of games) {
      played++;
      pf += g.my;
      pa += g.opp;
      if (g.my > g.opp) wins++;
    }

    const recent = games.slice(0, recentGames);
    let rPlayed = 0, rWins = 0;
    for (const g of recent) {
      rPlayed++;
      if (g.my > g.opp) rWins++;
    }

    if (played === 0) out.set(teamId, { ok: false });
    else out.set(teamId, {
      ok: true,
      winPct: wins / played,
      marginPerGame: (pf - pa) / played,
      recentWinPct: rPlayed ? rWins / rPlayed : null,
      withScores: played,
    });
  }

  return out;
}

function nbaEdge(home, away) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = 0.55;
  const wMargin = 0.30;
  const wRecent = 0.15;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clamp((home.marginPerGame - away.marginPerGame) / 12, -1, 1);
  const recentDiff = (safeNum(home.recentWinPct) ?? 0.5) - (safeNum(away.recentWinPct) ?? 0.5);

  const homeAdv = 0.02;
  return wWin * winDiff + wMargin * marginScaled + wRecent * recentDiff + homeAdv;
}

async function buildNbaPredictions(dateYYYYMMDD, windowDays) {
  const schedule = await getNbaGamesByDate(dateYYYYMMDD);
  if (!schedule.length) {
    return {
      meta: { league: "nba", date: dateYYYYMMDD, windowDays, model: "NBA blended-v1", note: "No NBA games scheduled." },
      predictions: [],
    };
  }

  const end = addDaysUTC(dateYYYYMMDD, -1);
  const start = addDaysUTC(end, -(windowDays - 1));

  const histRows = await getNbaGamesInRange(start, end);
  const teamStats = buildNbaTeamStatsFromHistory(histRows, 6);

  const predictions = [];
  let noPickCount = 0;

  for (const g of schedule) {
    const homeS = teamStats.get(g.home.id) || { ok: false };
    const awayS = teamStats.get(g.away.id) || { ok: false };

    const edge = nbaEdge(homeS, awayS);
    const pick = pickFromEdge(edge, 0.07);
    const conf = confidenceFromEdge(edge, 0.18);

    let winner = null;
    if (pick.side === "home") winner = g.home;
    else if (pick.side === "away") winner = g.away;
    else noPickCount++;

    predictions.push({
      gameId: g.gameId,
      date: dateYYYYMMDD,
      status: g.status,
      home: g.home,
      away: g.away,
      prediction: {
        winnerTeamId: winner ? winner.id : null,
        winnerName: winner ? winner.name : "",
        confidence: winner ? conf : 0.5,
        factors: {
          windowDays,
          edge,
          pickNote: pick.note,
          homeWinPct: homeS.winPct ?? null,
          awayWinPct: awayS.winPct ?? null,
          homeMarginPerGame: homeS.marginPerGame ?? null,
          awayMarginPerGame: awayS.marginPerGame ?? null,
          homeRecentWinPct: homeS.recentWinPct ?? null,
          awayRecentWinPct: awayS.recentWinPct ?? null,
          note: "Blended: win% + margin + recent form (paged with delay+retry to avoid 429).",
        },
      },
    });
  }

  return {
    meta: {
      league: "nba",
      date: dateYYYYMMDD,
      windowDays,
      historyStart: start,
      historyEnd: end,
      historyGamesFetched: histRows.length,
      noPickCount,
      model: "NBA blended-v1",
    },
    predictions,
  };
}

/* =========================================================
   NHL — standings model (stable)
   ========================================================= */

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

async function getNhlStandingsMap() {
  const url = `${NHL_API_BASE}/standings/now`;
  const json = await fetchJson(url, {}, { cacheTtlMs: 10 * 60_000 });
  const rows = Array.isArray(json?.standings) ? json.standings : [];
  const byTri = new Map();

  for (const r of rows) {
    const tri = (r?.teamAbbrev?.default || "").toUpperCase();
    if (!tri) continue;
    const pointPct = safeNum(r?.pointPct);
    const gp = safeNum(r?.gamesPlayed);
    const gd = safeNum(r?.goalDifferential);
    const gdPerGame = Number.isFinite(gd) && Number.isFinite(gp) && gp > 0 ? gd / gp : null;

    const l10w = safeNum(r?.l10Wins);
    const l10l = safeNum(r?.l10Losses);
    const l10o = safeNum(r?.l10OtLosses);
    let last10Pct = null;
    if (Number.isFinite(l10w) && Number.isFinite(l10l)) {
      const played10 = l10w + l10l + (Number.isFinite(l10o) ? l10o : 0);
      if (played10 > 0) last10Pct = (l10w + 0.5 * (Number.isFinite(l10o) ? l10o : 0)) / played10;
    }

    byTri.set(tri, { pointPct, gdPerGame, last10Pct });
  }

  return byTri;
}

function nhlEdge(home, away) {
  if (!home || !away) return NaN;
  if (!Number.isFinite(home.pointPct) || !Number.isFinite(away.pointPct)) return NaN;
  if (!Number.isFinite(home.gdPerGame) || !Number.isFinite(away.gdPerGame)) return NaN;

  const wPoint = 0.75, wGD = 0.20, wRecent = 0.05;
  const pointDiff = home.pointPct - away.pointPct;
  const gdDiff = clamp((home.gdPerGame - away.gdPerGame) / 1.3, -1, 1);
  const recentDiff =
    (Number.isFinite(home.last10Pct) ? home.last10Pct : 0.5) -
    (Number.isFinite(away.last10Pct) ? away.last10Pct : 0.5);

  const homeAdv = 0.02;
  return wPoint * pointDiff + wGD * gdDiff + wRecent * recentDiff + homeAdv;
}

async function buildNhlPredictions(dateYYYYMMDD, windowDays) {
  const schedule = await getNhlGamesByDate(dateYYYYMMDD);
  if (!schedule.length) {
    return {
      meta: { league: "nhl", date: dateYYYYMMDD, windowDays, model: "NHL blended-v1", note: "No NHL games scheduled." },
      predictions: [],
    };
  }

  const standings = await getNhlStandingsMap();
  const predictions = [];
  let noPickCount = 0;

  for (const g of schedule) {
    const homeRow = standings.get(String(g.home.name || "").toUpperCase());
    const awayRow = standings.get(String(g.away.name || "").toUpperCase());

    const edge = nhlEdge(homeRow, awayRow);
    const pick = pickFromEdge(edge, 0.08);
    const conf = confidenceFromEdge(edge, 0.20);

    let winner = null;
    if (pick.side === "home") winner = g.home;
    else if (pick.side === "away") winner = g.away;
    else noPickCount++;

    predictions.push({
      gameId: g.gameId,
      date: g.date,
      status: g.status,
      home: g.home,
      away: g.away,
      prediction: {
        winnerTeamId: winner ? winner.id : null,
        winnerName: winner ? winner.name : "",
        confidence: winner ? conf : 0.5,
        factors: { windowDays, edge, pickNote: pick.note },
      },
    });
  }

  return { meta: { league: "nhl", date: dateYYYYMMDD, windowDays, noPickCount, model: "NHL blended-v1" }, predictions };
}

/* =========================================================
   NCAAM — FIXED: loop single-day scoreboards (no range, no 404)
   ========================================================= */

function normalizeEspnEventToGame(event) {
  const comp = event?.competitions?.[0];
  const competitors = comp?.competitors;
  if (!Array.isArray(competitors)) return null;

  const home = competitors.find((c) => c?.homeAway === "home") ?? null;
  const away = competitors.find((c) => c?.homeAway === "away") ?? null;

  const homeId = home?.team?.id ? String(home.team.id) : null;
  const awayId = away?.team?.id ? String(away.team.id) : null;

  const homeScore = safeNum(home?.score);
  const awayScore = safeNum(away?.score);

  return {
    id: String(event?.id ?? `${homeId}-${awayId}-${event?.date ?? ""}`),
    date: event?.date ?? null,
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeScore,
    awayScore,
    homeName: home?.team?.abbreviation ?? home?.team?.displayName ?? "",
    awayName: away?.team?.abbreviation ?? away?.team?.displayName ?? "",
    neutralSite: Boolean(comp?.neutralSite) || false,
    status: event?.status?.type?.state || "scheduled",
  };
}

async function getNcaamScoreboardByDate(dateYYYYMMDD) {
  const ymd = toEspnYYYYMMDD(dateYYYYMMDD);
  const url = `${ESPN_SITE_V2}/${ESPN_NCAAM_PATH}/scoreboard?dates=${encodeURIComponent(ymd)}`;
  const json = await fetchJson(url, {}, { cacheTtlMs: HEAVY_CACHE_TTL_MS });
  const events = Array.isArray(json?.events) ? json.events : [];
  return events.map(normalizeEspnEventToGame).filter(Boolean);
}

async function getNcaamSlate(dateYYYYMMDD) {
  const rows = await getNcaamScoreboardByDate(dateYYYYMMDD);
  return rows.filter((g) => g.homeTeamId && g.awayTeamId);
}

// ✅ history = loop days (cached) — stable across ESPN weirdness
async function getNcaamHistory(endDateYYYYMMDD, historyDays) {
  const out = [];
  for (let i = historyDays; i >= 1; i--) {
    const d = addDaysUTC(endDateYYYYMMDD, -i);
    const dayRows = await getNcaamScoreboardByDate(d);
    out.push(...dayRows);
    await sleep(60); // gentle pacing
  }
  return out.filter((g) => g.homeTeamId && g.awayTeamId);
}

function buildNcaamTeamStatsFromHistory(history, endDateYYYYMMDD) {
  const cutoff = Date.parse(`${endDateYYYYMMDD}T00:00:00Z`);
  const byTeam = new Map();

  function ensure(id) {
    if (!byTeam.has(id)) byTeam.set(id, { played: 0, wins: 0, pf: 0, pa: 0 });
    return byTeam.get(id);
  }

  for (const g of history) {
    if (g.homeScore == null || g.awayScore == null) continue;
    const t = g.date ? Date.parse(g.date) : null;
    if (!t || t >= cutoff) continue;

    const h = ensure(g.homeTeamId);
    const a = ensure(g.awayTeamId);

    h.played++; a.played++;
    h.pf += g.homeScore; h.pa += g.awayScore;
    a.pf += g.awayScore; a.pa += g.homeScore;

    if (g.homeScore > g.awayScore) h.wins++;
    else if (g.awayScore > g.homeScore) a.wins++;
  }

  const out = new Map();
  for (const [id, s] of byTeam.entries()) {
    if (s.played === 0) out.set(id, { ok: false });
    else out.set(id, { ok: true, winPct: s.wins / s.played, marginPerGame: (s.pf - s.pa) / s.played });
  }
  return out;
}

function ncaamEdge(home, away, neutralSite) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = 0.65;
  const wMargin = 0.35;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clamp((home.marginPerGame - away.marginPerGame) / 14, -1, 1);

  const homeAdv = neutralSite ? 0 : 0.02;
  return wWin * winDiff + wMargin * marginScaled + homeAdv;
}

async function buildNcaamPredictions(dateYYYYMMDD, windowDays) {
  const historyDays = clamp(Number(windowDays) || 60, 14, 90);

  const slate = await getNcaamSlate(dateYYYYMMDD);
  if (!slate.length) {
    return {
      meta: { league: "ncaam", date: dateYYYYMMDD, windowDays: historyDays, model: "NCAAM blended-v1", note: "No NCAAM games scheduled." },
      predictions: [],
    };
  }

  const history = await getNcaamHistory(dateYYYYMMDD, historyDays);
  const teamStats = buildNcaamTeamStatsFromHistory(history, dateYYYYMMDD);

  const predictions = [];
  let noPickCount = 0;

  for (const g of slate) {
    const homeS = teamStats.get(g.homeTeamId) || { ok: false };
    const awayS = teamStats.get(g.awayTeamId) || { ok: false };

    const edge = ncaamEdge(homeS, awayS, g.neutralSite);
    const pick = pickFromEdge(edge, 0.09);
    const conf = confidenceFromEdge(edge, 0.22);

    const homeObj = { id: toNcaamTeamId(g.homeTeamId), name: g.homeName || "" };
    const awayObj = { id: toNcaamTeamId(g.awayTeamId), name: g.awayName || "" };

    let winner = null;
    if (pick.side === "home") winner = homeObj;
    else if (pick.side === "away") winner = awayObj;
    else noPickCount++;

    predictions.push({
      gameId: `ncaam-${g.id}`,
      date: dateYYYYMMDD,
      status: g.status || "scheduled",
      home: homeObj,
      away: awayObj,
      prediction: {
        winnerTeamId: winner ? winner.id : null,
        winnerName: winner ? winner.name : "",
        confidence: winner ? conf : 0.5,
        factors: { windowDays: historyDays, edge, pickNote: pick.note, neutralSite: Boolean(g.neutralSite) },
      },
    });
  }

  return { meta: { league: "ncaam", date: dateYYYYMMDD, windowDays: historyDays, noPickCount, model: "NCAAM blended-v1" }, predictions };
}

/**
 * Routes
 */
router.get("/nba/predict", async (req, res) => {
  const date = readDateFromReq(req);
  // ✅ lower default to reduce paging volume + 429 risk
  const windowDays = readWindowFromReq(req, 14, 3, 30);
  try {
    res.json(await buildNbaPredictions(date, windowDays));
  } catch (e) {
    res.json({ meta: { league: "nba", date, windowDays, model: "NBA blended-v1", error: String(e?.message || e) }, predictions: [] });
  }
});

router.get("/nhl/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 60, 3, 120);
  try {
    res.json(await buildNhlPredictions(date, windowDays));
  } catch (e) {
    res.json({ meta: { league: "nhl", date, windowDays, model: "NHL blended-v1", error: String(e?.message || e) }, predictions: [] });
  }
});

router.get("/ncaam/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 45, 14, 90);
  try {
    res.json(await buildNcaamPredictions(date, windowDays));
  } catch (e) {
    res.json({ meta: { league: "ncaam", date, windowDays, model: "NCAAM blended-v1", error: String(e?.message || e) }, predictions: [] });
  }
});

// ✅ keep frontend compatibility
router.get("/predictions", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = readDateFromReq(req);

  try {
    if (league === "nba") {
      const windowDays = readWindowFromReq(req, 14, 3, 30);
      const out = await buildNbaPredictions(date, windowDays);
      return res.json({ league, date, count: out.predictions.length, ...out });
    }
    if (league === "nhl") {
      const windowDays = readWindowFromReq(req, 60, 3, 120);
      const out = await buildNhlPredictions(date, windowDays);
      return res.json({ league, date, count: out.predictions.length, ...out });
    }
    if (league === "ncaam") {
      const windowDays = readWindowFromReq(req, 45, 14, 90);
      const out = await buildNcaamPredictions(date, windowDays);
      return res.json({ league, date, count: out.predictions.length, ...out });
    }
    return res.status(400).json({ error: "Unsupported league. Use league=nba|nhl|ncaam", got: league });
  } catch (e) {
    return res.json({ league, date, error: String(e?.message || e), predictions: [] });
  }
});

export default router;
