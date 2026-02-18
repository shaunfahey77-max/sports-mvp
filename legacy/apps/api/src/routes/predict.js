// apps/api/src/routes/predict.js
import "dotenv/config";
import express from "express";

const router = express.Router();

/* =========================================================
   Upstreams
   ========================================================= */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";

// NHL (public) schedule endpoint
const NHL_API_BASE = "https://api-web.nhle.com/v1";

// ✅ NCAAM via espn
const NCAAM_PROVIDER = String(process.env.NCAAM_PROVIDER || "espn").toLowerCase();

router.get("/ncaam/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || todayUTCYYYYMMDD();

  // Always try ESPN first unless explicitly forced to cbbd
  if (NCAAM_PROVIDER !== "cbbd") {
    try {
      const { games: slateGames, sourceUrl } = await getNcaamGamesFromEspn(date, true);

      // If ESPN returns 0, do NOT fall back silently.
      // Return ESPN meta + empty list + warning.
      if (!slateGames.length) {
        return res.json({
          ok: true,
          meta: {
            league: "ncaam",
            date,
            model: "NCAAM espn-record-rank-v1",
            source: "espn-scoreboard",
            sourceUrl,
            warnings: ["espn_empty_slate"],
          },
          games: [],
        });
      }

      const preds = buildEspnRecordRankPredictions(slateGames); // your existing ESPN model function
      return res.json({
        ok: true,
        meta: {
          league: "ncaam",
          date,
          model: "NCAAM espn-record-rank-v1",
          source: "espn-scoreboard",
          sourceUrl,
          warnings: [],
        },
        games: preds,
      });
    } catch (e) {
      // Only here do we allow fallback
      console.warn("[NCAAM] ESPN predict failed, falling back:", e?.message || e);
    }
  }

  // Fallback to CBBD only if explicitly forced or ESPN errored
  const preds = await buildCbbdPredictions(date); // your existing CBBD function
  return res.json({
    ok: true,
    meta: {
      league: "ncaam",
      date,
      model: "NCAAM cbbd-v1",
      source: "cbbd",
      warnings: [],
    },
    games: preds?.games || [],
  });
});

/* =========================================================
   Cache (TTL + in-flight de-dupe + simple pruning)
   ========================================================= */
const CACHE_TTL_MS = 60_000;
const HEAVY_CACHE_TTL_MS = 20 * 60_000;
const MAX_CACHE_KEYS = 800;

const cache = new Map(); // key -> { time, ttl, value }
const inFlight = new Map(); // key -> Promise (upstream fetches)
const predInFlight = new Map(); // key -> Promise (computed predictions)

function pruneCacheIfNeeded() {
  if (cache.size <= MAX_CACHE_KEYS) return;
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

// Small per-host concurrency gate (prevents implosion)
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

function safeJsonContentType(res) {
  const ct = String(res?.headers?.get?.("content-type") || "").toLowerCase();
  return ct.includes("application/json") || ct.includes("+json");
}

/**
 * fetchJson with:
 * - cache
 * - in-flight de-dupe
 * - retry/backoff on 429 / 5xx / transient network errors
 * - per-host concurrency caps
 * - HARD request timeout via AbortController
 * - Detect non-JSON (prevents "Unexpected token '<'")
 */
async function fetchJson(
  url,
  { headers } = {},
  {
    cacheTtlMs = CACHE_TTL_MS,
    retries = 5,
    baseBackoffMs = 650,
    hostConcurrency = 2,
    timeoutMs = 25_000,
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
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fetch(url, { headers, signal: controller.signal });
          } finally {
            clearTimeout(t);
          }
        });

        if (res.status === 429) {
          const retryAfter = parseRetryAfterSeconds(res);
          const text = await res.text().catch(() => "");
          const waitMs =
            retryAfter != null
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

        // 🔒 Guard: if response isn't JSON, surface a clean error
        if (!safeJsonContentType(res)) {
          const text = await res.text().catch(() => "");
          const head = String(text || "").slice(0, 160).replace(/\s+/g, " ").trim();
          throw new Error(
            `Upstream returned non-JSON for ${url} (content-type=${res.headers.get(
              "content-type"
            ) || "unknown"}). Head: ${head || "—"}`
          );
        }

        const data = await res.json();
        setCache(cacheKey, data, cacheTtlMs);
        return data;
      } catch (e) {
        const msg = String(e?.message || e);
        const isAbort = msg.toLowerCase().includes("aborted");
        const isTransient =
          isAbort ||
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

/* =========================================================
   Prediction compute cache + in-flight de-dupe
   ========================================================= */
async function computeCached(key, ttlMs, fn) {
  const hit = getCache(key);
  if (hit) return hit;

  const existing = predInFlight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const val = await fn();
    setCache(key, val, ttlMs);
    return val;
  })();

  predInFlight.set(key, p);
  try {
    return await p;
  } finally {
    predInFlight.delete(key);
  }
}

