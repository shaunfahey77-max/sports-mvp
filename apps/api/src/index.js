// apps/api/src/index.js
import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url) });

import express from "express";
import cors from "cors";

import adminPerformanceRouter from "./routes/adminPerformance.js";
import predictRouter from "./routes/predict.js";
import performanceRoutes from "./routes/performance.js";
import upsetsRouter from "./routes/upsets.js"; // ✅ Upsets router
import scoreRouter from "./routes/score.js"; // ✅ expose /api/score/* (ping/debug)

// ✅ Cron job starter
import { startDailyScoreJob } from "./cron/dailyScore.js";

/**
 * Optional: Premium NBA router
 * - Do NOT crash if file doesn't exist
 */
let nbaPremiumRouter = null;
try {
  const mod = await import("./routes/nbaPremium.js");
  nbaPremiumRouter = mod?.default || null;
} catch {
  // file missing or import failed — safely ignore
}

const app = express();
const PORT = Number(process.env.PORT || 3001);

// ✅ allow disabling cron (useful for local dev / certain deploys)
const ENABLE_CRON = String(process.env.ENABLE_CRON || "true").toLowerCase() !== "false";

// ✅ optional guard for admin endpoints (recommended for any non-local deploy)
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const isLocal = process.env.NODE_ENV !== "production";

// small hardening
app.disable("x-powered-by");

// ✅ light request hardening
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ✅ sanity route (proves we’re running THIS file)
app.get("/__ping", (_req, res) => res.json({ ok: true, from: "apps/api/src/index.js" }));

/**
 * Health
 */
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
    version: "api-index-v9-cbbd-ncaam",
  })
);

/**
 * ✅ Mount routers (ONLY ONCE)
 */
app.use("/api", adminPerformanceRouter);
app.use("/api", performanceRoutes);

// routes/upsets.js uses router.get("/") so mount it at /api/upsets
app.use("/api/upsets", upsetsRouter);

// ✅ score router (ping/debug)
app.use("/api/score", scoreRouter);

if (nbaPremiumRouter) {
  app.use("/api/nba", nbaPremiumRouter);
}

app.use("/api", predictRouter);

/**
 * ✅ Admin guard helper
 * - In production: requires ?key=ADMIN_KEY or header x-admin-key
 * - In local dev: allows if ADMIN_KEY not set
 */
function requireAdmin(req) {
  if (!ADMIN_KEY) return isLocal; // local-only if no key provided
  const key = String(req.query.key || req.headers["x-admin-key"] || "").trim();
  return key && key === ADMIN_KEY;
}

function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}

function yesterdayUTCYYYYMMDD() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * ✅ Safe in-file cron runner (fallback)
 * This avoids hard dependency on dailyScore.js exporting runDailyScoreOnce.
 */
async function runDailyScoreOnceFallback({ date } = {}) {
  const ymd = normalizeDateParam(date) || yesterdayUTCYYYYMMDD();

  // Lazy imports to avoid startup/circular problems
  const { buildNbaPredictions } = await import("./routes/predict.js");
  const { scoreCompletedGames } = await import("./routes/score.js");

  const nba = await buildNbaPredictions(ymd, 14, { modelVersion: "v2" });
  const report = await scoreCompletedGames("nba", ymd, nba?.games || []);

  return {
    ranFor: ymd,
    scoredGames: Array.isArray(nba?.games) ? nba.games.length : 0,
    report,
  };
}

/**
 * ✅ Manual cron trigger (for testing)
 */
