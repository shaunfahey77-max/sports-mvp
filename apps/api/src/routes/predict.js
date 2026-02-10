// apps/api/src/routes/predict.js
import "dotenv/config";
import express from "express";

const router = express.Router();

/**
 * Upstreams
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";

const NHL_API_BASE = "https://api-web.nhle.com/v1"; // kept for later, but NHL is paused right now

// ✅ Most reliable ESPN scoreboard host for single-day
const ESPN_SITE_V2 = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_NCAAM_PATH = "basketball/mens-college-basketball";

/**
 * Cache
 */
const CACHE_TTL_MS = 60_000;
const HEAVY_CACHE_TTL_MS = 20 * 60_000;
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
 * Premium decision helpers (NO default-home, PASS discipline)
 * edge is a signed value where + means home lean.
 */
function confidenceFromEdge(edge, edgeScale, capLo = 0.52, capHi = 0.95) {
  if (!Number.isFinite(edge)) return 0.5;
  const p = 1 / (1 + Math.exp(-edge / edgeScale));
  return clamp(p, capLo, capHi);
}
function pickFromEdge(edge, minEdgeForPick) {
  if (!Number.isFinite(edge)) return { side: null, note: "invalid_edge" };
  if (Math.abs(edge) < minEdgeForPick) return { side: null, note: "pass_toss_up" };
  return { side: edge > 0 ? "home" : "away", note: "ok" };
}

/**
 * Why builder (consistent across leagues)
 */
function buildWhy({ pickSide, pickNote, edge, conf, deltas = [] }) {
  const why = [];

  if (!pickSide) {
    why.push(pickNote === "pass_toss_up" ? "Pass: edge not strong enough (toss-up)." : "Pass: insufficient signal.");
    if (Number.isFinite(edge)) why.push(`Edge score: ${edge.toFixed(3)} (below threshold).`);
    return why;
  }

  why.push(`Pick: ${pickSide.toUpperCase()} (edge ${Number.isFinite(edge) ? edge.toFixed(3) : "—"})`);
  if (Number.isFinite(conf)) why.push(`Model confidence: ${Math.round(conf * 100)}%`);

  for (const d of deltas) {
    if (!d || !d.label) continue;
    if (!Number.isFinite(d.delta)) continue;
    const sign = d.delta > 0 ? "+" : "";
    why.push(`${d.label}: ${sign}${d.delta.toFixed(d.dp ?? 3)}${d.suffix ?? ""}`);
  }

  return why.slice(0, 6);
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
   NBA — premium blended model (win% + margin + recent form + small home adv)
   Rate-limit safe: delay + retry + heavy cache
   ========================================================= */

async function getNbaGamesByDate(dateYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY (set in apps/api/.env)");
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

// slow paging + multi retry on 429
const NBA_PAGE_DELAY_MS = 750;
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
      const backoff = 600 * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }
  throw new Error(`Upstream 429 for ${url} — exceeded retry limit`);
}