/* =========================================================
   Date + params
   ========================================================= */
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

// model version switch (NBA A/B safe)
function readModelFromReq(req, def = "v1") {
  const raw = String(req.query.model || req.query.modelVersion || def).toLowerCase();
  if (raw === "v2" || raw === "2" || raw === "premium" || raw === "hybrid") return "v2";
  return "v1";
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

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* =========================================================
   Premium decision helpers
   ========================================================= */
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

function tierFromEdge(edgeAbs, { lean, edge } = {}) {
  const LEAN = lean ?? 0.07;
  const EDGE = edge ?? 0.11;
  if (!Number.isFinite(edgeAbs)) return "PASS";
  if (edgeAbs < LEAN) return "PASS";
  if (edgeAbs < EDGE) return "LEAN";
  if (edgeAbs < EDGE * 1.45) return "EDGE";
  return "STRONG";
}

/* =========================================================
   Why builder (structured)
   ========================================================= */
function buildWhyPanel({ pickSide, pickNote, edge, conf, deltas = [] }) {
  const bullets = [];

  if (!pickSide) {
    bullets.push(
      pickNote === "pass_toss_up"
        ? "Pass: edge not strong enough (toss-up)."
        : "Pass: insufficient signal."
    );
    if (Number.isFinite(edge)) bullets.push(`Edge: ${edge.toFixed(3)} (below threshold).`);
    return { headline: "PASS (no bet)", bullets: bullets.slice(0, 5), deltas: [] };
  }

  bullets.push(
    `Pick: ${pickSide.toUpperCase()} (edge ${Number.isFinite(edge) ? edge.toFixed(3) : "—"})`
  );
  if (Number.isFinite(conf))
    bullets.push(`Confidence proxy: ${Math.round(conf * 100)}% (not a bar metric)`);

  const outDeltas = [];
  for (const d of deltas) {
    if (!d?.label) continue;
    if (!Number.isFinite(d.delta)) continue;
    const sign = d.delta > 0 ? "+" : "";
    const dp = d.dp ?? 3;
    const suffix = d.suffix ?? "";
    outDeltas.push({ label: d.label, value: d.delta, display: `${sign}${d.delta.toFixed(dp)}${suffix}` });
  }

  for (const dd of outDeltas.slice(0, 3)) bullets.push(`${dd.label}: ${dd.display}`);

  return {
    headline: pickSide === "home" ? "Home side value" : "Away side value",
    bullets: bullets.slice(0, 6),
    deltas: outDeltas.slice(0, 6),
  };
}

/* =========================================================
   Unified game response builder
   ========================================================= */
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
  const recommended = pickSide === "home" ? home : pickSide === "away" ? away : null;

  const homeScore =
    Number.isFinite(home?.score) ? home.score : Number.isFinite(home?.homeScore) ? home.homeScore : null;
  const awayScore =
    Number.isFinite(away?.score) ? away.score : Number.isFinite(away?.awayScore) ? away.awayScore : null;

  return {
    gameId,
    date,
    status,
    homeScore,
    awayScore,
    home,
    away,
    market: {
      pick: pickSide,
      recommendedTeamId: recommended ? recommended.id : null,
      recommendedTeamName: recommended ? (recommended.name || "") : "",
      edge: Number.isFinite(edge) ? edge : null,
      tier,
      confidence: recommended ? conf : null,
      winProb: recommended && Number.isFinite(factors?.winProb) ? factors.winProb : null,
    },
    why: whyPanel,
    factors: { league, ...factors },
  };
}

