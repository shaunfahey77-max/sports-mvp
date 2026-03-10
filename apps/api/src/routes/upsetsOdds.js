// apps/api/src/routes/upsetsOdds.js
import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

/**
 * Upsets Odds v2 — DraftKings moneyline (Odds API) + model overlay
 *
 * - Pulls two-sided moneyline from The Odds API (DraftKings) => true market underdog detection
 * - Caches results (memory + optional disk) to protect quota
 * - Optionally overlays model pick/confidence/tier from /api/predictions (single call per request)
 * - mode=strict requires model to pick the underdog (only when overlayModel=1)
 *
 * GET /api/upsetsOdds/ping
 * GET /api/upsetsOdds?league=ncaam|nba|nhl&date=YYYY-MM-DD&limit=20
 *
 * Query:
 * - league (default nba)
 * - date (default today, YYYY-MM-DD)
 * - limit (default 20, max 50)
 * - maxImplied (default 0.45)             // dog implied <= this
 * - overlayModel=1|0 (default 1)
 * - mode=watch|strict (default watch)
 * - ttlSec (default env ODDS_CACHE_TTL_SEC or 21600)
 */

const VERSION = "upsetsOdds-v2-dk-h2h-overlay";

const ODDS_API_BASE = (process.env.ODDS_API_BASE || "https://api.the-odds-api.com/v4").replace(
  /\/$/,
  ""
);
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const ODDS_BOOKMAKER = String(process.env.ODDS_BOOKMAKER || "draftkings").toLowerCase();
const ODDS_REGIONS = String(process.env.ODDS_REGIONS || "us").toLowerCase();
const ODDS_ODDS_FORMAT = String(process.env.ODDS_ODDS_FORMAT || "american").toLowerCase();
const DEFAULT_TTL_SEC = Number(process.env.ODDS_CACHE_TTL_SEC || 21600); // 6h
const DISK_CACHE_DIR = process.env.ODDS_CACHE_DIR ? String(process.env.ODDS_CACHE_DIR) : null;

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function asInt(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function asFloat(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function isRealProb(p) {
  return Number.isFinite(p) && p > 0 && p < 1;
}
function toAmericanOdds(x) {
  if (x == null) return null;
  const s = String(x).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}
function impliedProbFromAmerican(oddsAmerican) {
  const o = toAmericanOdds(oddsAmerican);
  if (o == null) return null;
  if (o > 0) return 100 / (o + 100);
  return -o / (-o + 100);
}
function makeMatchup(awayName, homeName) {
  const a = awayName || "AWAY";
  const h = homeName || "HOME";
  return `${a} @ ${h}`;
}

// Basic normalizer to reduce name mismatches between ESPN and Odds API.
// (Keep conservative — do not over-edit.)
function normTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/&/g, "and")
    .trim();
}
function matchupKeyFromNames(awayName, homeName) {
  return `${normTeamName(awayName)} @ ${normTeamName(homeName)}`;
}

function sportKeyForLeague(league) {
  const L = String(league || "").toLowerCase();
  if (L === "ncaam" || L === "ncaab" || L === "college") return "basketball_ncaab";
  if (L === "nba") return "basketball_nba";
  if (L === "nhl") return "icehockey_nhl";
  return "basketball_nba";
}

// Node 18+ has global fetch; fallback for older
async function safeFetch(url, opts) {
  if (typeof fetch === "function") return fetch(url, opts);
  const mod = await import("node-fetch");
  return mod.default(url, opts);
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await safeFetch(url, { signal: controller.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = j?.message || j?.error || `Request failed (${r.status})`;
      throw new Error(msg);
    }
    return j;
  } finally {
    clearTimeout(t);
  }
}

// Memory + optional disk cache
const memCache = new Map(); // key -> { ts, data }

function cacheKey({ sportKey, date, bookmaker, regions, oddsFormat }) {
  return `odds:${sportKey}:${date}:${bookmaker}:${regions}:${oddsFormat}`;
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_e) {}
}

