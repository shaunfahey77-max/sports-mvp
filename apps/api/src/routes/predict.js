// apps/api/src/routes/predict.js
import "dotenv/config";
import express from "express";

const router = express.Router();

/**
 * Upstreams
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";

// ✅ ESPN
const ESPN_SITE_V2 = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_NCAAM_PATH = "basketball/mens-college-basketball";
const ESPN_NHL_PATH = "hockey/nhl";

// ✅ The Odds API (Vegas market lines) — optional but enables market anchoring for NBA
const ODDS_API_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_BOOKMAKER = String(process.env.ODDS_BOOKMAKER || process.env.ODDS_BOOK || "draftkings").toLowerCase();

// ✅ Premium guard: historical odds are paid-only on many Odds API plans.
// Default false (recommended). Enable only if you're on a paid plan.
const ODDS_ALLOW_HISTORICAL =
  String(process.env.ODDS_ALLOW_HISTORICAL || "false").toLowerCase() === "true";

/**
 * Cache (TTL + in-flight de-dupe + simple pruning)
 *
 * Premium upgrades:
 * - Periodic expired-key cleanup (prevents memory creep on long-lived server)
 * - Defensive queue cap on host gate (avoids unbounded memory if upstream stalls)
 */
const CACHE_TTL_MS = 60_000;
const HEAVY_CACHE_TTL_MS = 20 * 60_000;
const MAX_CACHE_KEYS = 800;

const cache = new Map(); // key -> { time, ttl, value }
const inFlight = new Map(); // key -> Promise (upstream fetches)
const predInFlight = new Map(); // key -> Promise (computed predictions)

let _lastCacheSweep = 0;
function sweepExpiredCache(maxToCheck = 500) {
  const now = Date.now();
  if (now - _lastCacheSweep < 30_000) return; // at most every 30s
  _lastCacheSweep = now;

  let checked = 0;
  for (const [k, v] of cache.entries()) {
    checked++;
    if (now - v.time > v.ttl) cache.delete(k);
    if (checked >= maxToCheck) break;
  }
}

function pruneCacheIfNeeded() {
  if (cache.size <= MAX_CACHE_KEYS) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].time - b[1].time);
  const removeN = Math.ceil(entries.length * 0.1);
  for (let i = 0; i < removeN; i++) cache.delete(entries[i][0]);
}