app.get("/api/admin/run-cron", async (req, res) => {
  try {
    if (!requireAdmin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const date = String(req.query.date || "").trim() || undefined;

    // Prefer cron module's runOnce if it exists, else fallback
    let out = null;
    try {
      const cronMod = await import("./cron/dailyScore.js");
      if (typeof cronMod?.runDailyScoreOnce === "function") {
        out = await cronMod.runDailyScoreOnce({ date });
      }
    } catch {
      // ignore — we'll fallback below
    }

    if (!out) {
      out = await runDailyScoreOnceFallback({ date });
    }

    return res.json({
      ok: true,
      ranFor: out.ranFor,
      scoredGames: out.scoredGames,
      report: out.report,
    });
  } catch (e) {
    console.error("[ADMIN CRON ERROR]", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ======================================================================
   Everything below here is your inline endpoints / helpers.
   ====================================================================== */

/**
 * Config
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";
const NHL_API_BASE = "https://api-web.nhle.com/v1";

/**
 * ✅ NCAAM via CollegeBasketballData (CBBD) — requires key
 * Env:
 *   NCAAM_API_BASE=https://api.collegebasketballdata.com
 *   CBBD_API_KEY=...
 */
const NCAAM_API_BASE = String(process.env.NCAAM_API_BASE || "https://api.collegebasketballdata.com").replace(
  /\/+$/,
  ""
);
const CBBD_API_KEY = String(process.env.CBBD_API_KEY || "").trim();

/**
 * Caching
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

/**
 * ✅ fetchJson w/ smarter 429 handling + small retry + timeout
 */
async function fetchJson(
  url,
  { headers } = {},
  { cacheTtlMs = CACHE_TTL_MS, retries = 2, baseBackoffMs = 450, timeoutMs = 25_000 } = {}
) {
  const auth = headers?.Authorization ? String(headers.Authorization) : "";
  const cacheKey = `GET:${url}:AUTH=${auth}`;

  const cached = getCache(cacheKey);
  if (cached) return cached;

  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(t));

      if (res.status === 429) {
        const retryAfter = parseRetryAfterSeconds(res);
        const retryAfterMs = retryAfter != null ? retryAfter * 1000 : 0;
        const text = await res.text().catch(() => "");
        const err = new Error(
          `Upstream 429 for ${url}${text ? ` — ${text}` : ""} — Too many requests, please try again later.`
        );
        err.status = 429;
        lastErr = err;

        if (attempt < retries) {
          const wait = Math.max(retryAfterMs, jitter(baseBackoffMs * Math.pow(2, attempt), 0.25));
          await sleep(wait);
          continue;
        }
        throw err;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`Upstream error ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
        err.status = res.status;
        lastErr = err;
        throw err;
      }

      const data = await res.json();
      setCache(cacheKey, data, cacheTtlMs);
      return data;
    } catch (e) {
      const msg = String(e?.message || e);
      const isAbort = msg.toLowerCase().includes("aborted");
      const isTransient =
        isAbort || msg.includes("fetch failed") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT");

      lastErr = e;

      if (!isTransient || attempt >= retries) throw e;
      await sleep(jitter(baseBackoffMs * Math.pow(2, attempt), 0.25));
    }
  }

  throw lastErr || new Error(`fetchJson failed for ${url}`);
}

/**
 * Helpers
 */
function addDays(yyyyMmDd, deltaDays) {
  const safe = normalizeDateParam(yyyyMmDd);
  if (!safe) throw new Error(`Invalid date (expected YYYY-MM-DD): ${yyyyMmDd}`);
  const d = new Date(`${safe}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}
function toNhlTeamId(triCode) {
  return `nhl-${String(triCode || "").toLowerCase()}`;
}
function toNcaamTeamId(codeOrId) {
  return `ncaam-${String(codeOrId || "").toLowerCase()}`;
}

function wantExpandTeams(req) {
  const v = String(req.query.expand || "").toLowerCase();
  return v === "teams" || v === "true" || v === "1";
}

/** Accepts `?date=YYYY-MM-DD` OR `?dates[]=YYYY-MM-DD` */
function readDateFromReq(req) {
  const d1 = normalizeDateParam(req.query.date);
  const d2 = normalizeDateParam(req.query["dates[]"]);
  return d1 || d2 || new Date().toISOString().slice(0, 10);
}

/**
 * NBA Teams fallback
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
 * NBA endpoints
 */
async function getNbaTeams() {
  if (!NBA_API_KEY) return { teams: NBA_TEAMS_FALLBACK };

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
  } catch {
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
 * NHL endpoints
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
 * ✅ NCAAM (CBBD) games by date
 * Uses /games with startDateRange & endDateRange (ISO 8601)
 */
function isoRangeForYMD(ymd) {
  const safe = normalizeDateParam(ymd);
  if (!safe) throw new Error(`Invalid date (expected YYYY-MM-DD): ${ymd}`);
  return {
    start: `${safe}T00:00:00Z`,
    end: `${safe}T23:59:59Z`,
  };
}

async function getNcaamGamesByDate(dateYYYYMMDD, expandTeams) {
  if (!CBBD_API_KEY) {
    throw new Error("Missing CBBD_API_KEY. Add it to apps/api/.env to enable NCAAM (CBBD) data.");
  }

  const { start, end } = isoRangeForYMD(dateYYYYMMDD);

  // CBBD uses these filters (camelCase is the public doc convention) :contentReference[oaicite:1]{index=1}
  const url =
    `${NCAAM_API_BASE}/games` +
    `?startDateRange=${encodeURIComponent(start)}` +
    `&endDateRange=${encodeURIComponent(end)}`;

  const rows = await fetchJson(
    url,
    { headers: { Authorization: `Bearer ${CBBD_API_KEY}` } },
    { cacheTtlMs: CACHE_TTL_MS }
  );

  const games = Array.isArray(rows) ? rows : [];

  return games.map((g) => {
    const startDate = g?.start_date ? String(g.start_date) : "";
    const date = startDate ? startDate.slice(0, 10) : dateYYYYMMDD;

    const homeName = g?.home_team || "Home";
    const awayName = g?.away_team || "Away";

    const base = {
      league: "ncaam",
      id: `ncaam-${g?.id ?? `${awayName}-${homeName}-${date}`}`,
      date,
      status: String(g?.status || ""),
      homeScore: Number.isFinite(Number(g?.home_points)) ? Number(g.home_points) : null,
      awayScore: Number.isFinite(Number(g?.away_points)) ? Number(g.away_points) : null,
      homeTeamId: toNcaamTeamId(g?.home_team_id ?? homeName),
      awayTeamId: toNcaamTeamId(g?.away_team_id ?? awayName),
      homeTeamCbddId: g?.home_team_id ?? null,
      awayTeamCbddId: g?.away_team_id ?? null,
      neutralSite: Boolean(g?.neutral_site),
      tournament: g?.tournament || null,
    };

    if (!expandTeams) return base;

    return {
      ...base,
      homeTeam: {
        id: toNcaamTeamId(g?.home_team_id ?? homeName),
        cbddId: g?.home_team_id ?? null,
        name: homeName,
        abbr: null,
        score: base.homeScore,
      },
      awayTeam: {
        id: toNcaamTeamId(g?.away_team_id ?? awayName),
        cbddId: g?.away_team_id ?? null,
        name: awayName,
        abbr: null,
        score: base.awayScore,
      },
    };
  });
}

/**
 * Routes
 */
app.get("/api/nba/teams", async (_req, res) => {
  const { teams } = await getNbaTeams();
  res.json(teams);
});

app.get("/api/nba/games", async (req, res) => {
  try {
    const date = readDateFromReq(req);
    const expand = wantExpandTeams(req);
    const games = await getNbaGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/nhl/games", async (req, res) => {
  try {
    const date = readDateFromReq(req);
    const expand = wantExpandTeams(req);
    const games = await getNhlGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/ncaam/games", async (req, res) => {
  try {
    const date = readDateFromReq(req);
    const expand = wantExpandTeams(req);
    const games = await getNcaamGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * ✅ Unified games endpoint (now includes NCAAM)
 */
app.get("/api/games", async (req, res) => {
  const date = readDateFromReq(req);
  const expandTeams = wantExpandTeams(req);

  let nbaGames = [];
  let nhlGames = [];
  let ncaamGames = [];

  let nbaError = null;
  let nhlError = null;
  let ncaamError = null;

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

  try {
    ncaamGames = await getNcaamGamesByDate(date, expandTeams);
  } catch (e) {
    ncaamError = String(e?.message || e);
  }

  res.json({
    date,
    expandTeams,
    counts: {
      total: nbaGames.length + nhlGames.length + ncaamGames.length,
      nba: nbaGames.length,
      nhl: nhlGames.length,
      ncaam: ncaamGames.length,
    },
    games: [...nbaGames, ...nhlGames, ...ncaamGames],
    errors: { nba: nbaError, nhl: nhlError, ncaam: ncaamError },
  });
});

// ✅ 404 JSON (prevents confusing hangs / HTML)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Not found: ${req.method} ${req.path}` });
});

/**
 * ✅ Central error handler (headers-safe)
 */
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number(err?.status) || 500;
  res.status(status).json({
    ok: false,
    error: String(err?.message || err),
    status,
  });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);

  // ✅ start cron (safe toggle)
  if (ENABLE_CRON) {
    console.log("[CRON] Daily scoring job enabled");
    startDailyScoreJob();
  } else {
    console.log("[CRON] Disabled via ENABLE_CRON=false");
  }
});