function diskPathForKey(k) {
  if (!DISK_CACHE_DIR) return null;
  ensureDir(DISK_CACHE_DIR);
  return path.join(DISK_CACHE_DIR, `${k.replace(/[^a-zA-Z0-9:_-]/g, "_")}.json`);
}

function getFromCache(k, ttlSec) {
  const now = Date.now();

  const mem = memCache.get(k);
  if (mem && now - mem.ts <= ttlSec * 1000) return mem.data;

  const fp = diskPathForKey(k);
  if (fp) {
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.ts === "number" && now - parsed.ts <= ttlSec * 1000) {
        memCache.set(k, { ts: parsed.ts, data: parsed.data });
        return parsed.data;
      }
    } catch (_e) {}
  }

  return null;
}

function setCache(k, data) {
  const now = Date.now();
  memCache.set(k, { ts: now, data });

  const fp = diskPathForKey(k);
  if (fp) {
    try {
      fs.writeFileSync(fp, JSON.stringify({ ts: now, data }), "utf8");
    } catch (_e) {}
  }
}

function pickDraftKingsH2H(bookmakers) {
  if (!Array.isArray(bookmakers)) return null;

  const dk = bookmakers.find((b) => String(b?.key || "").toLowerCase() === ODDS_BOOKMAKER);
  if (!dk) return null;

  const markets = Array.isArray(dk?.markets) ? dk.markets : [];
  const h2h = markets.find((m) => String(m?.key || "").toLowerCase() === "h2h");
  if (!h2h) return null;

  const outcomes = Array.isArray(h2h?.outcomes) ? h2h.outcomes : [];
  return outcomes;
}

function oddsForTeam(outcomes, teamName) {
  if (!Array.isArray(outcomes) || !teamName) return null;
  const t = String(teamName).trim().toLowerCase();
  const o = outcomes.find((x) => String(x?.name || "").trim().toLowerCase() === t);
  return toAmericanOdds(o?.price);
}

/**
 * Model overlay: one call to /api/predictions, mapped by normalized matchup.
 * Stores: pick, confidence, tier, recommendedMarket, winProb (picked side if present)
 */
async function fetchModelOverlay(base, league, date) {
  const url =
    `${base}/api/predictions?league=${encodeURIComponent(league)}` + `&date=${encodeURIComponent(date)}` +
    `&date=${encodeURIComponent(date)}`;

  const pred = await fetchJson(url, 25000);
  const games = Array.isArray(pred?.games) ? pred.games : [];

  const map = new Map();
  for (const g of games) {
    const home = g?.home || g?.homeTeam || null;
    const away = g?.away || g?.awayTeam || null;
    if (!home?.name || !away?.name) continue;

    const mkt = g?.market || {};
    const key = matchupKeyFromNames(away.name, home.name);

    map.set(key, {
      gameId: g?.gameId || null,
      pick: String(mkt?.pick || "").toLowerCase() || null, // "home"|"away"|null
      confidence: Number.isFinite(Number(mkt?.confidence)) ? Number(mkt.confidence) : null,
      tier: mkt?.tier ?? null,
      recommendedMarket: mkt?.recommendedMarket ?? null,
      winProbPicked: Number.isFinite(Number(mkt?.winProb)) ? Number(mkt.winProb) : null,
    });
  }

  return map;
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "upsetsOdds", version: VERSION });
});