function getCache(key) {
  sweepExpiredCache();
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

function clampNum(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// Small per-host concurrency gate (prevents “imploding”)
const hostGates = new Map(); // host -> { active, queue: [] }

// Defensive: avoid unbounded queue growth if upstream becomes unusable.
// If queue exceeds cap, new callers wait for a short time and then proceed (best-effort).
const DEFAULT_HOST_QUEUE_CAP = 200;

async function withHostGate(url, limit, fn, { queueCap = DEFAULT_HOST_QUEUE_CAP } = {}) {
  const host = new URL(url).host;
  if (!hostGates.has(host)) hostGates.set(host, { active: 0, queue: [] });
  const gate = hostGates.get(host);

  if (gate.active >= limit) {
    // If queue is huge, degrade gracefully rather than OOM the process.
    if (gate.queue.length >= queueCap) {
      await sleep(35);
    } else {
      await new Promise((resolve) => gate.queue.push(resolve));
    }
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

function isAbortLike(e) {
  const name = String(e?.name || "");
  const msg = String(e?.message || e || "");
  return name === "AbortError" || msg.toLowerCase().includes("aborted");
}

/**
 * fetchJson with:
 * - cache
 * - in-flight de-dupe
 * - retry/backoff on 429 / 5xx / transient network errors
 * - per-host concurrency caps
 * - HARD request timeout via AbortController (prevents “forever hangs”)
 *
 * Premium upgrades:
 * - Robust JSON parsing with content-type fallback (upstreams occasionally return HTML on errors)
 * - Better transient detection (AbortError + common Node fetch failures)
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
        const res = await withHostGate(
          url,
          hostConcurrency,
          async () => {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                headers: {
                  // ESPN is usually fine without UA, but some CDNs behave better with it.
                  // Keep minimal and stable.
                  "User-Agent": "sports-mvp-api/1.0",
                  ...(headers || {}),
                },
                signal: controller.signal,
              });
            } finally {
              clearTimeout(t);
            }
          },
          { queueCap: DEFAULT_HOST_QUEUE_CAP }
        );

        const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();

        // Helper: safe read text once
        async function readTextSafe() {
          return await res.text().catch(() => "");
        }

        if (res.status === 429) {
          const retryAfter = parseRetryAfterSeconds(res);
          const text = await readTextSafe();
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
          const text = await readTextSafe();
          const waitMs = jitter(baseBackoffMs * Math.pow(2, attempt), 0.25);
          if (attempt >= retries) {
            throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
          }
          await sleep(waitMs);
          continue;
        }

        if (!res.ok) {
          const text = await readTextSafe();
          throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
        }

        // Prefer res.json() when content-type looks right; otherwise attempt json parse from text.
        let data;
        if (contentType.includes("application/json") || contentType.includes("+json")) {
          try {
            data = await res.json();
          } catch {
            const text = await readTextSafe();
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error(`Upstream returned non-JSON for ${url}`);
            }
          }
        } else {
          const text = await readTextSafe();
          try {
            data = JSON.parse(text);
          } catch {
            // If upstream returned HTML or text, fail loudly but safely.
            throw new Error(`Upstream returned non-JSON for ${url}`);
          }
        }

        setCache(cacheKey, data, cacheTtlMs);
        return data;
      } catch (e) {
        const msg = String(e?.message || e);
        const isTransient =
          isAbortLike(e) ||
          msg.includes("fetch failed") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EAI_AGAIN") ||
          msg.includes("ENOTFOUND") ||
          msg.includes("network timeout");

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
 * Prediction compute cache + in-flight de-dupe
 */
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

/**
 * Logo helpers
 */
function nbaLogoFromAbbr(abbr) {
  const a = String(abbr || "").trim().toLowerCase();
  if (!a) return null;
  return `https://a.espncdn.com/i/teamlogos/nba/500/${a}.png`;
}
function espnNhlLogoFromTeamId(teamId) {
  const id = String(teamId || "").trim();
  if (!id) return null;
  return `https://a.espncdn.com/i/teamlogos/nhl/500/${id}.png`;
}


function sanitizeLogoUrl(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  // ESPN provides https; keep only http/https to avoid broken images.
  if (!/^https?:\/\//i.test(u)) return null;
  return u;
}

function countMissingLogos(games = []) {
  let totalTeams = 0;
  let missing = 0;
  for (const g of games) {
    for (const side of ["home", "away"]) {
      const t = g?.[side];
      if (!t) continue;
      totalTeams++;
      const logo = sanitizeLogoUrl(t.logo);
      if (!logo) missing++;
    }
  }
  return { totalTeams, missing, ok: missing === 0 };
}

/**
 * Vegas helpers (The Odds API) — NBA anchoring only (safe no-op if no key)
 *
 * Premium fixes:
 * - Avoid paid-only historical endpoint for past dates unless ODDS_ALLOW_HISTORICAL=true
 * - Redact apiKey from meta URLs (avoid leaking secrets)
 * - Normalize common paid-plan error into a stable reason
 */
function normTeamName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+&\s+/g, " and ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function americanToImpliedProb(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return 100 / (a + 100);
  return -a / (-a + 100);
}

function normalizeNoVig(pA, pB) {
  if (!Number.isFinite(pA) || !Number.isFinite(pB)) return { pA: null, pB: null, vig: null };
  const sum = pA + pB;
  if (!(sum > 0)) return { pA: null, pB: null, vig: null };
  return { pA: pA / sum, pB: pB / sum, vig: sum - 1 };
}

// ✅ Odds API is picky sometimes; use no-milliseconds ISO to avoid INVALID_COMMENCE_TIME_FROM
function ymdToOddsIsoRange(ymd) {
  const startIso = `${ymd}T00:00:00Z`;

  // NBA games often start after midnight UTC for the same "calendar day" in the US.
  // Include a buffer into the next UTC day to capture late tips.
  const startMs = Date.parse(`${ymd}T00:00:00Z`);
  const endMs = startMs + 30 * 60 * 60 * 1000; // +30 hours
  const endIso = new Date(endMs).toISOString().replace(/\.\d{3}Z$/, "Z"); // no millis

  return { startIso, endIso };
}

function todayUTCYMD() {
  return new Date().toISOString().slice(0, 10);
}

function isPastDateUTC(dateYYYYMMDD) {
  const today = todayUTCYMD();
  return String(dateYYYYMMDD) < today;
}

function redactOddsUrl(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has("apiKey")) u.searchParams.set("apiKey", "REDACTED");
    return u.toString();
  } catch {
    return String(url || "").replace(/apiKey=([^&]+)/gi, "apiKey=REDACTED");
  }
}

function buildOddsUrlForDate(ymd, { historical = false } = {}) {
  const base = ODDS_API_BASE.replace(/\/$/, "");
  const sport = "basketball_nba";

  const common =
    `apiKey=${encodeURIComponent(ODDS_API_KEY)}` +
    `&regions=${encodeURIComponent(String(process.env.ODDS_REGIONS || "us"))}` +
    `&markets=${encodeURIComponent(String(process.env.ODDS_MARKETS || "h2h,spreads,totals"))}` +
    `&oddsFormat=${encodeURIComponent(String(process.env.ODDS_ODDS_FORMAT || "american"))}` +
    `&dateFormat=iso` +
    `&bookmakers=${encodeURIComponent(ODDS_BOOKMAKER)}`;

  if (historical) {
    const snap = `${ymd}T12:00:00Z`;
    return `${base}/historical/sports/${sport}/odds?date=${encodeURIComponent(snap)}&${common}`;
  }

  const { startIso, endIso } = ymdToOddsIsoRange(ymd);
  return (
    `${base}/sports/${sport}/odds` +
    `?${common}` +
    `&commenceTimeFrom=${encodeURIComponent(startIso)}` +
    `&commenceTimeTo=${encodeURIComponent(endIso)}`
  );
}

async function fetchNbaVegasForDate(ymd) {
  if (!ODDS_API_KEY) {
    return {
      ok: false,
      reason: "missing_odds_key",
      map: new Map(),
      meta: { url: null, events: null, bookmaker: ODDS_BOOKMAKER, sampleKeys: null },
    };
  }

  const isPast = isPastDateUTC(ymd);

  // ✅ Premium guard: avoid paid-only historical call unless explicitly enabled
  if (isPast && !ODDS_ALLOW_HISTORICAL) {
    const urlWouldBe = buildOddsUrlForDate(ymd, { historical: true });
    return {
      ok: false,
      reason: "historical_disabled_for_past_dates",
      map: new Map(),
      meta: {
        url: redactOddsUrl(urlWouldBe),
        events: null,
        bookmaker: ODDS_BOOKMAKER,
        sampleKeys: null,
        shape: "historical",
      },
    };
  }

  const url = buildOddsUrlForDate(ymd, { historical: isPast });

  // keep this snappy: 1 retry, hard 7s timeout
  const data = await fetchJson(
    url,
    {},
    { cacheTtlMs: HEAVY_CACHE_TTL_MS, retries: 1, timeoutMs: 7_000, hostConcurrency: 1 }
  ).catch((e) => ({ __error: String(e?.message || e) }));

  // ✅ normalize common paid-plan error
  if (
    data?.__error &&
    String(data.__error).includes("HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN")
  ) {
    return {
      ok: false,
      reason: "historical_unavailable_on_free_plan",
      map: new Map(),
      meta: {
        url: redactOddsUrl(url),
        events: null,
        bookmaker: ODDS_BOOKMAKER,
        sampleKeys: null,
        shape: "historical",
      },
    };
  }

  if (data?.__error && String(data.__error).includes("INVALID_COMMENCE_TIME_FROM")) {
    return {
      ok: false,
      reason: "invalid_commence_time_from",
      map: new Map(),
      meta: { url: redactOddsUrl(url), events: null, bookmaker: ODDS_BOOKMAKER, sampleKeys: null },
    };
  }

  if (!data || data.__error) {
    return {
      ok: false,
      reason: data?.__error || "odds_fetch_failed",
      map: new Map(),
      meta: { url: redactOddsUrl(url), events: null, bookmaker: ODDS_BOOKMAKER, sampleKeys: null },
    };
  }

  // ✅ Live endpoint returns array; historical endpoint returns { data: [...] }
  const eventsArray = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  const map = new Map();
  let matched = 0;
  const sampleKeys = [];

  for (const ev of eventsArray) {
    const home = normTeamName(ev?.home_team);
    const away = normTeamName(ev?.away_team);
    if (!home || !away) continue;

    const bks = Array.isArray(ev?.bookmakers) ? ev.bookmakers : [];
    const bk =
      bks.find((b) => String(b?.key || "").toLowerCase() === ODDS_BOOKMAKER) || bks[0] || null;

    const markets = Array.isArray(bk?.markets) ? bk.markets : [];

    const out = {
      bookmaker: bk?.key || ODDS_BOOKMAKER,
      lastUpdate: bk?.last_update || null,
      h2h: null,
      spreads: null,
      totals: null,
    };

    const h2h = markets.find((m) => m?.key === "h2h");
    if (h2h?.outcomes?.length >= 2) {
      const oHome = h2h.outcomes.find((o) => normTeamName(o?.name) === home);
      const oAway = h2h.outcomes.find((o) => normTeamName(o?.name) === away);
      const pHomeRaw = americanToImpliedProb(oHome?.price);
      const pAwayRaw = americanToImpliedProb(oAway?.price);
      const nv = normalizeNoVig(pHomeRaw, pAwayRaw);
      out.h2h = {
        home: oHome?.price ?? null,
        away: oAway?.price ?? null,
        pHome: nv.pA,
        pAway: nv.pB,
        vig: nv.vig,
      };
    }

    const sp = markets.find((m) => m?.key === "spreads");
    if (sp?.outcomes?.length >= 2) {
      const oHome = sp.outcomes.find((o) => normTeamName(o?.name) === home);
      const oAway = sp.outcomes.find((o) => normTeamName(o?.name) === away);
      out.spreads = {
        homeSpread: Number.isFinite(Number(oHome?.point)) ? Number(oHome.point) : null,
        awaySpread: Number.isFinite(Number(oAway?.point)) ? Number(oAway.point) : null,
        homePrice: oHome?.price ?? null,
        awayPrice: oAway?.price ?? null,
      };
    }

    const tt = markets.find((m) => m?.key === "totals");
    if (tt?.outcomes?.length >= 2) {
      const oOver = tt.outcomes.find((o) => String(o?.name || "").toLowerCase() === "over");
      const oUnder = tt.outcomes.find((o) => String(o?.name || "").toLowerCase() === "under");
      out.totals = {
        total: Number.isFinite(Number(oOver?.point))
          ? Number(oOver.point)
          : Number.isFinite(Number(oUnder?.point))
            ? Number(oUnder.point)
            : null,
        overPrice: oOver?.price ?? null,
        underPrice: oUnder?.price ?? null,
      };
    }

    const k = `${home}|${away}`;
    map.set(k, out);
    matched++;
    if (sampleKeys.length < 6) sampleKeys.push(k);
  }

  return {
    ok: true,
    map,
    meta: {
      url: redactOddsUrl(url),
      events: matched,
      bookmaker: ODDS_BOOKMAKER,
      sampleKeys,
      shape: Array.isArray(data) ? "live" : Array.isArray(data?.data) ? "historical" : "unknown",
    },
  };
}

function lookupVegasNba(vegasMap, homeName, awayName) {
  if (!vegasMap || !(vegasMap instanceof Map)) return null;
  const key = `${normTeamName(homeName)}|${normTeamName(awayName)}`;
  return vegasMap.get(key) || null;
}

// shrink + clamp value edges so they stay in a believable NBA band.
function normalizeValueEdge(homeValueEdgeSigned) {
  const e = Number(homeValueEdgeSigned);
  if (!Number.isFinite(e)) return null;
  const shrunk = 0.55 * e;
  return clampNum(shrunk, -0.20, 0.20);
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

function readWindowFromReq(req, def, min, max) {
  const raw = req.query.windowDays ?? req.query.window ?? def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return clampNum(n, min, max);
}

function readModeFromReq(req) {
  const mode = String(req.query.mode || "").toLowerCase();
  const t = String(req.query.tournament || "").toLowerCase();
  const isTournament = mode === "tournament" || t === "1" || t === "true" || t === "yes";
  return { mode: isTournament ? "tournament" : "regular", tournament: isTournament };
}

// ✅ model version switch (A/B safe)
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

function toEspnYYYYMMDD(dateYYYYMMDD) {
  return dateYYYYMMDD.replaceAll("-", "");
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ESPN status normalization
 * IMPORTANT: our scorer treats only "Final" as completed.
 * ESPN scoreboard commonly uses state values: pre | in | post.
 */
function normalizeStatusForScoring(rawState) {
  const s = String(rawState || "").toLowerCase().trim();

  if (!s) return "Scheduled";

  // ESPN "post" = game ended (final)
  if (s === "post" || s === "final" || s.includes("final") || s.includes("post")) return "Final";

  if (s === "in" || s.includes("in progress") || s.includes("live")) return "In Progress";

  if (s === "pre" || s.includes("scheduled") || s.includes("preview")) return "Scheduled";

  // Fallback: preserve raw but never return empty
  return String(rawState) || "Scheduled";
}


/**
 * Premium decision helpers
 */
function confidenceFromEdge(edge, edgeScale, capLo = 0.52, capHi = 0.95) {
  if (!Number.isFinite(edge)) return 0.5;
  const p = 1 / (1 + Math.exp(-edge / edgeScale));
  return clampNum(p, capLo, capHi);
}

/**
 * NOTE: edge here is SIGNED HOME-side value edge:
 *  - edge > 0 means HOME value
 *  - edge < 0 means AWAY value
 */
function pickFromEdge(homeValueEdgeSigned, minEdgeForPick) {
  if (!Number.isFinite(homeValueEdgeSigned)) return { side: null, note: "invalid_edge" };
  if (Math.abs(homeValueEdgeSigned) < minEdgeForPick) return { side: null, note: "pass_toss_up" };
  return { side: homeValueEdgeSigned > 0 ? "home" : "away", note: "ok" };
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

/**
 * Why builder (structured)
 * ✅ edgeForPick is ALWAYS POSITIVE for picks (value for the recommended side)
 */
function buildWhyPanel({ pickSide, pickNote, edgeForPick, conf, deltas = [] }) {
  const bullets = [];

  if (!pickSide) {
    bullets.push(
      pickNote === "pass_toss_up"
        ? "Pass: edge not strong enough (toss-up)."
        : "Pass: insufficient signal."
    );
    if (Number.isFinite(edgeForPick)) bullets.push(`Edge: ${edgeForPick.toFixed(3)} (below threshold).`);
    return { headline: "PASS (no bet)", bullets: bullets.slice(0, 5), deltas: [] };
  }

  bullets.push(
    `Pick: ${pickSide.toUpperCase()} (edge ${Number.isFinite(edgeForPick) ? edgeForPick.toFixed(3) : "—"})`
  );
  if (Number.isFinite(conf)) bullets.push(`Confidence proxy: ${Math.round(conf * 100)}% (not a bar metric)`);

  const outDeltas = [];
  for (const d of deltas) {
    if (!d?.label) continue;
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

  for (const dd of outDeltas.slice(0, 3)) bullets.push(`${dd.label}: ${dd.display}`);

  return {
    headline: pickSide === "home" ? "Home side value" : "Away side value",
    bullets: bullets.slice(0, 6),
    deltas: outDeltas.slice(0, 6),
  };
}

/**
 * Unified game response builder
 * ✅ edgeForPick: always positive when pick exists, null for PASS
 * ✅ marketType/marketSide/marketLine/marketOdds added for frontend stability
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
  edgeForPick,
  conf,
  tier,
  whyPanel,
  factors,
  marketType = null,
  marketSide = null,
  marketLine = null,
  marketOdds = null,
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
      marketType,
      marketSide,
      marketLine,
      marketOdds,
      recommendedTeamId: recommended ? recommended.id : null,
      recommendedTeamName: recommended ? (recommended.abbr || recommended.name || "") : "",
      edge: recommended && Number.isFinite(edgeForPick) ? edgeForPick : null,
      tier,
      confidence: recommended ? conf : null, // PASS -> null
      winProb: recommended && Number.isFinite(factors?.winProb) ? factors.winProb : null,
    },
    why: whyPanel,
    factors: { league, ...factors },
  };
}

/**
 * Team IDs
 */
function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}
function toNcaamTeamId(espnTeamId) {
  return `ncaam-${String(espnTeamId || "")}`;
}
function toNhlTeamId(espnTeamId) {
  return `nhl-${String(espnTeamId || "")}`;
}

/**
 * Response helpers (premium contract stability)
 */
function addPredictionsAlias(out) {
  return { ...out, predictions: out.games };
}
function okWrap(league, date, out) {
  return {
    ok: true,
    league,
    date,
    count: Array.isArray(out?.games) ? out.games.length : 0,
    ...addPredictionsAlias(out),
  };
}
function errWrap({ league, date, windowDays, model, modelVersion, mode, error }) {
  return okWrap(league, date, {
    meta: {
      league,
      date,
      windowDays,
      model,
      modelVersion: modelVersion ?? null,
      mode,
      error: String(error || "unknown_error"),
      warnings: [],
      elapsedMs: 0,
    },
    games: [],
  });
}

/* =========================================================
   NBA — premium blended model
   ========================================================= */

function buildNbaDisplayName(teamObj, abbrFallback) {
  // Prefer full_name when present (best for Odds API matching),
  // else compose "City Name", else fallback to abbr.
  const full = String(teamObj?.full_name || "").trim();
  if (full) return full;

  const city = String(teamObj?.city || "").trim();
  const name = String(teamObj?.name || "").trim();
  const composed = `${city} ${name}`.trim();

  return composed || String(abbrFallback || "").trim() || "";
}

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
    const homeAbbr = g?.home_team?.abbreviation || null;
    const awayAbbr = g?.visitor_team?.abbreviation || null;

    // ✅ IMPORTANT: use full names so Odds API matching works
    const homeName = buildNbaDisplayName(g?.home_team, homeAbbr);
    const awayName = buildNbaDisplayName(g?.visitor_team, awayAbbr);

    const homeScore = typeof g?.home_team_score === "number" ? g.home_team_score : null;
    const awayScore = typeof g?.visitor_team_score === "number" ? g.visitor_team_score : null;

    const rawStatus = String(g?.status || "");
    const status = rawStatus.toLowerCase().includes("final") ? "Final" : rawStatus;

    return {
      gameId: `nba-${g.id}`,
      date: String(g?.date || "").slice(0, 10),
      status,
      home: {
        id: toNbaTeamId(homeAbbr),
        name: homeName || homeAbbr || "",
        abbr: homeAbbr,
        logo: sanitizeLogoUrl(nbaLogoFromAbbr(homeAbbr)),
        score: homeScore,
      },
      away: {
        id: toNbaTeamId(awayAbbr),
        name: awayName || awayAbbr || "",
        abbr: awayAbbr,
        logo: sanitizeLogoUrl(nbaLogoFromAbbr(awayAbbr)),
        score: awayScore,
      },
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
  const MAX_PAGES_PER_CHUNK = 15;

  const all = [];

  for (let i = 0; i < dates.length; i += CHUNK) {
    const chunk = dates.slice(i, i + CHUNK);
    const qs = chunk.map((d) => `dates[]=${encodeURIComponent(d)}`).join("&");

    let page = 1;
    while (page <= MAX_PAGES_PER_CHUNK) {
      const url = `${NBA_API_BASE}/games?per_page=100&page=${page}&${qs}`;
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
      if (pageRows.length < 100) break;

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

    let wins = 0,
      pf = 0,
      pa = 0;
    for (const g of games) {
      pf += g.my;
      pa += g.opp;
      if (g.my > g.opp) wins++;
    }

    const recentN = (n) => {
      const slice = games.slice(0, n);
      if (!slice.length) return { played: 0, winPct: null, margin: null };
      let w = 0,
        mp = 0;
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

// === NBA model helpers ===
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
  return clampNum(base + 0.06 * unc, 0.07, 0.13);
}

function nbaEdge_v1(home, away) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = 0.42;
  const wMargin = 0.28;
  const wR10 = 0.18;
  const wR5 = 0.12;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clampNum((home.marginPerGame - away.marginPerGame) / 12, -1, 1);
  const r10Diff = (safeNum(home.recent10?.winPct) ?? 0.5) - (safeNum(away.recent10?.winPct) ?? 0.5);
  const r5MarginScaled = clampNum(
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
  const marginDiff = clampNum((homeMargin - awayMargin) / 12, -1, 1);
  const r10Diff = clampNum(hR10 - aR10, -1, 1);
  const r5MarginDiff = clampNum((hR5m - aR5m) / 14, -1, 1);

  const wWin = 0.38;
  const wMargin = 0.32;
  const wR10 = 0.18;
  const wR5m = 0.12;

  const homeAdv = 0.012;

  return wWin * winDiff + wMargin * marginDiff + wR10 * r10Diff + wR5m * r5MarginDiff + homeAdv;
}

function nbaProbFromEdge_v2(edge, edgeScale = 0.11) {
  if (!Number.isFinite(edge)) return 0.5;
  return clampNum(sigmoid(edge / edgeScale), 0.33, 0.77);
}

/**
 * Pull a single “display market” for the recommended side (moneyline preferred).
 * Returns { marketType, marketSide, marketLine, marketOdds }
 */
function pickDisplayMarketFromVegas(vegasRow, pickSide) {
  if (!vegasRow || !pickSide) {
    return { marketType: "moneyline", marketSide: pickSide || null, marketLine: null, marketOdds: null };
  }

  // Prefer moneyline if present
  if (vegasRow?.h2h) {
    const odds = pickSide === "home" ? vegasRow.h2h.home : pickSide === "away" ? vegasRow.h2h.away : null;
    return { marketType: "moneyline", marketSide: pickSide, marketLine: null, marketOdds: odds ?? null };
  }

  // Spreads fallback
  if (vegasRow?.spreads) {
    const line = pickSide === "home" ? vegasRow.spreads.homeSpread : vegasRow.spreads.awaySpread;
    const odds = pickSide === "home" ? vegasRow.spreads.homePrice : vegasRow.spreads.awayPrice;
    return {
      marketType: "spread",
      marketSide: pickSide,
      marketLine: Number.isFinite(line) ? line : null,
      marketOdds: odds ?? null,
    };
  }

  // Totals fallback (we don’t pick totals, but keep contract stable)
  if (vegasRow?.totals) {
    return { marketType: "total", marketSide: null, marketLine: vegasRow.totals.total ?? null, marketOdds: null };
  }

  return { marketType: "moneyline", marketSide: pickSide, marketLine: null, marketOdds: null };
}

async function buildNbaPredictions(dateYYYYMMDD, windowDays, { modelVersion = "v2" } = {}) {
  const mv = String(modelVersion || "v2").toLowerCase() === "v1" ? "v1" : "v2";
  const key = `PRED:nba:${dateYYYYMMDD}:w${windowDays}:m${mv}`;

  return computeCached(key, HEAVY_CACHE_TTL_MS, async () => {
    const t0 = Date.now();

    const schedule = await getNbaGamesByDate(dateYYYYMMDD);
    if (!schedule.length) {
      return {
        meta: {
          league: "nba",
          date: dateYYYYMMDD,
          windowDays,
          model: mv === "v2" ? "NBA premium-v5-market-anchored" : "NBA premium-v3",
          modelVersion: mv,
          mode: "regular",
          note: "No NBA games scheduled.",
          vegasAnchoring: false,
          vegasBookmaker: mv === "v2" ? ODDS_BOOKMAKER : null,
          vegasOk: mv === "v2" ? false : null,
          vegasReason: mv === "v2" ? "no_games" : null,
          vegasEvents: null,
          vegasUrl: null,
          vegasSampleKeys: null,
          warnings: [],
          elapsedMs: Date.now() - t0,
        },
        games: [],
      };
    }

    const vegas =
      mv === "v2"
        ? await fetchNbaVegasForDate(dateYYYYMMDD)
        : { ok: false, map: new Map(), reason: "disabled", meta: {} };

    const vegasMap = vegas?.ok ? vegas.map : new Map();
    const warnings = [];

    if (mv === "v2" && !vegas?.ok) warnings.push(`Vegas anchoring disabled: ${String(vegas?.reason || "unknown")}`);

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

    const BASE_PICK_EDGE = 0.03;

    for (const g of schedule) {
      const homeS = teamStats.get(g.home.id) || { ok: false };
      const awayS = teamStats.get(g.away.id) || { ok: false };

      const statEdge = mv === "v2" ? nbaEdge_v2(homeS, awayS) : nbaEdge_v1(homeS, awayS);
      const pHomeModel = mv === "v2" ? nbaProbFromEdge_v2(statEdge, 0.11) : null;

      // ✅ Matches Odds API because g.home.name/g.away.name are full names
      const vegasRow = mv === "v2" ? lookupVegasNba(vegasMap, g.home.name, g.away.name) : null;
      const pHomeMkt = Number.isFinite(vegasRow?.h2h?.pHome) ? vegasRow.h2h.pHome : null;

      let pHomeAdj = pHomeModel;
      let anchorAlpha = 0;
      if (mv === "v2" && Number.isFinite(pHomeModel) && Number.isFinite(pHomeMkt)) {
        const gap = Math.abs(pHomeModel - pHomeMkt);
        anchorAlpha = gap <= 0.04 ? 0.65 : gap <= 0.08 ? 0.45 : 0.25;
        pHomeAdj = clampNum((1 - anchorAlpha) * pHomeModel + anchorAlpha * pHomeMkt, 0.35, 0.80);
      }

      const rawHomeValueEdge =
        Number.isFinite(pHomeAdj) && Number.isFinite(pHomeMkt)
          ? pHomeAdj - pHomeMkt
          : mv === "v2"
            ? pHomeAdj - 0.5
            : statEdge;

      const homeValueEdgeSigned = mv === "v2" ? normalizeValueEdge(rawHomeValueEdge) : statEdge;

      const MIN_EDGE_FOR_PICK =
        mv === "v2"
          ? Math.max(BASE_PICK_EDGE, pickThresholdFromUncertainty(homeS.played, awayS.played, BASE_PICK_EDGE))
          : 0.075;

      const pick = pickFromEdge(homeValueEdgeSigned, MIN_EDGE_FOR_PICK);

      const edgeForPick =
        pick.side === "home"
          ? Number.isFinite(homeValueEdgeSigned)
            ? homeValueEdgeSigned
            : null
          : pick.side === "away"
            ? Number.isFinite(homeValueEdgeSigned)
              ? -homeValueEdgeSigned
              : null
            : null;

      if (!pick.side) noPickCount++;

      let winProb = null;
      if (mv === "v2" && Number.isFinite(pHomeAdj)) {
        if (pick.side === "home") winProb = pHomeAdj;
        else if (pick.side === "away") winProb = 1 - pHomeAdj;
      }

      let conf = mv === "v2" ? 0.5 : confidenceFromEdge(homeValueEdgeSigned, 0.17, 0.53, 0.94);
      if (mv === "v2") {
        const wp = Number.isFinite(winProb) ? winProb : 0.5;
        const e = Number.isFinite(edgeForPick) ? edgeForPick : 0;
        conf = clampNum(0.52 + 0.9 * Math.abs(wp - 0.5) + 0.35 * e, 0.52, 0.88);
        if (wp < 0.55) conf = Math.min(conf, 0.60);
      }

      const deltas = [
        { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
        { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
        { label: "Recent10 win% diff", delta: (homeS.recent10?.winPct ?? 0.5) - (awayS.recent10?.winPct ?? 0.5), dp: 3 },
        { label: "Recent5 margin diff", delta: (homeS.recent5?.margin ?? 0) - (awayS.recent5?.margin ?? 0), dp: 2, suffix: " pts/g" },
        ...(mv === "v2" ? [{ label: "Pick threshold", delta: MIN_EDGE_FOR_PICK, dp: 3 }] : []),
        ...(mv === "v2" && Number.isFinite(pHomeMkt) ? [{ label: "Market win prob (home)", delta: pHomeMkt, dp: 3 }] : []),
        ...(mv === "v2" && Number.isFinite(pHomeAdj) ? [{ label: "Model win prob (home)", delta: pHomeAdj, dp: 3 }] : []),
      ];

      const whyPanel = buildWhyPanel({
        pickSide: pick.side,
        pickNote: pick.note,
        edgeForPick: Number.isFinite(edgeForPick) ? edgeForPick : null,
        conf,
        deltas,
      });

      let tier = "PASS";
      if (pick.side) {
        const e = Number.isFinite(edgeForPick) ? edgeForPick : 0;
        const wp = Number.isFinite(winProb) ? winProb : 0.5;
        if (e >= 0.09 && wp >= 0.62) tier = "ELITE";
        else if (e >= 0.06 && wp >= 0.58) tier = "STRONG";
        else tier = "LEAN";
      }

      const displayMarket = pickDisplayMarketFromVegas(vegasRow, pick.side);

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
          edgeForPick,
          conf,
          tier,
          whyPanel,
          marketType: displayMarket.marketType,
          marketSide: displayMarket.marketSide,
          marketLine: displayMarket.marketLine,
          marketOdds: displayMarket.marketOdds,
          factors: {
            windowDays,
            modelVersion: mv,
            edgeForPick,
            homeValueEdgeSigned,
            winProb: mv === "v2" ? winProb : null,
            vegas: mv === "v2" ? (vegasRow || null) : null,
            vegasAnchoring:
              mv === "v2" ? Boolean(vegasRow?.h2h && Number.isFinite(pHomeMkt) && anchorAlpha > 0) : false,
            vegasAlpha: mv === "v2" ? (anchorAlpha || 0) : 0,
            statEdge: mv === "v2" ? statEdge : null,
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
            pHomeModel: mv === "v2" ? pHomeModel : null,
            pHomeMarket: mv === "v2" ? pHomeMkt : null,
            pHomeAnchored: mv === "v2" ? pHomeAdj : null,
            note:
              mv === "v2"
                ? "NBA v2+: stat hybrid → probability + market (moneyline) anchoring + shrunk/clamped value edge + uncertainty-aware thresholds + winProb-gated tiers."
                : "NBA v1: win% + margin + recent 10 + recent 5 margin + small home adv. PASS discipline enabled.",
          },
        })
      );
    }

    // ✅ Promoted meta debugging fields so /api/predictions meta shows Vegas status
    return {
      meta: {
        league: "nba",
        date: dateYYYYMMDD,
        windowDays,
        model: mv === "v2" ? "NBA premium-v5-market-anchored" : "NBA premium-v3",
        modelVersion: mv,
        mode: "regular",
        noPickCount,

        // ✅ stable debug contract
        vegasOk: mv === "v2" ? Boolean(vegas?.ok) : null,
        vegasReason: mv === "v2" ? (vegas?.ok ? null : String(vegas?.reason || "unknown")) : null,
        vegasEvents: mv === "v2" ? (Number.isFinite(vegas?.meta?.events) ? vegas.meta.events : null) : null,
        vegasBookmaker: mv === "v2" ? (vegas?.meta?.bookmaker || ODDS_BOOKMAKER || null) : null,
        vegasUrl: mv === "v2" ? (vegas?.meta?.url || null) : null,
        vegasSampleKeys: mv === "v2" ? (Array.isArray(vegas?.meta?.sampleKeys) ? vegas.meta.sampleKeys : null) : null,

        // keep existing semantic field
        vegasAnchoring: mv === "v2" ? Boolean(vegas?.ok) : false,

        warnings,
        logo: countMissingLogos(games),
        elapsedMs: Date.now() - t0,
      },
      games,
    };
  });
}

/* =========================================================
   NHL — UNPAUSED (ESPN-based premium-conservative)
   ========================================================= */

function espnCompetitorScore(competitor) {
  const direct = safeNum(competitor?.score);
  if (Number.isFinite(direct)) return direct;

  const ls = Array.isArray(competitor?.linescores) ? competitor.linescores : null;
  if (ls && ls.length) {
    let sum = 0;
    let any = false;
    for (const row of ls) {
      const v = safeNum(row?.value ?? row?.displayValue ?? row?.score);
      if (Number.isFinite(v)) {
        sum += v;
        any = true;
      }
    }
    if (any) return sum;
  }
  return null;
}

function normalizeEspnNhlEventToGame(event) {
  const comp = event?.competitions?.[0];
  const competitors = comp?.competitors;
  if (!Array.isArray(competitors)) return null;

  const home = competitors.find((c) => c?.homeAway === "home") ?? null;
  const away = competitors.find((c) => c?.homeAway === "away") ?? null;

  const homeTeam = home?.team || null;
  const awayTeam = away?.team || null;

  const homeId = homeTeam?.id ? String(homeTeam.id) : null;
  const awayId = awayTeam?.id ? String(awayTeam.id) : null;
  if (!homeId || !awayId) return null;

  const pickLogo = (team) => {
    if (!team) return null;
    const fromArr = Array.isArray(team.logos) ? team.logos[0]?.href : null;
    const fromSingle = team.logo || null;
    return sanitizeLogoUrl(fromArr || fromSingle || espnNhlLogoFromTeamId(team.id));
  };

  const rawState = event?.status?.type?.state || event?.status?.type?.name || "scheduled";
  const normStatus = normalizeStatusForScoring(rawState);

  const homeScore = espnCompetitorScore(home);
  const awayScore = espnCompetitorScore(away);

  return {
    id: String(event?.id ?? `${homeId}-${awayId}-${event?.date ?? ""}`),
    date: event?.date ?? null,
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeScore,
    awayScore,
    homeName: homeTeam?.displayName || homeTeam?.shortDisplayName || "",
    awayName: awayTeam?.displayName || awayTeam?.shortDisplayName || "",
    homeAbbr: homeTeam?.abbreviation || "",
    awayAbbr: awayTeam?.abbreviation || "",
    homeLogo: pickLogo(homeTeam),
    awayLogo: pickLogo(awayTeam),
    status: normStatus,
  };
}

async function getNhlScoreboardByDate(dateYYYYMMDD) {
  const ymd = toEspnYYYYMMDD(dateYYYYMMDD);
  const url = `${ESPN_SITE_V2}/${ESPN_NHL_PATH}/scoreboard?dates=${encodeURIComponent(ymd)}`;
  const json = await fetchJson(
    url,
    {},
    {
      cacheTtlMs: HEAVY_CACHE_TTL_MS,
      retries: 5,
      baseBackoffMs: 650,
      hostConcurrency: 3,
      timeoutMs: 25_000,
    }
  );

  const events = Array.isArray(json?.events) ? json.events : [];
  return events.map(normalizeEspnNhlEventToGame).filter(Boolean);
}

async function getNhlSlate(dateYYYYMMDD) {
  return getNhlScoreboardByDate(dateYYYYMMDD);
}

async function getNhlHistory(endDateYYYYMMDD, historyDays) {
  const days = [];
  for (let i = historyDays; i >= 1; i--) days.push(addDaysUTC(endDateYYYYMMDD, -i));

  const POOL = 3;
  const out = [];
  let idx = 0;

  async function worker() {
    while (idx < days.length) {
      const myIdx = idx++;
      const d = days[myIdx];
      const dayRows = await getNhlScoreboardByDate(d);
      out.push(...dayRows);
      await sleep(35);
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, days.length) }, () => worker()));
  return out;
}

function buildNhlTeamStatsFromHistory(history, endDateYYYYMMDD, recentN = 10) {
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

    let wins = 0,
      pf = 0,
      pa = 0;
    for (const gg of games) {
      pf += gg.my;
      pa += gg.opp;
      if (gg.my > gg.opp) wins++;
    }

    const recent = games.slice(0, recentN);
    let rWins = 0,
      rMargin = 0;
    for (const gg of recent) {
      if (gg.my > gg.opp) rWins++;
      rMargin += gg.my - gg.opp;
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

function nhlEdge(home, away) {
  if (!home?.ok || !away?.ok) return NaN;

  const wWin = 0.48;
  const wMargin = 0.32;
  const wRecent = 0.20;

  const winDiff = home.winPct - away.winPct;
  const marginScaled = clampNum((home.marginPerGame - away.marginPerGame) / 3.2, -1, 1);
  const recentDiff =
    (Number.isFinite(home.recentWinPct) ? home.recentWinPct : 0.5) -
    (Number.isFinite(away.recentWinPct) ? away.recentWinPct : 0.5);

  const homeAdv = 0.012;
  return wWin * winDiff + wMargin * marginScaled + wRecent * recentDiff + homeAdv;
}

function nhlProbFromEdge(edge, edgeScale = 0.17) {
  if (!Number.isFinite(edge)) return 0.5;
  return clampNum(sigmoid(edge / edgeScale), 0.36, 0.74);
}

async function buildNhlPredictions(dateYYYYMMDD, windowDays) {
  const historyDays = clampNum(Number(windowDays) || 40, 14, 120);
  const key = `PRED:nhl:${dateYYYYMMDD}:w${historyDays}`;

  return computeCached(key, HEAVY_CACHE_TTL_MS, async () => {
    const t0 = Date.now();

    const slate = await getNhlSlate(dateYYYYMMDD);
    if (!slate.length) {
      return {
        meta: {
          league: "nhl",
          date: dateYYYYMMDD,
          windowDays: historyDays,
          model: "NHL premium-v2",
          mode: "regular",
          note: "No NHL games scheduled.",
          warnings: [],
          elapsedMs: Date.now() - t0,
        },
        games: [],
      };
    }

    const history = await getNhlHistory(dateYYYYMMDD, historyDays);
    const teamStats = buildNhlTeamStatsFromHistory(history, dateYYYYMMDD, 10);

    const games = [];
    let noPickCount = 0;

    const MIN_EDGE_FOR_PICK = 0.065;

    for (const g of slate) {
      const homeS = teamStats.get(g.homeTeamId) || { ok: false };
      const awayS = teamStats.get(g.awayTeamId) || { ok: false };

      const edgeSigned = nhlEdge(homeS, awayS);
      const pick = pickFromEdge(edgeSigned, MIN_EDGE_FOR_PICK);


      if (!pick.side) noPickCount++;

      const edgeForPick =
        pick.side === "home" ? Math.abs(edgeSigned) : pick.side === "away" ? Math.abs(edgeSigned) : null;

      const pHome = nhlProbFromEdge(edgeSigned, 0.17);
      const winProb = pick.side === "home" ? pHome : pick.side === "away" ? 1 - pHome : null;

      const conf = confidenceFromEdge(Math.abs(edgeSigned), 0.22, 0.52, 0.86);

      const homeObj = {
        id: toNhlTeamId(g.homeTeamId),
        name: g.homeName || "",
        abbr: g.homeAbbr || "",
        logo: sanitizeLogoUrl(g.homeLogo || espnNhlLogoFromTeamId(g.homeTeamId)),
        score: Number.isFinite(g.homeScore) ? g.homeScore : null,
      };

      const awayObj = {
        id: toNhlTeamId(g.awayTeamId),
        name: g.awayName || "",
        abbr: g.awayAbbr || "",
        logo: sanitizeLogoUrl(g.awayLogo || espnNhlLogoFromTeamId(g.awayTeamId)),
        score: Number.isFinite(g.awayScore) ? g.awayScore : null,
      };

      const deltas = [
        { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
        { label: "Goal margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " g/g" },
        { label: "Recent win% diff", delta: (homeS.recentWinPct ?? 0.5) - (awayS.recentWinPct ?? 0.5), dp: 3 },
        { label: "Pick threshold", delta: MIN_EDGE_FOR_PICK, dp: 3 },
      ];

      const whyPanel = buildWhyPanel({
        pickSide: pick.side,
        pickNote: pick.note,
        edgeForPick: Number.isFinite(edgeForPick) ? edgeForPick : null,
        conf,
        deltas,
      });

      let tier = "PASS";
      if (pick.side) {
        const e = Number.isFinite(edgeForPick) ? edgeForPick : 0;
        const wp = Number.isFinite(winProb) ? winProb : 0.5;
        if (e >= 0.10 && wp >= 0.62) tier = "ELITE";
        else if (e >= 0.08 && wp >= 0.58) tier = "STRONG";
        else tier = "LEAN";
      }

      games.push(
        toUnifiedGame({
          league: "nhl",
          gameId: `nhl-${g.id}`,
          date: dateYYYYMMDD,
          status: g.status || "scheduled",
          home: homeObj,
          away: awayObj,
          pickSide: pick.side,
          pickNote: pick.note,
          edgeForPick,
          conf,
          tier,
          whyPanel,
          marketType: "moneyline",
          marketSide: pick.side,
          marketLine: null,
          marketOdds: null,
          factors: {
            windowDays: historyDays,
            edgeForPick,
            homeEdgeSigned: edgeSigned,
            winProb: Number.isFinite(winProb) ? winProb : null,
            homeWinPct: homeS.winPct ?? null,
            awayWinPct: awayS.winPct ?? null,
            homeMarginPerGame: homeS.marginPerGame ?? null,
            awayMarginPerGame: awayS.marginPerGame ?? null,
            homeRecentWinPct: homeS.recentWinPct ?? null,
            awayRecentWinPct: awayS.recentWinPct ?? null,
            note:
              "NHL premium-v2: ESPN history → win% + goal margin + recent form + home advantage, with conservative pick threshold for variance control.",
          },
        })
      );
    }

    return {
      meta: {
        league: "nhl",
        date: dateYYYYMMDD,
        windowDays: historyDays,
        historyGamesFetched: history.length,
        noPickCount,
        model: "NHL premium-v2",
        mode: "regular",
        warnings: [],
        logo: countMissingLogos(games),
        elapsedMs: Date.now() - t0,
      },
      games,
    };
  });
}

/* =========================================================
   NCAAM — ESPN (premium)
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
    return sanitizeLogoUrl(fromArr || fromSingle || espnNcaamLogoFromTeamId(team.id));
  };

  const homeName = homeTeam?.displayName || homeTeam?.shortDisplayName || "";
  const awayName = awayTeam?.displayName || awayTeam?.shortDisplayName || "";

  const homeAbbr = homeTeam?.abbreviation || "";
  const awayAbbr = awayTeam?.abbreviation || "";

  const rawState = event?.status?.type?.state || event?.status?.type?.name || "scheduled";
  const normStatus = normalizeStatusForScoring(rawState);

  const homeScore = espnCompetitorScore(home);
  const awayScore = espnCompetitorScore(away);

  return {
    id: String(event?.id ?? `${homeId}-${awayId}-${event?.date ?? ""}`),
    date: event?.date ?? null,
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeScore,
    awayScore,
    homeName,
    awayName,
    homeAbbr,
    awayAbbr,
    homeLogo: pickLogo(homeTeam),
    awayLogo: pickLogo(awayTeam),
    neutralSite: Boolean(comp?.neutralSite),
    status: normStatus,
  };
}

async function getNcaamScoreboardByDate(dateYYYYMMDD) {
  const ymd = toEspnYYYYMMDD(dateYYYYMMDD);
  const url = `${ESPN_SITE_V2}/${ESPN_NCAAM_PATH}/scoreboard?dates=${encodeURIComponent(ymd)}`;
  const json = await fetchJson(
    url,
    {},
    {
      cacheTtlMs: HEAVY_CACHE_TTL_MS,
      retries: 5,
      baseBackoffMs: 650,
      hostConcurrency: 3,
      timeoutMs: 25_000,
    }
  );
  const events = Array.isArray(json?.events) ? json.events : [];
  return events.map(normalizeEspnEventToGame).filter(Boolean);
}

async function getNcaamSlate(dateYYYYMMDD) {
  const rows = await getNcaamScoreboardByDate(dateYYYYMMDD);
  return rows.filter((g) => g.homeTeamId && g.awayTeamId);
}

async function getNcaamHistory(endDateYYYYMMDD, historyDays) {
  const days = [];
  for (let i = historyDays; i >= 1; i--) days.push(addDaysUTC(endDateYYYYMMDD, -i));

  const POOL = 3;
  const out = [];
  let idx = 0;

  async function worker() {
    while (idx < days.length) {
      const myIdx = idx++;
      const d = days[myIdx];
      const dayRows = await getNcaamScoreboardByDate(d);
      out.push(...dayRows);
      await sleep(35);
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, days.length) }, () => worker()));
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

    let wins = 0,
      pf = 0,
      pa = 0;
    for (const gg of games) {
      pf += gg.my;
      pa += gg.opp;
      if (gg.my > gg.opp) wins++;
    }

    const recent = games.slice(0, recentN);
    let rWins = 0,
      rMargin = 0;
    for (const gg of recent) {
      if (gg.my > gg.opp) rWins++;
      rMargin += gg.my - gg.opp;
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
  const marginScaled = clampNum((home.marginPerGame - away.marginPerGame) / 14, -1, 1);

  const recentDiff =
    (Number.isFinite(home.recentWinPct) ? home.recentWinPct : 0.5) -
    (Number.isFinite(away.recentWinPct) ? away.recentWinPct : 0.5);

  const homeAdv = neutralSite || tournamentMode ? 0 : 0.018;
  return wWin * winDiff + wMargin * marginScaled + wRecent * recentDiff + homeAdv;
}


function ncaamProbFromEdge(edge, edgeScale = 0.23) {
  if (!Number.isFinite(edge)) return 0.5;
  // College variance is higher than NBA; keep bounds wider but sane.
  return clampNum(sigmoid(edge / edgeScale), 0.34, 0.78);
}

async function buildNcaamPredictions(dateYYYYMMDD, windowDays, { tournamentMode, modeLabel }) {
  const historyDays = clampNum(Number(windowDays) || 45, 14, 90);
  const key = `PRED:ncaam:${dateYYYYMMDD}:w${historyDays}:t${tournamentMode ? 1 : 0}`;

  return computeCached(key, HEAVY_CACHE_TTL_MS, async () => {
    const t0 = Date.now();

    const slate = await getNcaamSlate(dateYYYYMMDD);
    if (!slate.length) {
      return {
        meta: {
          league: "ncaam",
          date: dateYYYYMMDD,
          windowDays: historyDays,
          model: "NCAAM premium-v3",
          mode: modeLabel,
          note: "No NCAAM games scheduled.",
          warnings: [],
          elapsedMs: Date.now() - t0,
        },
        games: [],
      };
    }

    const history = await getNcaamHistory(dateYYYYMMDD, historyDays);
    const teamStats = buildNcaamTeamStatsFromHistory(history, dateYYYYMMDD, 10);

    const games = [];
    let noPickCount = 0;

    const BASE_MIN_EDGE = 0.095;
    const MIN_EDGE_FOR_PICK = tournamentMode ? 0.075 : BASE_MIN_EDGE;

    for (const g of slate) {
      const homeS = teamStats.get(g.homeTeamId) || { ok: false };
      const awayS = teamStats.get(g.awayTeamId) || { ok: false };

      const neutral = Boolean(g.neutralSite) || Boolean(tournamentMode);
      let edgeSigned = ncaamEdge(homeS, awayS, neutral, tournamentMode);

      const tentativePick = pickFromEdge(edgeSigned, MIN_EDGE_FOR_PICK);
      if (tournamentMode && tentativePick.side) {
        const homeUnderdog = (homeS.winPct ?? 0.5) < (awayS.winPct ?? 0.5);
        const awayUnderdog = (awayS.winPct ?? 0.5) < (homeS.winPct ?? 0.5);
        const pickedUnderdog =
          (tentativePick.side === "home" && homeUnderdog) ||
          (tentativePick.side === "away" && awayUnderdog);
        if (pickedUnderdog) edgeSigned = edgeSigned * 1.08;
      }

      const pick = pickFromEdge(edgeSigned, MIN_EDGE_FOR_PICK);
      const conf = confidenceFromEdge(Math.abs(edgeSigned), tournamentMode ? 0.24 : 0.22, 0.53, 0.92);

      const homeObj = {
        id: toNcaamTeamId(g.homeTeamId),
        name: g.homeName || "",
        abbr: g.homeAbbr || "",
        logo: sanitizeLogoUrl(g.homeLogo || espnNcaamLogoFromTeamId(g.homeTeamId)),
        score: Number.isFinite(g.homeScore) ? g.homeScore : null,
      };

      const awayObj = {
        id: toNcaamTeamId(g.awayTeamId),
        name: g.awayName || "",
        abbr: g.awayAbbr || "",
        logo: sanitizeLogoUrl(g.awayLogo || espnNcaamLogoFromTeamId(g.awayTeamId)),
        score: Number.isFinite(g.awayScore) ? g.awayScore : null,
      };

      if (!pick.side) noPickCount++;

      const edgeForPick =
        pick.side === "home" ? Math.abs(edgeSigned) : pick.side === "away" ? Math.abs(edgeSigned) : null;

      const deltas = [
        { label: "Win% diff (home-away)", delta: (homeS.winPct ?? 0.5) - (awayS.winPct ?? 0.5), dp: 3 },
        { label: "Margin diff", delta: (homeS.marginPerGame ?? 0) - (awayS.marginPerGame ?? 0), dp: 2, suffix: " pts/g" },
        { label: "Recent win% diff", delta: (homeS.recentWinPct ?? 0.5) - (awayS.recentWinPct ?? 0.5), dp: 3 },
        { label: "Neutral court", delta: neutral ? 1 : 0, dp: 0, suffix: neutral ? " (yes)" : " (no)" },
      ];

      const whyPanel = buildWhyPanel({
        pickSide: pick.side,
        pickNote: pick.note,
        edgeForPick: Number.isFinite(edgeForPick) ? edgeForPick : null,
        conf,
        deltas,
      });

      const tier = pick.side
        ? tierFromEdge(Math.abs(edgeSigned), { lean: MIN_EDGE_FOR_PICK, edge: tournamentMode ? 0.105 : 0.11 })
        : "PASS";

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
          edgeForPick,
          conf,
          tier,
          whyPanel,
          marketType: "moneyline",
          marketSide: pick.side,
          marketLine: null,
          marketOdds: null,
          factors: {
            windowDays: historyDays,
            edgeForPick,
            homeEdgeSigned: edgeSigned,
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
        logo: countMissingLogos(games),
        elapsedMs: Date.now() - t0,
      },
      games,
    };
  });
}

/**
 * Routes
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "predict", version: "predict-premium-v12-status-final" });
});

router.get("/nba/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 14, 3, 30);
  const modelVersion = readModelFromReq(req, "v2");

  try {
    const out = await buildNbaPredictions(date, windowDays, { modelVersion });
    return res.json(okWrap("nba", date, out));
  } catch (e) {
    return res.json(
      errWrap({
        league: "nba",
        date,
        windowDays,
        model: modelVersion === "v2" ? "NBA premium-v5-market-anchored" : "NBA premium-v3",
        modelVersion,
        mode: "regular",
        error: e?.message || e,
      })
    );
  }
});

router.get("/nhl/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 40, 14, 120);

  try {
    const out = await buildNhlPredictions(date, windowDays);
    return res.json(okWrap("nhl", date, out));
  } catch (e) {
    return res.json(
      errWrap({
        league: "nhl",
        date,
        windowDays,
        model: "NHL premium-v2",
        modelVersion: null,
        mode: "regular",
        error: e?.message || e,
      })
    );
  }
});

router.get("/ncaam/predict", async (req, res) => {
  const date = readDateFromReq(req);
  const windowDays = readWindowFromReq(req, 45, 14, 90);
  const { tournament, mode } = readModeFromReq(req);

  try {
    const out = await buildNcaamPredictions(date, windowDays, { tournamentMode: tournament, modeLabel: mode });
    return res.json(okWrap("ncaam", date, out));
  } catch (e) {
    return res.json(
      errWrap({
        league: "ncaam",
        date,
        windowDays,
        model: "NCAAM premium-v3",
        modelVersion: null,
        mode,
        error: e?.message || e,
      })
    );
  }
});

// ✅ keep frontend compatibility
router.get("/predictions", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = readDateFromReq(req);
  const { tournament, mode } = readModeFromReq(req);

  function findPickDeep(obj) {
    const seen = new Set();
    const stack = [obj];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (seen.has(cur)) continue;
      seen.add(cur);

      if (
        Object.prototype.hasOwnProperty.call(cur, "tier") &&
        Object.prototype.hasOwnProperty.call(cur, "confidence") &&
        Object.prototype.hasOwnProperty.call(cur, "edge")
      ) {
        return cur;
      }

      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
      } else {
        for (const v of Object.values(cur)) stack.push(v);
      }
    }
    return null;
  }

  function normalizePick(p) {
    if (!p || typeof p !== "object") {
      return {
        pick: null,
        recommendedTeamId: null,
        recommendedTeamName: "",
        edge: null,
        tier: "PASS",
        confidence: null,
        winProb: null,
      };
    }
    return {
      pick: p.pick ?? null,
      recommendedTeamId: p.recommendedTeamId ?? null,
      recommendedTeamName: p.recommendedTeamName ?? "",
      edge: p.edge ?? null,
      tier: p.tier ?? "PASS",
      confidence: p.confidence ?? null,
      winProb: p.winProb ?? null,
    };
  }

  function promoteOut(out) {
    const games = Array.isArray(out?.games) ? out.games : [];
    const promoted = games.map((g) => {
      const found = normalizePick(findPickDeep(g));
      return { ...g, pick: found };
    });
    return { ...(out || {}), games: promoted, predictions: promoted };
  }

  try {
    if (league === "nba") {
      const windowDays = readWindowFromReq(req, 14, 3, 30);
      const modelVersion = readModelFromReq(req, "v2");
      const out = await buildNbaPredictions(date, windowDays, { modelVersion });
      return res.json(okWrap("nba", date, promoteOut(out)));
    }
    if (league === "nhl") {
      const windowDays = readWindowFromReq(req, 40, 14, 120);
      const out = await buildNhlPredictions(date, windowDays);
      return res.json(okWrap("nhl", date, promoteOut(out)));
    }
    if (league === "ncaam") {
      const windowDays = readWindowFromReq(req, 45, 14, 90);
      const out = await buildNcaamPredictions(date, windowDays, {
        tournamentMode: tournament,
        modeLabel: mode,
      });
      return res.json(okWrap("ncaam", date, promoteOut(out)));
    }
    return res
      .status(400)
      .json({ ok: false, error: "Unsupported league. Use league=nba|nhl|ncaam", got: league });
  } catch (e) {
    return res.json({ ok: false, league, date, mode, error: String(e?.message || e), games: [], predictions: [] });
  }
});

// ✅ Export builders so /api/performance + cron can call them directly (no internal HTTP)
export { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions };

export default router;
