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

// ✅ ESPN
const ESPN_SITE_V2 = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_NCAAM_PATH = "basketball/mens-college-basketball";

/**
 * Cache (TTL + in-flight de-dupe + simple pruning)
 */
const CACHE_TTL_MS = 60_000;
const HEAVY_CACHE_TTL_MS = 20 * 60_000;
const MAX_CACHE_KEYS = 800;

const cache = new Map();     // key -> { time, ttl, value }
const inFlight = new Map();  // key -> Promise

function pruneCacheIfNeeded() {
  if (cache.size <= MAX_CACHE_KEYS) return;
  // delete oldest ~10%
  const entries = [...cache.entries()].sort((a, b) => a[1].time - b[1].time);
  const removeN = Math.ceil(entries.length * 0.1);
  for (let i = 0; i < removeN; i++) cache.delete(entries[i][0]);
}

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
  pruneCacheIfNeeded();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms, pct = 0.2) {
  const j = ms * pct;
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * j));
}

function parseRetryAfterSeconds(res) {
  const ra = res?.headers?.get?.("retry-after");
  if (!ra) return null;
  const n = Number(ra);
  return Number.isFinite(n) ? n : null;
}

// Small per-host concurrency gate (prevents “imploding”)
const hostGates = new Map(); // host -> { active, queue: [] }
async function withHostGate(url, limit, fn) {
  const host = new URL(url).host;
  if (!hostGates.has(host)) hostGates.set(host, { active: 0, queue: [] });
  const gate = hostGates.get(host);

  if (gate.active >= limit) {
    await new Promise((resolve) => gate.queue.push(resolve));
  }

  gate.active++;
  try {
    return await fn();
  } finally {
    gate.active--;
    const next = gate.queue.shift();
    if (next) next();
  }
}

/**
 * fetchJson with:
 * - cache
 * - in-flight de-dupe
 * - retry/backoff on 429 / 5xx / transient network errors
 * - per-host concurrency caps
 */