async function getNbaGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const cacheKey = `NBA_DATES_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  // Build list of dates inclusive
  const dates = [];
  let cur = startYYYYMMDD;
  while (cur <= endYYYYMMDD) {
    dates.push(cur);
    cur = addDaysUTC(cur, 1);
  }

  const CHUNK = 7; // days per request
  const all = [];

  for (let i = 0; i < dates.length; i += CHUNK) {
    const chunk = dates.slice(i, i + CHUNK);
    const qs = chunk.map((d) => `dates[]=${encodeURIComponent(d)}`).join("&");

    const url = `${NBA_API_BASE}/games?per_page=100&${qs}`;
    const json = await fetchNbaPage(url);
    const rows = json?.data || [];
    all.push(...rows);

    // Safety pagination per chunk only
    let page = 2;
    while (rows.length === 100) {
      await sleep(NBA_PAGE_DELAY_MS);
      const pagedUrl = `${NBA_API_BASE}/games?per_page=100&page=${page}&${qs}`;
      const j2 = await fetchNbaPage(pagedUrl);
      const r2 = j2?.data || [];
      if (!r2.length) break;
      all.push(...r2);
      if (r2.length < 100) break;
      page++;
    }

    await sleep(NBA_PAGE_DELAY_MS);
  }

  setCache(cacheKey, all, HEAVY_CACHE_TTL_MS);
  return all;
}

function buildTeamStatsFromHistory_Generic(histRows, { recent5 = 5, recent10 = 10, scoreFn }) {
  const byTeamGames = new Map();
  function add(teamId, game) {
    if (!byTeamGames.has(teamId)) byTeamGames.set(teamId, []);
    byTeamGames.get(teamId).push(game);
  }

  for (const g of histRows) {
    const parsed = scoreFn(g);
    if (!parsed) continue;

    const { date, homeId, awayId, homeScore, awayScore } = parsed;
    if (!homeId || !awayId) continue;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    if (homeScore === 0 && awayScore === 0) continue;

    add(homeId, { date, my: homeScore, opp: awayScore });
    add(awayId, { date, my: awayScore, opp: homeScore });
  }

  const out = new Map();
  for (const [teamId, games] of byTeamGames.entries()) {
    games.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const played = games.length;
    if (!played) {
      out.set(teamId, { ok: false });
      continue;
    }

    let wins = 0, pf = 0, pa = 0;
    for (const g of games) {
      pf += g.my;
      pa += g.opp;
      if (g.my > g.opp) wins++;
    }

    const recentN = (n) => {
      const slice = games.slice(0, n);
      if (!slice.length) return { played: 0, winPct: null, margin: null };
      let w = 0, mp = 0;
      for (const gg of slice) {
        if (gg.my > gg.opp) w++;
        mp += gg.my - gg.opp;
      }
      return { played: slice.length, winPct: w / slice.length, margin: mp / slice.length };
    };

    out.set(teamId, {
      ok: true,
      played,
      winPct: wins / played,
      marginPerGame: (pf - pa) / played,
      recent5: recentN(recent5),
      recent10: recentN(recent10),
    });
  }

  return out;
}

function nbaEdge(home, away) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = 0.42;
  const wMargin = 0.28;
  const wR10 = 0.18;
  const wR5 = 0.12;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clamp((home.marginPerGame - away.marginPerGame) / 12, -1, 1);
  const r10Diff = (safeNum(home.recent10?.winPct) ?? 0.5) - (safeNum(away.recent10?.winPct) ?? 0.5);
  const r5MarginScaled = clamp(
    ((safeNum(home.recent5?.margin) ?? 0) - (safeNum(away.recent5?.margin) ?? 0)) / 14,
    -1,
    1
  );

  const homeAdv = 0.018;
  return wWin * winDiff + wMargin * marginScaled + wR10 * r10Diff + wR5 * r5MarginScaled + homeAdv;
}

async function buildNbaPredictions(dateYYYYMMDD, windowDays) {
  const schedule = await getNbaGamesByDate(dateYYYYMMDD);
  if (!schedule.length) {
    return {
      meta: { league: "nba", date: dateYYYYMMDD, windowDays, model: "NBA premium-v2", note: "No NBA games scheduled." },
      predictions: [],
    };
  }

  const end = addDaysUTC(dateYYYYMMDD, -1);
  const start = addDaysUTC(end, -(windowDays - 1));

  const histRows = await getNbaGamesInRange(start, end);

  const teamStats = buildTeamStatsFromHistory_Generic(histRows, {
    recent5: 5,
    recent10: 10,
    scoreFn: (g) => {
      const hs = g?.home_team_score;
      const as = g?.visitor_team_score;
      if (typeof hs !== "number" || typeof as !== "number") return null;
      const homeAbbr = g?.home_team?.abbreviation;
      const awayAbbr = g?.visitor_team?.abbreviation;
      if (!homeAbbr || !awayAbbr) return null;
      return {
        date: String(g?.date || "").slice(0, 10),
        homeId: toNbaTeamId(homeAbbr),
        awayId: toNbaTeamId(awayAbbr),
        homeScore: hs,
        awayScore: as,
      };
    },
  });

  const predictions = [];
  let noPickCount = 0;

  const MIN_EDGE_FOR_PICK = 0.075;

  for (const g of schedule) {
    const homeS = teamStats.get(g.home.id) || { ok: false };
    const awayS = teamStats.get(g.away.id) || { ok: false };

    const edge = nbaEdge(homeS, awayS);
    const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
    const conf = confidenceFromEdge(edge, 0.17, 0.53, 0.94);

    let winner = null;
    if (pick.side === "home") winner = g.home;
    else if (pick.side === "away") winner = g.away;
    else noPickCount++;

    const deltas = [
      { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
      { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
      { label: "Recent10 win% diff", delta: (homeS.recent10?.winPct ?? 0.5) - (awayS.recent10?.winPct ?? 0.5), dp: 3 },
      { label: "Recent5 margin diff", delta: (homeS.recent5?.margin ?? 0) - (awayS.recent5?.margin ?? 0), dp: 2, suffix: " pts/g" },
    ];

    const why = buildWhy({ pickSide: pick.side, pickNote: pick.note, edge, conf, deltas });

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
        why,
        factors: {
          windowDays,
          edge,
          pickNote: pick.note,
          homeWinPct: homeS.winPct ?? null,
          awayWinPct: awayS.winPct ?? null,
          homeMarginPerGame: homeS.marginPerGame ?? null,
          awayMarginPerGame: awayS.marginPerGame ?? null,
          homeRecent10WinPct: homeS.recent10?.winPct ?? null,
          awayRecent10WinPct: awayS.recent10?.winPct ?? null,
          homeRecent5Margin: homeS.recent5?.margin ?? null,
          awayRecent5Margin: awayS.recent5?.margin ?? null,
          note: "Premium blend: win% + margin + recent 10 + recent 5 margin + small home adv. PASS discipline enabled.",
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
      model: "NBA premium-v2",
    },
    predictions,
  };
}

/* =========================================================
   NHL — Olympics pause (explicit + deterministic)
   ========================================================= */

async function buildNhlPredictions(dateYYYYMMDD, windowDays) {
  return {
    meta: {
      league: "nhl",
      date: dateYYYYMMDD,
      windowDays,
      model: "NHL paused-v1",
      note: "NHL paused (Olympics) — no games scheduled.",
    },
    predictions: [],
  };
}

/* =========================================================
   NCAAM — premium blended model using ESPN scoreboard history loop
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

async function getNcaamHistory(endDateYYYYMMDD, historyDays) {
  const out = [];
  for (let i = historyDays; i >= 1; i--) {
    const d = addDaysUTC(endDateYYYYMMDD, -i);
    const dayRows = await getNcaamScoreboardByDate(d);
    out.push(...dayRows);
    await sleep(60);
  }
  return out.filter((g) => g.homeTeamId && g.awayTeamId);
}

function buildNcaamTeamStatsFromHistory(history, endDateYYYYMMDD, recentN = 10) {
  const cutoff = Date.parse(`${endDateYYYYMMDD}T00:00:00Z`);
  const byTeamGames = new Map();

  function add(teamId, game) {
    if (!byTeamGames.has(teamId)) byTeamGames.set(teamId, []);
    byTeamGames.get(teamId).push(game);
  }

  for (const g of history) {
    if (g.homeScore == null || g.awayScore == null) continue;
    const t = g.date ? Date.parse(g.date) : null;
    if (!t || t >= cutoff) continue;

    add(g.homeTeamId, { date: g.date?.slice(0, 10) || "", my: g.homeScore, opp: g.awayScore });
    add(g.awayTeamId, { date: g.date?.slice(0, 10) || "", my: g.awayScore, opp: g.homeScore });
  }

  const out = new Map();
  for (const [id, games] of byTeamGames.entries()) {
    games.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const played = games.length;
    if (!played) {
      out.set(id, { ok: false });
      continue;
    }

    let wins = 0, pf = 0, pa = 0;
    for (const g of games) {
      pf += g.my;
      pa += g.opp;
      if (g.my > g.opp) wins++;
    }

    const recent = games.slice(0, recentN);
    let rWins = 0, rMargin = 0;
    for (const g of recent) {
      if (g.my > g.opp) rWins++;
      rMargin += g.my - g.opp;
    }

    out.set(id, {
      ok: true,
      played,
      winPct: wins / played,
      marginPerGame: (pf - pa) / played,
      recentWinPct: recent.length ? rWins / recent.length : null,
      recentMargin: recent.length ? rMargin / recent.length : null,
    });
  }

  return out;
}

function ncaamEdge(home, away, neutralSite) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = 0.50;
  const wMargin = 0.30;
  const wRecent = 0.20;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clamp((home.marginPerGame - away.marginPerGame) / 14, -1, 1);

  const recentDiff =
    (Number.isFinite(home.recentWinPct) ? home.recentWinPct : 0.5) -
    (Number.isFinite(away.recentWinPct) ? away.recentWinPct : 0.5);

  const homeAdv = neutralSite ? 0 : 0.018;
  return wWin * winDiff + wMargin * marginScaled + wRecent * recentDiff + homeAdv;
}

async function buildNcaamPredictions(dateYYYYMMDD, windowDays) {
  const historyDays = clamp(Number(windowDays) || 45, 14, 90);

  const slate = await getNcaamSlate(dateYYYYMMDD);
  if (!slate.length) {
    return {
      meta: { league: "ncaam", date: dateYYYYMMDD, windowDays: historyDays, model: "NCAAM premium-v2", note: "No NCAAM games scheduled." },
      predictions: [],
    };
  }

  const history = await getNcaamHistory(dateYYYYMMDD, historyDays);
  const teamStats = buildNcaamTeamStatsFromHistory(history, dateYYYYMMDD, 10);

  const predictions = [];
  let noPickCount = 0;

  const MIN_EDGE_FOR_PICK = 0.095;

  for (const g of slate) {
    const homeS = teamStats.get(g.homeTeamId) || { ok: false };
    const awayS = teamStats.get(g.awayTeamId) || { ok: false };

    const edge = ncaamEdge(homeS, awayS, g.neutralSite);
    const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
    const conf = confidenceFromEdge(edge, 0.22, 0.53, 0.92);

    const homeObj = { id: toNcaamTeamId(g.homeTeamId), name: g.homeName || "" };
    const awayObj = { id: toNcaamTeamId(g.awayTeamId), name: g.awayName || "" };

    let winner = null;
    if (pick.side === "home") winner = homeObj;
    else if (pick.side === "away") winner = awayObj;
    else noPickCount++;

    const deltas = [
      { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
      { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
      { label: "Recent win% diff", delta: (homeS.recentWinPct ?? 0.5) - (awayS.recentWinPct ?? 0.5), dp: 3 },
    ];

    const why = buildWhy({ pickSide: pick.side, pickNote: pick.note, edge, conf, deltas });

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
        why,
        factors: {
          windowDays: historyDays,
          edge,
          pickNote: pick.note,
          neutralSite: Boolean(g.neutralSite),
          homeWinPct: homeS.winPct ?? null,
          awayWinPct: awayS.winPct ?? null,
          homeMarginPerGame: homeS.marginPerGame ?? null,
          awayMarginPerGame: awayS.marginPerGame ?? null,
          homeRecentWinPct: homeS.recentWinPct ?? null,
          awayRecentWinPct: awayS.recentWinPct ?? null,
          note: "Premium blend (conservative): win% + margin + recent 10 + small home adv. PASS discipline enabled.",
        },
      },
    });
  }

  return {
    meta: { league: "ncaam", date: dateYYYYMMDD, windowDays: historyDays, noPickCount, model: "NCAAM premium-v2" },
    predictions,
  };
}

/**
 * Routes
 */
router.get("/nba/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 14, 3, 30);

  try {
    res.json(await buildNbaPredictions(date, windowDays));
  } catch (e) {
    res.json({
      meta: { league: "nba", date, windowDays, model: "NBA premium-v2", error: String(e?.message || e) },
      predictions: [],
    });
  }
});

router.get("/nhl/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 60, 3, 120);

  try {
    res.json(await buildNhlPredictions(date, windowDays));
  } catch (e) {
    res.json({
      meta: { league: "nhl", date, windowDays, model: "NHL paused-v1", error: String(e?.message || e) },
      predictions: [],
    });
  }
});

router.get("/ncaam/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 45, 14, 90);

  try {
    res.json(await buildNcaamPredictions(date, windowDays));
  } catch (e) {
    res.json({
      meta: { league: "ncaam", date, windowDays, model: "NCAAM premium-v2", error: String(e?.message || e) },
      predictions: [],
    });
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
