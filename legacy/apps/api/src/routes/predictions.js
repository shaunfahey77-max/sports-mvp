// legacy/apps/api/src/routes/predictions.js
import express from "express";

const router = express.Router();

const ESPN_NHL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";

/* =========================================================
   Helpers
   ========================================================= */
function normalizeDateParam(date) {
  if (!date) return null;
  const s = String(date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function normalizeLeague(league) {
  const l = String(league || "nba").trim().toLowerCase();
  if (l === "ncaab" || l === "cbb") return "ncaam";
  return l;
}

function ymdToEspnDate(ymd) {
  return String(ymd || "").replaceAll("-", "");
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      "user-agent": "sports-mvp/1.0 (+local dev)",
      accept: "application/json,text/plain,*/*",
    },
  }).finally(() => clearTimeout(t));

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || `Upstream ${res.status} for ${url}`;
    throw new Error(msg);
  }
  return json;
}

/* =========================================================
   NHL slate via ESPN (picks paused)
   ========================================================= */
async function getNhlSlateFromEspn(dateYYYYMMDD) {
  const espnDate = ymdToEspnDate(dateYYYYMMDD);
  const sourceUrl = `${ESPN_NHL_SCOREBOARD}?dates=${encodeURIComponent(espnDate)}`;
  const json = await fetchJson(sourceUrl);

  const events = safeArr(json?.events);

  const games = events
    .map((ev) => {
      const comp = safeArr(ev?.competitions)[0] || null;
      const competitors = safeArr(comp?.competitors);

      const homeC = competitors.find((c) => c?.homeAway === "home") || null;
      const awayC = competitors.find((c) => c?.homeAway === "away") || null;

      const homeT = homeC?.team || {};
      const awayT = awayC?.team || {};

      const homeScore = Number.isFinite(Number(homeC?.score)) ? Number(homeC.score) : null;
      const awayScore = Number.isFinite(Number(awayC?.score)) ? Number(awayC.score) : null;

      const status =
        comp?.status?.type?.description ||
        comp?.status?.type?.name ||
        ev?.status?.type?.description ||
        ev?.status?.type?.name ||
        "";

      const gameId = ev?.id ? `nhl-${String(ev.id)}` : null;
      if (!gameId) return null;

      const home = {
        id: `nhl-${String(homeT?.abbreviation || homeT?.id || "home").toLowerCase()}`,
        name: homeT?.displayName || homeT?.shortDisplayName || homeT?.abbreviation || "Home",
        abbr: homeT?.abbreviation || null,
        score: homeScore,
        espnTeamId: homeT?.id || null,
      };

      const away = {
        id: `nhl-${String(awayT?.abbreviation || awayT?.id || "away").toLowerCase()}`,
        name: awayT?.displayName || awayT?.shortDisplayName || awayT?.abbreviation || "Away",
        abbr: awayT?.abbreviation || null,
        score: awayScore,
        espnTeamId: awayT?.id || null,
      };

      return {
        league: "nhl",
        gameId,
        date: dateYYYYMMDD,
        status,
        home,
        away,
        homeScore,
        awayScore,
        // picks paused (premium contract still valid)
        market: {
          pick: null,
          recommendedTeamId: null,
          recommendedTeamName: null,
          winProb: null,
          confidence: null,
          edge: null,
        },
        result: null,
      };
    })
    .filter(Boolean);

  return { games, sourceUrl };
}

/* =========================================================
   ✅ Exported helper so cron can import directly (no HTTP)
   ========================================================= */
export async function getPredictionsFor({ league, date, model } = {}) {
  const lg = normalizeLeague(league);
  const ymd = normalizeDateParam(date) || todayUTCYYYYMMDD();
  const m = model ? String(model).trim().toLowerCase() : null;

  if (lg === "nba") {
    const predictMod = await import("./predict.js");
    const fn = predictMod.buildNbaPredictions;
    if (typeof fn !== "function") throw new Error("buildNbaPredictions not found in routes/predict.js");
    const out = await fn(ymd, 14, { modelVersion: m || "v2" });
    return { ok: true, league: "nba", date: ymd, meta: { source: "premium-predictions", model: m || "v2" }, games: out?.games || [] };
  }

  if (lg === "ncaam") {
    const ncaamMod = await import("./ncaamPredict.js");
    const fn = ncaamMod.buildNcaamEspnPredictions;
    if (typeof fn !== "function") throw new Error("buildNcaamEspnPredictions not found in routes/ncaamPredict.js");
    const payload = await fn(ymd);
    return { ok: true, league: "ncaam", date: ymd, meta: payload?.meta || { source: "espn-scoreboard" }, games: payload?.games || [] };
  }

  if (lg === "nhl") {
    const { games, sourceUrl } = await getNhlSlateFromEspn(ymd);
    return {
      ok: true,
      league: "nhl",
      date: ymd,
      meta: { source: "espn-scoreboard", model: m || "v1", sourceUrl, note: "NHL slate from ESPN; picks paused." },
      games,
    };
  }

  throw new Error(`Unsupported league: ${lg}`);
}

/* =========================================================
   Route: GET /api/predictions
   ========================================================= */
router.get("/predictions", async (req, res) => {
  try {
    const out = await getPredictionsFor({
      league: req.query.league,
      date: req.query.date,
      model: req.query.model,
    });
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