async function fetchJson(
  url,
  { headers } = {},
  {
    cacheTtlMs = CACHE_TTL_MS,
    retries = 5,
    baseBackoffMs = 650,
    hostConcurrency = 2, // key: stops bursts; ESPN + balldontlie behave better
  } = {}
) {
  const auth = headers?.Authorization ? String(headers.Authorization) : "";
  const cacheKey = `GET:${url}:AUTH=${auth}`;

  const cached = getCache(cacheKey);
  if (cached) return cached;

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await withHostGate(url, hostConcurrency, async () => {
          return await fetch(url, { headers });
        });

        if (res.status === 429) {
          const retryAfter = parseRetryAfterSeconds(res);
          const text = await res.text().catch(() => "");
          const waitMs = retryAfter != null
            ? retryAfter * 1000
            : jitter(baseBackoffMs * Math.pow(2, attempt), 0.25);

          if (attempt >= retries) {
            throw new Error(
              `Upstream 429 for ${url}${text ? ` — ${text}` : ""} — exceeded retry limit`
            );
          }
          await sleep(waitMs);
          continue;
        }

        // Retry on transient upstream failures
        if (res.status >= 500 && res.status <= 599) {
          const text = await res.text().catch(() => "");
          const waitMs = jitter(baseBackoffMs * Math.pow(2, attempt), 0.25);
          if (attempt >= retries) {
            throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
          }
          await sleep(waitMs);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
        }

        const data = await res.json();
        setCache(cacheKey, data, cacheTtlMs);
        return data;
      } catch (e) {
        const msg = String(e?.message || e);
        // Retry transient network errors
        const isTransient =
          msg.includes("fetch failed") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EAI_AGAIN");

        if (!isTransient || attempt >= retries) throw e;
        await sleep(jitter(baseBackoffMs * Math.pow(2, attempt), 0.25));
      }
    }
    throw new Error(`Upstream failure for ${url}`);
  })();

  inFlight.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inFlight.delete(cacheKey);
  }
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
function readModeFromReq(req) {
  const mode = String(req.query.mode || "").toLowerCase();
  const t = String(req.query.tournament || "").toLowerCase();
  const isTournament = mode === "tournament" || t === "1" || t === "true" || t === "yes";
  return { mode: isTournament ? "tournament" : "regular", tournament: isTournament };
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
 * Premium decision helpers
 * edge is signed where + means home lean.
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
function tierFromEdge(edgeAbs, { pass, lean, edge } = {}) {
  const PASS = pass ?? 0.00; // not used directly
  const LEAN = lean ?? 0.07;
  const EDGE = edge ?? 0.11;

  if (!Number.isFinite(edgeAbs)) return "PASS";
  if (edgeAbs < LEAN) return "PASS";
  if (edgeAbs < EDGE) return "LEAN";
  if (edgeAbs < EDGE * 1.45) return "EDGE";
  return "STRONG";
}

/**
 * Why builder (structured)
 */
function buildWhyPanel({ pickSide, pickNote, edge, conf, deltas = [] }) {
  const bullets = [];

  if (!pickSide) {
    bullets.push(pickNote === "pass_toss_up" ? "Pass: edge not strong enough (toss-up)." : "Pass: insufficient signal.");
    if (Number.isFinite(edge)) bullets.push(`Edge: ${edge.toFixed(3)} (below threshold).`);
    return {
      headline: "PASS (no bet)",
      bullets: bullets.slice(0, 5),
      deltas: [],
    };
  }

  bullets.push(`Pick: ${pickSide.toUpperCase()} (edge ${Number.isFinite(edge) ? edge.toFixed(3) : "—"})`);
  if (Number.isFinite(conf)) bullets.push(`Confidence proxy: ${Math.round(conf * 100)}% (not a bar metric)`);

  const outDeltas = [];
  for (const d of deltas) {
    if (!d || !d.label) continue;
    if (!Number.isFinite(d.delta)) continue;
    const sign = d.delta > 0 ? "+" : "";
    const dp = d.dp ?? 3;
    const suffix = d.suffix ?? "";
    outDeltas.push({
      label: d.label,
      value: d.delta,
      display: `${sign}${d.delta.toFixed(dp)}${suffix}`,
    });
  }

  // keep bullets tight
  for (const dd of outDeltas.slice(0, 3)) {
    bullets.push(`${dd.label}: ${dd.display}`);
  }

  return {
    headline: pickSide === "home" ? "Home side value" : "Away side value",
    bullets: bullets.slice(0, 6),
    deltas: outDeltas.slice(0, 6),
  };
}

/**
 * Unified game response builder
 */
function toUnifiedGame({
  league,
  gameId,
  date,
  status,
  home,
  away,
  pickSide,
  pickNote,
  edge,
  conf,
  tier,
  whyPanel,
  factors,
}) {
  const recommended =
    pickSide === "home" ? home : pickSide === "away" ? away : null;

  return {
    gameId,
    date,
    status,
    home,
    away,

    market: {
      pick: pickSide,
      recommendedTeamId: recommended ? recommended.id : null,
      recommendedTeamName: recommended ? (recommended.name || "") : "",
      edge: Number.isFinite(edge) ? edge : null,
      tier,
      confidence: recommended ? conf : 0.5,
    },

    why: whyPanel,

    factors: {
      league,
      ...factors,
    },
  };
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
   NBA — premium blended model
   ========================================================= */

async function getNbaGamesByDate(dateYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY (set in apps/api/.env)");
  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(dateYYYYMMDD)}`;
  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } }, { cacheTtlMs: CACHE_TTL_MS, hostConcurrency: 2 });
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

async function getNbaGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const cacheKey = `NBA_DATES_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  // inclusive
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
    const json = await fetchJson(
      url,
      { headers: { Authorization: NBA_API_KEY } },
      { cacheTtlMs: HEAVY_CACHE_TTL_MS, retries: 6, baseBackoffMs: 700, hostConcurrency: 2 }
    );

    const rows = json?.data || [];
    all.push(...rows);

    // Pagination safety per chunk
    let page = 2;
    while (rows.length === 100) {
      await sleep(450);
      const pagedUrl = `${NBA_API_BASE}/games?per_page=100&page=${page}&${qs}`;
      const j2 = await fetchJson(
        pagedUrl,
        { headers: { Authorization: NBA_API_KEY } },
        { cacheTtlMs: HEAVY_CACHE_TTL_MS, retries: 6, baseBackoffMs: 700, hostConcurrency: 2 }
      );
      const r2 = j2?.data || [];
      if (!r2.length) break;
      all.push(...r2);
      if (r2.length < 100) break;
      page++;
    }

    await sleep(450);
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
    return { meta: { league: "nba", date: dateYYYYMMDD, windowDays, model: "NBA premium-v3", mode: "regular", note: "No NBA games scheduled." }, games: [] };
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

  const games = [];
  let noPickCount = 0;

  const MIN_EDGE_FOR_PICK = 0.075;

  for (const g of schedule) {
    const homeS = teamStats.get(g.home.id) || { ok: false };
    const awayS = teamStats.get(g.away.id) || { ok: false };

    const edge = nbaEdge(homeS, awayS);
    const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
    const conf = confidenceFromEdge(edge, 0.17, 0.53, 0.94);

    if (!pick.side) noPickCount++;

    const deltas = [
      { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
      { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
      { label: "Recent10 win% diff", delta: (homeS.recent10?.winPct ?? 0.5) - (awayS.recent10?.winPct ?? 0.5), dp: 3 },
      { label: "Recent5 margin diff", delta: (homeS.recent5?.margin ?? 0) - (awayS.recent5?.margin ?? 0), dp: 2, suffix: " pts/g" },
    ];

    const whyPanel = buildWhyPanel({ pickSide: pick.side, pickNote: pick.note, edge, conf, deltas });
    const tier = pick.side ? tierFromEdge(Math.abs(edge), { lean: 0.075, edge: 0.11 }) : "PASS";

    games.push(
      toUnifiedGame({
        league: "nba",
        gameId: g.gameId,
        date: dateYYYYMMDD,
        status: g.status,
        home: g.home,
        away: g.away,
        pickSide: pick.side,
        pickNote: pick.note,
        edge,
        conf,
        tier,
        whyPanel,
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
      })
    );
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
      model: "NBA premium-v3",
      mode: "regular",
      warnings: [],
    },
    games,
  };
}

/* =========================================================
   NHL — paused
   ========================================================= */

async function buildNhlPredictions(dateYYYYMMDD, windowDays) {
  return {
    meta: {
      league: "nhl",
      date: dateYYYYMMDD,
      windowDays,
      model: "NHL paused-v1",
      mode: "regular",
      note: "NHL paused (Olympics) — no games scheduled.",
      warnings: [],
    },
    games: [],
  };
}

/* =========================================================
   NCAAM — ESPN scoreboard history loop + tournament mode
   ========================================================= */

// ESPN logo CDN fallback for NCAAM
function espnNcaamLogoFromTeamId(teamId) {
  const id = String(teamId || "").trim();
  if (!id) return null;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
}

function normalizeEspnEventToGame(event) {
  const comp = event?.competitions?.[0];
  const competitors = comp?.competitors;
  if (!Array.isArray(competitors)) return null;

  const home = competitors.find((c) => c?.homeAway === "home") ?? null;
  const away = competitors.find((c) => c?.homeAway === "away") ?? null;

  const homeTeam = home?.team || null;
  const awayTeam = away?.team || null;

  const homeId = homeTeam?.id ? String(homeTeam.id) : null;
  const awayId = awayTeam?.id ? String(awayTeam.id) : null;

  const pickLogo = (team) => {
    if (!team) return null;
    const fromArr = Array.isArray(team.logos) ? team.logos[0]?.href : null;
    const fromSingle = team.logo || null;
    return fromArr || fromSingle || espnNcaamLogoFromTeamId(team.id);
  };

  const homeName = homeTeam?.displayName || homeTeam?.shortDisplayName || "";
  const awayName = awayTeam?.displayName || awayTeam?.shortDisplayName || "";

  const homeAbbr = homeTeam?.abbreviation || "";
  const awayAbbr = awayTeam?.abbreviation || "";

  return {
    id: String(event?.id ?? `${homeId}-${awayId}-${event?.date ?? ""}`),
    date: event?.date ?? null,

    homeTeamId: homeId,
    awayTeamId: awayId,

    homeScore: safeNum(home?.score),
    awayScore: safeNum(away?.score),

    homeName,
    awayName,

    homeAbbr,
    awayAbbr,

    homeLogo: pickLogo(homeTeam),
    awayLogo: pickLogo(awayTeam),

    neutralSite: Boolean(comp?.neutralSite),
    status: event?.status?.type?.state || "scheduled",
  };
}

async function getNcaamScoreboardByDate(dateYYYYMMDD) {
  const ymd = toEspnYYYYMMDD(dateYYYYMMDD);
  const url = `${ESPN_SITE_V2}/${ESPN_NCAAM_PATH}/scoreboard?dates=${encodeURIComponent(ymd)}`;
  const json = await fetchJson(url, {}, { cacheTtlMs: HEAVY_CACHE_TTL_MS, retries: 5, baseBackoffMs: 650, hostConcurrency: 3 });
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
    await sleep(45); // small pacing, plus concurrency gate
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

function ncaamEdge(home, away, neutralSite, tournamentMode) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = tournamentMode ? 0.46 : 0.50;
  const wMargin = tournamentMode ? 0.34 : 0.30;
  const wRecent = 0.20;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clamp((home.marginPerGame - away.marginPerGame) / 14, -1, 1);

  const recentDiff =
    (Number.isFinite(home.recentWinPct) ? home.recentWinPct : 0.5) -
    (Number.isFinite(away.recentWinPct) ? away.recentWinPct : 0.5);

  // Tournament mode: neutral-court assumption + remove home bump
  const homeAdv = (neutralSite || tournamentMode) ? 0 : 0.018;

  return wWin * winDiff + wMargin * marginScaled + wRecent * recentDiff + homeAdv;
}

async function buildNcaamPredictions(dateYYYYMMDD, windowDays, { tournamentMode, modeLabel }) {
  const historyDays = clamp(Number(windowDays) || 45, 14, 90);

  const slate = await getNcaamSlate(dateYYYYMMDD);
  if (!slate.length) {
    return { meta: { league: "ncaam", date: dateYYYYMMDD, windowDays: historyDays, model: "NCAAM premium-v3", mode: modeLabel, note: "No NCAAM games scheduled.", warnings: [] }, games: [] };
  }

  const history = await getNcaamHistory(dateYYYYMMDD, historyDays);
  const teamStats = buildNcaamTeamStatsFromHistory(history, dateYYYYMMDD, 10);

  const games = [];
  let noPickCount = 0;

  // Tournament mode: higher upset sensitivity → slightly lower threshold,
  // and a touch more willingness when picking the “stat underdog”
  const BASE_MIN_EDGE = 0.095;
  const MIN_EDGE_FOR_PICK = tournamentMode ? 0.075 : BASE_MIN_EDGE;

  for (const g of slate) {
    const homeS = teamStats.get(g.homeTeamId) || { ok: false };
    const awayS = teamStats.get(g.awayTeamId) || { ok: false };

    // Tournament mode: treat as neutral even if ESPN doesn’t mark it (common in bracket games)
    const neutral = Boolean(g.neutralSite) || Boolean(tournamentMode);

    let edge = ncaamEdge(homeS, awayS, neutral, tournamentMode);

    // Upset sensitivity: if the “recommended” side would be the underdog by win%,
    // reduce effective pass threshold a bit by scaling edge up slightly.
    // (No odds/seeds available → win% proxy)
    const homeUnderdog = (homeS.winPct ?? 0.5) < (awayS.winPct ?? 0.5);
    const awayUnderdog = (awayS.winPct ?? 0.5) < (homeS.winPct ?? 0.5);

    const tentativePick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
    if (tournamentMode && tentativePick.side) {
      const pickedUnderdog = (tentativePick.side === "home" && homeUnderdog) || (tentativePick.side === "away" && awayUnderdog);
      if (pickedUnderdog) edge = edge * 1.08; // small, controlled “upset nudge”
    }

    const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
    const conf = confidenceFromEdge(edge, tournamentMode ? 0.24 : 0.22, 0.53, 0.92);

    const homeObj = {
      id: toNcaamTeamId(g.homeTeamId),
      name: g.homeName || "",
      abbr: g.homeAbbr || "",
      logo: g.homeLogo || espnNcaamLogoFromTeamId(g.homeTeamId),
    };

    const awayObj = {
      id: toNcaamTeamId(g.awayTeamId),
      name: g.awayName || "",
      abbr: g.awayAbbr || "",
      logo: g.awayLogo || espnNcaamLogoFromTeamId(g.awayTeamId),
    };

    if (!pick.side) noPickCount++;

    const deltas = [
      { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
      { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
      { label: "Recent win% diff", delta: (homeS.recentWinPct ?? 0.5) - (awayS.recentWinPct ?? 0.5), dp: 3 },
      { label: "Neutral court", delta: neutral ? 1 : 0, dp: 0, suffix: neutral ? " (yes)" : " (no)" },
    ];

    const whyPanel = buildWhyPanel({ pickSide: pick.side, pickNote: pick.note, edge, conf, deltas });
    const tier = pick.side ? tierFromEdge(Math.abs(edge), { lean: MIN_EDGE_FOR_PICK, edge: tournamentMode ? 0.105 : 0.11 }) : "PASS";

    games.push(
      toUnifiedGame({
        league: "ncaam",
        gameId: `ncaam-${g.id}`,
        date: dateYYYYMMDD,
        status: g.status || "scheduled",
        home: homeObj,
        away: awayObj,
        pickSide: pick.side,
        pickNote: pick.note,
        edge,
        conf,
        tier,
        whyPanel,
        factors: {
          windowDays: historyDays,
          edge,
          pickNote: pick.note,
          neutralSite: neutral,
          tournamentMode: Boolean(tournamentMode),
          homeWinPct: homeS.winPct ?? null,
          awayWinPct: awayS.winPct ?? null,
          homeMarginPerGame: homeS.marginPerGame ?? null,
          awayMarginPerGame: awayS.marginPerGame ?? null,
          homeRecentWinPct: homeS.recentWinPct ?? null,
          awayRecentWinPct: awayS.recentWinPct ?? null,
          note: tournamentMode
            ? "Tournament mode: neutral court assumption + higher upset sensitivity + PASS discipline."
            : "Premium blend (conservative): win% + margin + recent 10 + small home adv. PASS discipline enabled.",
        },
      })
    );
  }

  return {
    meta: {
      league: "ncaam",
      date: dateYYYYMMDD,
      windowDays: historyDays,
      historyGamesFetched: history.length,
      noPickCount,
      model: "NCAAM premium-v3",
      mode: modeLabel,
      warnings: [],
    },
    games,
  };
}

/**
 * Backward compat adaptor: expose `predictions` the same as `games`
 */
function addPredictionsAlias(out) {
  return { ...out, predictions: out.games };
}

/**
 * Routes
 */
router.get("/nba/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 14, 3, 30);

  try {
    res.json(addPredictionsAlias(await buildNbaPredictions(date, windowDays)));
  } catch (e) {
    res.json(
      addPredictionsAlias({
        meta: { league: "nba", date, windowDays, model: "NBA premium-v3", mode: "regular", error: String(e?.message || e), warnings: [] },
        games: [],
      })
    );
  }
});

router.get("/nhl/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 60, 3, 120);

  try {
    res.json(addPredictionsAlias(await buildNhlPredictions(date, windowDays)));
  } catch (e) {
    res.json(
      addPredictionsAlias({
        meta: { league: "nhl", date, windowDays, model: "NHL paused-v1", mode: "regular", error: String(e?.message || e), warnings: [] },
        games: [],
      })
    );
  }
});

router.get("/ncaam/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 45, 14, 90);
  const { tournament, mode } = readModeFromReq(req);

  try {
    res.json(addPredictionsAlias(await buildNcaamPredictions(date, windowDays, { tournamentMode: tournament, modeLabel: mode })));
  } catch (e) {
    res.json(
      addPredictionsAlias({
        meta: { league: "ncaam", date, windowDays, model: "NCAAM premium-v3", mode, error: String(e?.message || e), warnings: [] },
        games: [],
      })
    );
  }
});

// ✅ keep frontend compatibility
router.get("/predictions", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = readDateFromReq(req);
  const { tournament, mode } = readModeFromReq(req);

  try {
    if (league === "nba") {
      const windowDays = readWindowFromReq(req, 14, 3, 30);
      const out = await buildNbaPredictions(date, windowDays);
      return res.json({ league, date, count: out.games.length, ...addPredictionsAlias(out) });
    }
    if (league === "nhl") {
      const windowDays = readWindowFromReq(req, 60, 3, 120);
      const out = await buildNhlPredictions(date, windowDays);
      return res.json({ league, date, count: out.games.length, ...addPredictionsAlias(out) });
    }
    if (league === "ncaam") {
      const windowDays = readWindowFromReq(req, 45, 14, 90);
      const out = await buildNcaamPredictions(date, windowDays, { tournamentMode: tournament, modeLabel: mode });
      return res.json({ league, date, count: out.games.length, ...addPredictionsAlias(out) });
    }
    return res.status(400).json({ error: "Unsupported league. Use league=nba|nhl|ncaam", got: league });
  } catch (e) {
    return res.json({ league, date, mode, error: String(e?.message || e), games: [], predictions: [] });
  }
});

export default router;
