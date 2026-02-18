// legacy/apps/api/src/routes/games.js
import express from "express";

const router = express.Router();

const PORT = Number(process.env.PORT || 3001);
const SELF_BASE = `http://127.0.0.1:${PORT}`;

const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const ESPN_NHL_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";

function normalizeDateParam(dateLike) {
  const s = String(dateLike || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
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

function normalizePredictionsGames(league, payload, fallbackDate) {
  const list = safeArr(payload?.games);
  return list
    .map((g) => {
      const gameId = g?.gameId || g?.id || null;
      if (!gameId) return null;
      return {
        league,
        gameId: String(gameId),
        id: String(gameId),
        date: g?.date || fallbackDate,
        status: g?.status || g?.state || "",
        homeScore: g?.homeScore ?? g?.home?.score ?? null,
        awayScore: g?.awayScore ?? g?.away?.score ?? null,
        home: g?.home || g?.homeTeam || null,
        away: g?.away || g?.awayTeam || null,
      };
    })
    .filter(Boolean);
}

async function getEspnGames(league, ymd) {
  const espnDate = ymdToEspnDate(ymd);
  const base = league === "nhl" ? ESPN_NHL_SCOREBOARD : ESPN_NCAAM_SCOREBOARD;
  const sourceUrl = `${base}?dates=${encodeURIComponent(espnDate)}`;
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

      const gidPrefix = league === "nhl" ? "nhl" : "ncaam";
      const gameId = ev?.id ? `${gidPrefix}-${String(ev.id)}` : null;
      if (!gameId) return null;

      const home = {
        id: `${gidPrefix}-${String(homeT?.abbreviation || homeT?.id || "home").toLowerCase()}`,
        name: homeT?.displayName || homeT?.shortDisplayName || homeT?.abbreviation || "Home",
        abbr: homeT?.abbreviation || null,
        score: homeScore,
        espnTeamId: homeT?.id || null,
      };

      const away = {
        id: `${gidPrefix}-${String(awayT?.abbreviation || awayT?.id || "away").toLowerCase()}`,
        name: awayT?.displayName || awayT?.shortDisplayName || awayT?.abbreviation || "Away",
        abbr: awayT?.abbreviation || null,
        score: awayScore,
        espnTeamId: awayT?.id || null,
      };

      return {
        league,
        gameId,
        id: gameId,
        date: ymd,
        status,
        homeScore,
        awayScore,
        home,
        away,
      };
    })
    .filter(Boolean);

  return { games, sourceUrl };
}

// /api/games
router.get("/games", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();
  const league = String(req.query.league || "").toLowerCase().trim(); // optional filter

  let nbaGames = [];
  let nhlGames = [];
  let ncaamGames = [];
  let errors = { nba: null, nhl: null, ncaam: null };
  let sourceUrl = null;

  // NBA from premium predictions
  if (!league || league === "nba") {
    try {
      const j = await fetchJson(`${SELF_BASE}/api/predictions?league=nba&date=${encodeURIComponent(date)}`);
      nbaGames = normalizePredictionsGames("nba", j, date);
    } catch (e) {
      errors.nba = String(e?.message || e);
    }
  }

  // NHL from ESPN (breaks recursion permanently)
  if (!league || league === "nhl") {
    try {
      const out = await getEspnGames("nhl", date);
      nhlGames = out.games;
      sourceUrl = out.sourceUrl;
    } catch (e) {
      errors.nhl = String(e?.message || e);
    }
  }

  // NCAAM from ESPN
  if (!league || league === "ncaam") {
    try {
      const out = await getEspnGames("ncaam", date);
      ncaamGames = out.games;
      sourceUrl = out.sourceUrl;
    } catch (e) {
      errors.ncaam = String(e?.message || e);
    }
  }

  const games = [...nbaGames, ...nhlGames, ...ncaamGames];

  return res.json({
    ok: true,
    league: league || null,
    date,
    counts: { total: games.length, nba: nbaGames.length, nhl: nhlGames.length, ncaam: ncaamGames.length },
    games,
    errors,
    sourceUrl,
    note: "NBA via /api/predictions. NHL+NCAAM via ESPN scoreboard to avoid recursive fallbacks.",
  });
});

export default router;