/* =========================================================
   Team IDs
   ========================================================= */
function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}
function toNhlTeamId(tri) {
  return `nhl-${String(tri || "").toLowerCase()}`;
}
function toNcaamTeamId(idOrKey) {
  return `ncaam-${String(idOrKey || "").toLowerCase()}`;
}

/* =========================================================
   NBA — premium blended model
   ========================================================= */

async function getNbaGamesByDate(dateYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY (set in apps/api/.env)");

  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(dateYYYYMMDD)}`;
  const json = await fetchJson(
    url,
    { headers: { Authorization: NBA_API_KEY } },
    { cacheTtlMs: CACHE_TTL_MS, hostConcurrency: 2 }
  );

  const rows = json?.data || [];

  return rows.map((g) => {
    const homeAbbr = g?.home_team?.abbreviation;
    const awayAbbr = g?.visitor_team?.abbreviation;

    const homeScore = typeof g?.home_team_score === "number" ? g.home_team_score : null;
    const awayScore = typeof g?.visitor_team_score === "number" ? g.visitor_team_score : null;

    return {
      gameId: `nba-${g.id}`,
      date: String(g?.date || "").slice(0, 10),
      status: g?.status || "",
      home: { id: toNbaTeamId(homeAbbr), name: homeAbbr || "", score: homeScore },
      away: { id: toNbaTeamId(awayAbbr), name: awayAbbr || "", score: awayScore },
      homeScore,
      awayScore,
    };
  });
}

async function getNbaGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  if (!NBA_API_KEY) throw new Error("Missing NBA_API_KEY");

  const cacheKey = `NBA_DATES_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const dates = [];
  let cur = startYYYYMMDD;
  while (cur <= endYYYYMMDD) {
    dates.push(cur);
    cur = addDaysUTC(cur, 1);
  }

  const CHUNK = 7;
  const PER_PAGE = 100;
  const MAX_PAGES_PER_CHUNK = 15;

  const all = [];

  for (let i = 0; i < dates.length; i += CHUNK) {
    const chunk = dates.slice(i, i + CHUNK);
    const qs = chunk.map((d) => `dates[]=${encodeURIComponent(d)}`).join("&");

    let page = 1;
    while (page <= MAX_PAGES_PER_CHUNK) {
      const url = `${NBA_API_BASE}/games?per_page=${PER_PAGE}&page=${page}&${qs}`;
      const json = await fetchJson(
        url,
        { headers: { Authorization: NBA_API_KEY } },
        {
          cacheTtlMs: HEAVY_CACHE_TTL_MS,
          retries: 6,
          baseBackoffMs: 700,
          hostConcurrency: 2,
          timeoutMs: 30_000,
        }
      );

      const pageRows = json?.data || [];
      if (pageRows.length) all.push(...pageRows);
      if (pageRows.length < PER_PAGE) break;

      page++;
      await sleep(250);
    }

    await sleep(250);
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

// NBA model helpers
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
function shrink(x, prior, n, k) {
  const xx = Number.isFinite(x) ? x : prior;
  const nn = Number.isFinite(n) ? n : 0;
  return (nn * xx + k * prior) / (nn + k);
}
function pickThresholdFromUncertainty(homePlayed, awayPlayed, base = 0.07) {
  const n = Math.min(Number(homePlayed) || 0, Number(awayPlayed) || 0);
  const unc = n > 0 ? 1 / Math.sqrt(n) : 1;
  return clamp(base + 0.06 * unc, 0.07, 0.13);
}

function nbaEdge_v1(home, away) {
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

function nbaEdge_v2(home, away) {
  if (!home?.ok || !away?.ok) return NaN;

  const nH = home.played ?? 0;
  const nA = away.played ?? 0;

  const priorWin = 0.5;
  const priorMargin = 0;

  const homeWin = shrink(home.winPct, priorWin, nH, 18);
  const awayWin = shrink(away.winPct, priorWin, nA, 18);

  const homeMargin = shrink(home.marginPerGame, priorMargin, nH, 10);
  const awayMargin = shrink(away.marginPerGame, priorMargin, nA, 10);

  const hR10 = shrink(home.recent10?.winPct, priorWin, home.recent10?.played ?? 0, 6);
  const aR10 = shrink(away.recent10?.winPct, priorWin, away.recent10?.played ?? 0, 6);

  const hR5m = shrink(home.recent5?.margin, priorMargin, home.recent5?.played ?? 0, 5);
  const aR5m = shrink(away.recent5?.margin, priorMargin, away.recent5?.played ?? 0, 5);

  const winDiff = homeWin - awayWin;
  const marginDiff = clamp((homeMargin - awayMargin) / 12, -1, 1);
  const r10Diff = clamp(hR10 - aR10, -1, 1);
  const r5MarginDiff = clamp((hR5m - aR5m) / 14, -1, 1);

  const wWin = 0.38;
  const wMargin = 0.32;
  const wR10 = 0.18;
  const wR5m = 0.12;

  const homeAdv = 0.012;

  return wWin * winDiff + wMargin * marginDiff + wR10 * r10Diff + wR5m * r5MarginDiff + homeAdv;
}

function nbaProbFromEdge_v2(edge, edgeScale = 0.11) {
  if (!Number.isFinite(edge)) return 0.5;
  return clamp(sigmoid(edge / edgeScale), 0.33, 0.77);
}

async function buildNbaPredictions(dateYYYYMMDD, windowDays, { modelVersion = "v1" } = {}) {
  const key = `PRED:nba:${dateYYYYMMDD}:w${windowDays}:m${modelVersion}`;
  return computeCached(key, HEAVY_CACHE_TTL_MS, async () => {
    const schedule = await getNbaGamesByDate(dateYYYYMMDD);
    if (!schedule.length) {
      return {
        meta: {
          league: "nba",
          date: dateYYYYMMDD,
          windowDays,
          model: modelVersion === "v2" ? "NBA premium-v4-hybrid" : "NBA premium-v3",
          modelVersion,
          mode: "regular",
          note: "No NBA games scheduled.",
          warnings: [],
        },
        games: [],
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

    const games = [];
    let noPickCount = 0;

    for (const g of schedule) {
      const homeS = teamStats.get(g.home.id) || { ok: false };
      const awayS = teamStats.get(g.away.id) || { ok: false };

      const edge = modelVersion === "v2" ? nbaEdge_v2(homeS, awayS) : nbaEdge_v1(homeS, awayS);

      const MIN_EDGE_FOR_PICK =
        modelVersion === "v2"
          ? pickThresholdFromUncertainty(homeS.played, awayS.played, 0.07)
          : 0.075;

      const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);

      let winProb = null;
      let conf = 0.5;

      if (modelVersion === "v2") {
        const pHome = nbaProbFromEdge_v2(edge, 0.11);

        if (pick.side === "home") winProb = pHome;
        else if (pick.side === "away") winProb = 1 - pHome;
        else winProb = 0.5;

        conf = clamp(0.50 + 0.9 * Math.abs((winProb ?? 0.5) - 0.5), 0.52, 0.90);
      } else {
        conf = confidenceFromEdge(edge, 0.17, 0.53, 0.94);
      }

      if (!pick.side) noPickCount++;

      const deltas = [
        { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
        { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
        { label: "Recent10 win% diff", delta: (homeS.recent10?.winPct ?? 0.5) - (awayS.recent10?.winPct ?? 0.5), dp: 3 },
        { label: "Recent5 margin diff", delta: (homeS.recent5?.margin ?? 0) - (awayS.recent5?.margin ?? 0), dp: 2, suffix: " pts/g" },
        ...(modelVersion === "v2" ? [{ label: "Pick threshold", delta: MIN_EDGE_FOR_PICK, dp: 3 }] : []),
      ];

      const whyPanel = buildWhyPanel({ pickSide: pick.side, pickNote: pick.note, edge, conf, deltas });

      const tier = pick.side
        ? tierFromEdge(Math.abs(edge), { lean: MIN_EDGE_FOR_PICK, edge: modelVersion === "v2" ? 0.105 : 0.11 })
        : "PASS";

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
            modelVersion,
            edge,
            pickNote: pick.note,
            winProb: modelVersion === "v2" ? winProb : null,
            homePlayed: homeS.played ?? null,
            awayPlayed: awayS.played ?? null,
            homeWinPct: homeS.winPct ?? null,
            awayWinPct: awayS.winPct ?? null,
            homeMarginPerGame: homeS.marginPerGame ?? null,
            awayMarginPerGame: awayS.marginPerGame ?? null,
            homeRecent10WinPct: homeS.recent10?.winPct ?? null,
            awayRecent10WinPct: awayS.recent10?.winPct ?? null,
            homeRecent5Margin: homeS.recent5?.margin ?? null,
            awayRecent5Margin: awayS.recent5?.margin ?? null,
            note:
              modelVersion === "v2"
                ? "NBA v2 hybrid: shrink win%/margins + reduced home adv + uncertainty-aware thresholds + winProb + pick-strength confidence."
                : "NBA v1: win% + margin + recent 10 + recent 5 margin + small home adv. PASS discipline enabled.",
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
        model: modelVersion === "v2" ? "NBA premium-v4-hybrid" : "NBA premium-v3",
        modelVersion,
        mode: "regular",
        warnings: [],
      },
      games,
    };
  });
}

/* =========================================================
   NHL — stable standings model + Olympics pause behavior
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

  const wPoint = 0.72, wGD = 0.23, wRecent = 0.05;
  const pointDiff = home.pointPct - away.pointPct;
  const gdDiff = clamp((home.gdPerGame - away.gdPerGame) / 1.3, -1, 1);
  const recentDiff =
    (Number.isFinite(home.last10Pct) ? home.last10Pct : 0.5) -
    (Number.isFinite(away.last10Pct) ? away.last10Pct : 0.5);

  const homeAdv = 0.015;
  return wPoint * pointDiff + wGD * gdDiff + wRecent * recentDiff + homeAdv;
}

async function buildNhlPredictions(dateYYYYMMDD, windowDays) {
  const schedule = await getNhlGamesByDate(dateYYYYMMDD);

  // ✅ Olympics pause behavior: no games -> return 0 with explicit note (not an error)
  if (!schedule.length) {
    return {
      meta: {
        league: "nhl",
        date: dateYYYYMMDD,
        windowDays,
        model: "NHL premium-v2",
        note: "NHL paused (Olympics) — no games scheduled.",
      },
      predictions: [],
    };
  }

  const standings = await getNhlStandingsMap();
  const predictions = [];
  let noPickCount = 0;

  const MIN_EDGE_FOR_PICK = 0.085;

  for (const g of schedule) {
    const homeRow = standings.get(String(g.home.name || "").toUpperCase());
    const awayRow = standings.get(String(g.away.name || "").toUpperCase());

    const edge = nhlEdge(homeRow, awayRow);
    const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
    const conf = confidenceFromEdge(edge, 0.19, 0.53, 0.93);

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
        factors: {
          windowDays,
          edge,
          pickNote: pick.note,
          note: "Premium blend: point% + goal diff/game + last10 + small home adv. PASS discipline enabled.",
        },
      },
    });
  }

  return {
    meta: { league: "nhl", date: dateYYYYMMDD, windowDays, noPickCount, model: "NHL premium-v2" },
    predictions,
  };
}

/* =========================================================
   NCAAM — CBBD /games/teams (D1 Men’s Basketball)
   ✅ FIXED: use correct CBBD endpoint + pair team rows into games
   ========================================================= */

function cbbdHeaders() {
  const h = { Accept: "application/json" };
  if (CBBD_API_KEY) h.Authorization = `Bearer ${CBBD_API_KEY}`;
  return h;
}

function isoRangeForDay(dateYYYYMMDD) {
  return {
    start: `${dateYYYYMMDD}T00:00:00Z`,
    end: `${dateYYYYMMDD}T23:59:59Z`,
  };
}

function seasonFromDate(dateYYYYMMDD) {
  // CBBD commonly uses the ending year for season (e.g., 2025-26 season => 2026)
  const y = Number(String(dateYYYYMMDD).slice(0, 4));
  return Number.isFinite(y) ? y : new Date().getUTCFullYear();
}

/**
 * CBBD returns 1 row per team per game.
 * We pair by gameId:
 * - if row.isHome === true, row.team is home, row.opponent is away
 * - else row.team is away, row.opponent is home
 */
function pairCbbdTeamRowsToGames(dateYYYYMMDD, rows) {
  const byGame = new Map();

  for (const r of Array.isArray(rows) ? rows : []) {
    const gameId = r?.gameId;
    if (gameId == null) continue;

    const key = String(gameId);
    if (!byGame.has(key)) byGame.set(key, { home: null, away: null, raw: [] });
    const slot = byGame.get(key);
    slot.raw.push(r);

    const isHome = Boolean(r?.isHome);
    const teamId = r?.teamId;
    const oppId = r?.opponentId;

    const teamName = String(r?.team || "");
    const oppName = String(r?.opponent || "");

    const teamScore = safeNum(r?.teamStats?.points?.total);
    const oppScore = safeNum(r?.opponentStats?.points?.total);

    const neutralSite = Boolean(r?.neutralSite);
    const conferenceGame = Boolean(r?.conferenceGame);

    const startDate = r?.startDate ? String(r.startDate).slice(0, 10) : dateYYYYMMDD;

    // Build home/away objects from this single row
    if (isHome) {
      slot.home = {
        id: toNcaamTeamId(teamId),
        name: teamName || String(teamId ?? ""),
        abbr: "",
        score: teamScore,
      };
      slot.away = {
        id: toNcaamTeamId(oppId),
        name: oppName || String(oppId ?? ""),
        abbr: "",
        score: oppScore,
      };
      slot.meta = { neutralSite, conferenceGame, startDate };
    } else {
      slot.away = {
        id: toNcaamTeamId(teamId),
        name: teamName || String(teamId ?? ""),
        abbr: "",
        score: teamScore,
      };
      slot.home = {
        id: toNcaamTeamId(oppId),
        name: oppName || String(oppId ?? ""),
        abbr: "",
        score: oppScore,
      };
      slot.meta = { neutralSite, conferenceGame, startDate };
    }
  }

  const out = [];
  for (const [gid, g] of byGame.entries()) {
    if (!g.home?.id || !g.away?.id) continue;

    const hs = safeNum(g.home.score);
    const as = safeNum(g.away.score);

    // Conservative status: if both scores exist and (non-null), treat as Final
    const status = hs != null && as != null ? "Final" : "scheduled";

    out.push({
      gameId: `ncaam-${gid}`,
      date: g?.meta?.startDate || dateYYYYMMDD,
      status,
      neutralSite: Boolean(g?.meta?.neutralSite),
      conferenceGame: Boolean(g?.meta?.conferenceGame),
      home: g.home,
      away: g.away,
      homeScore: hs,
      awayScore: as,
    });
  }

  return out;
}

async function fetchNcaamGamesByDate_CBBD(dateYYYYMMDD, { seasonType = "regular", season } = {}) {
  if (!CBBD_API_BASE) throw new Error("Missing CBBD_API_BASE");
  if (!CBBD_API_KEY) throw new Error("Missing CBBD_API_KEY (Bearer token) in apps/api/.env");

  const { start, end } = isoRangeForDay(dateYYYYMMDD);
  const s = Number.isFinite(Number(season)) ? Number(season) : seasonFromDate(dateYYYYMMDD);

  const qs = new URLSearchParams({
    startDateRange: start,
    endDateRange: end,
    season: String(s),
    seasonType: String(seasonType),
  });

  const url = `${CBBD_API_BASE}/games/teams?${qs.toString()}`;

  const rows = await fetchJson(
    url,
    { headers: cbbdHeaders() },
    { cacheTtlMs: CACHE_TTL_MS, retries: 4, baseBackoffMs: 650, hostConcurrency: 2, timeoutMs: 25_000 }
  );

  if (!Array.isArray(rows)) {
    throw new Error(`CBBD /games/teams returned unexpected shape (expected array).`);
  }

  // Pair team rows into unique games
  return pairCbbdTeamRowsToGames(dateYYYYMMDD, rows);
}

function ncaamEdgeBasic(home, away, neutralSite, tournamentMode) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = tournamentMode ? 0.46 : 0.50;
  const wMargin = tournamentMode ? 0.34 : 0.30;
  const wRecent = 0.20;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clamp((home.marginPerGame - away.marginPerGame) / 14, -1, 1);
  const recentDiff =
    (Number.isFinite(home.recentWinPct) ? home.recentWinPct : 0.5) -
    (Number.isFinite(away.recentWinPct) ? away.recentWinPct : 0.5);

  const homeAdv = neutralSite || tournamentMode ? 0 : 0.018;
  return wWin * winDiff + wMargin * marginScaled + wRecent * recentDiff + homeAdv;
}

// Build team stats from scored history games list (expects scores on completed games)
function buildNcaamTeamStatsFromGames(historyGames, endDateYYYYMMDD, recentN = 10) {
  const cutoff = Date.parse(`${endDateYYYYMMDD}T00:00:00Z`);
  const byTeamGames = new Map();

  function add(teamId, game) {
    if (!byTeamGames.has(teamId)) byTeamGames.set(teamId, []);
    byTeamGames.get(teamId).push(game);
  }

  for (const g of historyGames) {
    if (g.homeScore == null || g.awayScore == null) continue;

    const t = Date.parse(`${g.date}T00:00:00Z`);
    if (!t || t >= cutoff) continue;

    add(g.home.id, { date: g.date, my: g.homeScore, opp: g.awayScore });
    add(g.away.id, { date: g.date, my: g.awayScore, opp: g.homeScore });
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
    let rWins = 0;
    for (const g of recent) if (g.my > g.opp) rWins++;

    out.set(id, {
      ok: true,
      played,
      winPct: wins / played,
      marginPerGame: (pf - pa) / played,
      recentWinPct: recent.length ? rWins / recent.length : null,
    });
  }

  return out;
}

async function buildNcaamPredictions(dateYYYYMMDD, windowDays, { tournamentMode, modeLabel }) {
  const historyDays = clamp(Number(windowDays) || 45, 14, 90);
  const key = `PRED:ncaam:${dateYYYYMMDD}:w${historyDays}:t${tournamentMode ? 1 : 0}`;

  return computeCached(key, HEAVY_CACHE_TTL_MS, async () => {
    const season = seasonFromDate(dateYYYYMMDD);
    const seasonType = tournamentMode ? "postseason" : "regular";

    const slate = await fetchNcaamGamesByDate_CBBD(dateYYYYMMDD, { season, seasonType });

    if (!slate.length) {
      return {
        meta: {
          league: "ncaam",
          date: dateYYYYMMDD,
          windowDays: historyDays,
          model: "NCAAM cbbd-v1",
          mode: modeLabel,
          note: "No NCAAM games scheduled.",
          warnings: [],
        },
        games: [],
      };
    }

    // History: request each day (cached + gated)
    const history = [];
    for (let i = historyDays; i >= 1; i--) {
      const d = addDaysUTC(dateYYYYMMDD, -i);
      try {
        const rows = await fetchNcaamGamesByDate_CBBD(d, { season: seasonFromDate(d), seasonType: "regular" });
        history.push(...rows);
      } catch {
        // skip day failures
      }
      await sleep(40);
    }

    const teamStats = buildNcaamTeamStatsFromGames(history, dateYYYYMMDD, 10);

    const BASE_MIN_EDGE = 0.095;
    const MIN_EDGE_FOR_PICK = tournamentMode ? 0.075 : BASE_MIN_EDGE;

    const games = [];
    let noPickCount = 0;

    for (const g of slate) {
      const homeS = teamStats.get(g.home.id) || { ok: false };
      const awayS = teamStats.get(g.away.id) || { ok: false };

      const neutral = Boolean(g.neutralSite) || Boolean(tournamentMode);
      const edge = ncaamEdgeBasic(homeS, awayS, neutral, tournamentMode);

      const pick = pickFromEdge(edge, MIN_EDGE_FOR_PICK);
      const conf = confidenceFromEdge(edge, tournamentMode ? 0.24 : 0.22, 0.53, 0.92);
      if (!pick.side) noPickCount++;

      const deltas = [
        { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
        { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
        { label: "Recent win% diff", delta: (homeS.recentWinPct ?? 0.5) - (awayS.recentWinPct ?? 0.5), dp: 3 },
        { label: "Neutral court", delta: neutral ? 1 : 0, dp: 0, suffix: neutral ? " (yes)" : " (no)" },
      ];

      const whyPanel = buildWhyPanel({ pickSide: pick.side, pickNote: pick.note, edge, conf, deltas });
      const tier = pick.side
        ? tierFromEdge(Math.abs(edge), { lean: MIN_EDGE_FOR_PICK, edge: tournamentMode ? 0.105 : 0.11 })
        : "PASS";

      games.push(
        toUnifiedGame({
          league: "ncaam",
          gameId: g.gameId,
          date: dateYYYYMMDD,
          status: g.status || "scheduled",
          home: g.home,
          away: g.away,
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
            season,
            seasonType,
            note: "NCAAM cbbd-v1: CBBD /games/teams paired into games + conservative edge blend.",
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
        model: "NCAAM cbbd-v1",
        mode: modeLabel,
        warnings: [],
      },
      games,
    };
  });
}

/* =========================================================
   Backward compat adaptor
   ========================================================= */
function addPredictionsAlias(out) {
  return { ...out, predictions: out.games };
}

/* =========================================================
   Routes
   ========================================================= */
router.get("/nba/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 14, 3, 30);
  const modelVersion = readModelFromReq(req, "v1");

  try {
    res.json(addPredictionsAlias(await buildNbaPredictions(date, windowDays, { modelVersion })));
  } catch (e) {
    res.json(
      addPredictionsAlias({
        meta: {
          league: "nba",
          date,
          windowDays,
          model: modelVersion === "v2" ? "NBA premium-v4-hybrid" : "NBA premium-v3",
          modelVersion,
          mode: "regular",
          error: String(e?.message || e),
          warnings: [],
        },
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
        meta: {
          league: "nhl",
          date,
          windowDays,
          model: "NHL schedule-v1",
          mode: "regular",
          error: String(e?.message || e),
          warnings: [],
        },
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
    res.json(
      addPredictionsAlias(
        await buildNcaamPredictions(date, windowDays, { tournamentMode: tournament, modeLabel: mode })
      )
    );
  } catch (e) {
    res.json(
      addPredictionsAlias({
        meta: {
          league: "ncaam",
          date,
          windowDays,
          model: "NCAAM cbbd-v1",
          mode,
          error: String(e?.message || e),
          warnings: [],
        },
        games: [],
      })
    );
  }
});

// keep frontend compatibility
router.get("/predictions", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = readDateFromReq(req);
  const { tournament, mode } = readModeFromReq(req);

  try {
    if (league === "nba") {
      const windowDays = readWindowFromReq(req, 14, 3, 30);
      const modelVersion = readModelFromReq(req, "v1");
      const out = await buildNbaPredictions(date, windowDays, { modelVersion });
      return res.json({ league, date, count: out.games.length, ...addPredictionsAlias(out) });
    }
    if (league === "nhl") {
      const windowDays = readWindowFromReq(req, 60, 3, 120);
      const out = await buildNhlPredictions(date, windowDays);
      return res.json({ league, date, count: out.games.length, ...addPredictionsAlias(out) });
    }
    if (league === "ncaam") {
      const windowDays = readWindowFromReq(req, 45, 14, 90);
      const out = await buildNcaamPredictions(date, windowDays, {
        tournamentMode: tournament,
        modeLabel: mode,
      });
      return res.json({ league, date, count: out.games.length, ...addPredictionsAlias(out) });
    }
    return res.status(400).json({ error: "Unsupported league. Use league=nba|nhl|ncaam", got: league });
  } catch (e) {
    return res.json({ league, date, mode, error: String(e?.message || e), games: [], predictions: [] });
  }
});

// Export builders so /api/performance can call them directly (no internal HTTP)
export { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions };

export default router;