router.get("/", async (req, res) => {
  const t0 = Date.now();
  try {
    if (!ODDS_API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing ODDS_API_KEY in environment" });
    }

    const league = String(req.query.league || "nba").trim().toLowerCase();
    const date = String(req.query.date || iso(new Date())).slice(0, 10);

    const limit = clamp(asInt(req.query.limit, 20), 1, 50);
    const maxImplied = clamp(asFloat(req.query.maxImplied, 0.45), 0.05, 0.9);

    const overlayModel = String(req.query.overlayModel ?? "1") !== "0";
    const mode = String(req.query.mode || "watch").trim().toLowerCase(); // watch|strict
    const ttlSec = clamp(asInt(req.query.ttlSec, DEFAULT_TTL_SEC), 60, 86400);

    
    // bookmakers: default env ODDS_BOOKMAKER (draftkings)
    // set bookmakers=all to remove filter and accept any available book
    const bookmakersParam = String(req.query.bookmakers ?? ODDS_BOOKMAKER).trim().toLowerCase();
    const bookmakersQS = bookmakersParam === "all" ? "" : ("&bookmakers=" + encodeURIComponent(bookmakersParam));
const sportKey = sportKeyForLeague(league);

    // Use the same host the request hit (works local + deploy)
    const base = `${req.protocol}://${req.get("host")}`;

    // Overlay map
    let modelMap = null;
    let overlayOk = false;
    if (overlayModel) {
      try {
        modelMap = await fetchModelOverlay(base, league, date);
        overlayOk = true;
      } catch {
        modelMap = new Map();
        overlayOk = false;
      }
    } else {
      modelMap = new Map();
      overlayOk = false;
    }

    // Cache odds
    const ck = cacheKey({
      sportKey,
      date,
      bookmaker: bookmakersParam,
      regions: ODDS_REGIONS,
      oddsFormat: ODDS_ODDS_FORMAT,
    });

    let oddsData = getFromCache(ck, ttlSec);
    let fetched = false;

    if (!oddsData) {
      const url =
        `${ODDS_API_BASE}/sports/${encodeURIComponent(sportKey)}/odds` +
        `?regions=${encodeURIComponent(ODDS_REGIONS)}` +
        `&markets=h2h` +
        bookmakersQS +
        `&bookmakers=${encodeURIComponent(ODDS_BOOKMAKER)}` +
        `&oddsFormat=${encodeURIComponent(ODDS_ODDS_FORMAT)}` +
        `&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;

      oddsData = await fetchJson(url, 20000);
      setCache(ck, oddsData);
      fetched = true;
    }

    const events = Array.isArray(oddsData) ? oddsData : [];
    const rows = [];

    let eventsIn = 0;
    let eventsDateFiltered = 0;
    let skippedNoDkH2H = 0;
    let skippedNoTwoSided = 0;
    let overlayMatched = 0;
    let strictFiltered = 0;

    for (const ev of events) {
      eventsIn += 1;

      const commence = ev?.commence_time ? String(ev.commence_time) : null;
      const evDate = commence ? commence.slice(0, 10) : null;
      if (evDate !== date) continue;
      eventsDateFiltered += 1;

      const homeName = ev?.home_team || null;
      const awayName = ev?.away_team || null;
      if (!homeName || !awayName) continue;

      const outcomes = pickDraftKingsH2H(ev?.bookmakers);
      if (!outcomes) {
        skippedNoDkH2H += 1;
        continue;
      }

      const homeOdds = oddsForTeam(outcomes, homeName);
      const awayOdds = oddsForTeam(outcomes, awayName);

      if (homeOdds == null || awayOdds == null) {
        skippedNoTwoSided += 1;
        continue;
      }

      const pHome = impliedProbFromAmerican(homeOdds);
      const pAway = impliedProbFromAmerican(awayOdds);
      if (!isRealProb(pHome) || !isRealProb(pAway)) continue;

      const homeIsFav = pHome >= pAway;
      const favoriteSide = homeIsFav ? "home" : "away";
      const underdogSide = homeIsFav ? "away" : "home";

      const underdogOdds = underdogSide === "home" ? homeOdds : awayOdds;
      const favoriteOdds = favoriteSide === "home" ? homeOdds : awayOdds;

      const impliedUnderdog = impliedProbFromAmerican(underdogOdds);
      if (!isRealProb(impliedUnderdog)) continue;

      if (impliedUnderdog > maxImplied) continue;

      // Model overlay lookup
      const mKey = matchupKeyFromNames(awayName, homeName);
      const m = overlayModel ? modelMap.get(mKey) : null;
      const matched = !!m;

      if (matched) overlayMatched += 1;

      const modelPick = matched ? m.pick : null; // home|away|null
      const modelPickedUnderdog = matched ? modelPick === underdogSide : null;

      // strict mode only applies when overlayModel=1
      if (mode === "strict" && overlayModel) {
        if (!modelPickedUnderdog) {
          strictFiltered += 1;
          continue;
        }
      }

      const underdogTeamName = underdogSide === "home" ? homeName : awayName;
      const favoriteTeamName = favoriteSide === "home" ? homeName : awayName;

      // Score: prioritize (1) model picks dog (if available), (2) lower implied, (3) longer dog odds
      const score =
        (modelPickedUnderdog ? 5 : 0) +
        (1 - impliedUnderdog) * 10 +
        Math.max(0, underdogOdds > 0 ? underdogOdds / 200 : 0);

      const why = [];
      why.push(`Underdog implied: ${(impliedUnderdog * 100).toFixed(1)}%`);
      why.push(`Dog odds: ${underdogOdds > 0 ? `+${underdogOdds}` : `${underdogOdds}`}`);
      why.push(`Book: ${ODDS_BOOKMAKER}`);
      if (overlayModel) {
        why.push(matched ? "Model match: yes" : "Model match: no");
        if (matched && modelPick) why.push(`Model pick: ${modelPick.toUpperCase()}`);
        if (matched && Number.isFinite(m?.confidence)) why.push(`Model conf: ${m.confidence.toFixed(3)}`);
        if (matched && modelPickedUnderdog) why.push("Model picked underdog");
      }

      rows.push({
        id: ev?.id || `${sportKey}-${date}-${mKey}`,
        gameId: matched ? (m?.gameId || ev?.id || null) : (ev?.id || null),
        league,
        date,
        commenceTime: commence || null,
        matchup: makeMatchup(awayName, homeName),

        home: { name: homeName },
        away: { name: awayName },

        underdog: { name: underdogTeamName, isHome: underdogSide === "home" },
        favorite: { name: favoriteTeamName, isHome: favoriteSide === "home" },

        // Keep winProb for UI, but this is IMPLIED (market), not model
        winProb: impliedUnderdog,

        market: {
          moneyline: {
            homeOdds,
            awayOdds,
            underdogOdds,
            favoriteOdds,
            impliedUnderdog,
            bookmaker: bookmakersParam,
            regions: ODDS_REGIONS,
            oddsFormat: ODDS_ODDS_FORMAT,
            lastUpdate: ev?.bookmakers?.[0]?.last_update ?? ev?.last_update ?? null,
          },
        },

        pick: overlayModel
          ? {
              pickSide: modelPick || null,
              modelPickedUnderdog: modelPickedUnderdog,
              confidence: matched && Number.isFinite(m?.confidence) ? m.confidence : null,
              tier: matched ? (m?.tier ?? null) : null,
              recommendedMarket: matched ? (m?.recommendedMarket ?? null) : null,
              winProbPicked: matched && Number.isFinite(m?.winProbPicked) ? m.winProbPicked : null,
              overlayMatched: matched,
            }
          : {
              pickSide: null,
              modelPickedUnderdog: null,
              confidence: null,
              tier: null,
              recommendedMarket: null,
              winProbPicked: null,
              overlayMatched: false,
            },

        signals: {
          score,
          underdogSide,
          favoriteSide,
          sportKey,
          overlayModel: !!overlayModel,
          overlayOk,
          mode,
        },

        why,
      });
    }

    rows.sort((a, b) => (b?.signals?.score ?? 0) - (a?.signals?.score ?? 0));
    const trimmed = rows.slice(0, limit);

    return res.json({
      ok: true,
      league,
      date,
      limit,
      maxImplied,
      overlayModel: !!overlayModel,
      mode,
      count: trimmed.length,
      rows: trimmed,
      candidates: trimmed,
      meta: {
        sportKey,
        overlayOk,
        overlayMatched,
        fetchedFromApi: fetched,
        cacheKey: ck,
        ttlSec,
        eventsIn,
        eventsDateFiltered,
        skippedNoDkH2H,
        skippedNoTwoSided,
        strictFiltered,
        elapsedMs: Date.now() - t0,
        version: VERSION,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
