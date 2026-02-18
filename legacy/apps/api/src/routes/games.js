// legacy/apps/api/src/routes/games.js
import express from "express";

const router = express.Router();

const PORT = Number(process.env.PORT || 3001);
const SELF_BASE = `http://127.0.0.1:${PORT}`;

// ✅ ESPN public “site” API (WORKING host)
const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

/**
 * NOTE ON LINE COUNT:
 * The previous file had duplicated helpers and extra unused scaffolding.
 * This version is shorter on purpose, but it ADDS the critical fix:
 * - /api/games now returns {home, away, gameId} for EVERY league (incl. NCAAM),
 *   so your Home.jsx can merge predictions correctly.
 */

function normalizeDateParam(dateLike) {
  const s = String(dateLike || "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYYMMDD -> YYYY-MM-DD
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

function wantExpandTeams(req) {
  const v = String(req.query.expand || "").toLowerCase();
  return v === "teams" || v === "true" || v === "1";
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

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
  }

  return res.json();
}

/**
 * Normalize ANY league game into the "Home.jsx expects" shape:
 * {
 *   id, gameId, league, date, status,
 *   homeScore, awayScore,
 *   home: {id,name,abbr,score,logo?},
 *   away: {id,name,abbr,score,logo?}
 * }
 */
function normalizeGame({ league, id, date, status, home, away, homeScore, awayScore, extra = {} }) {
  return {
    league,
    id: String(id),
    gameId: String(id), // ✅ critical: merges predictions by gameId
    date,
    status: status || "",
    homeScore: homeScore ?? null,
    awayScore: awayScore ?? null,
    home: home || null,
    away: away || null,
    ...extra,
  };
}

/**
 * ✅ ESPN NCAAM games (normalized to unified + Home.jsx shape)
 */
async function getNcaamGamesFromEspn(dateYYYYMMDD, expandTeams) {
  const espnDate = ymdToEspnDate(dateYYYYMMDD);
  const sourceUrl = `${ESPN_NCAAM_SCOREBOARD}?dates=${encodeURIComponent(espnDate)}`;

  const json = await fetchJson(sourceUrl);
  const events = Array.isArray(json?.events) ? json.events : [];

  const games = events
    .map((ev) => {
      const comp = Array.isArray(ev?.competitions) ? ev.competitions[0] : null;
      const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];

      const homeC = competitors.find((c) => c?.homeAway === "home") || null;
      const awayC = competitors.find((c) => c?.homeAway === "away") || null;

      const homeTeam = homeC?.team || {};
      const awayTeam = awayC?.team || {};

      const homeAbbr = homeTeam?.abbreviation || null;
      const awayAbbr = awayTeam?.abbreviation || null;

      const homeScore = Number.isFinite(Number(homeC?.score)) ? Number(homeC.score) : null;
      const awayScore = Number.isFinite(Number(awayC?.score)) ? Number(awayC.score) : null;

      const status =
        comp?.status?.type?.description ||
        comp?.status?.type?.name ||
        ev?.status?.type?.description ||
        ev?.status?.type?.name ||
        "";

      const neutralSite = Boolean(comp?.neutralSite);
      const venueName = comp?.venue?.fullName || comp?.venue?.address?.city || null;

      const homeLogo = homeTeam?.id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${homeTeam.id}.png` : null;
      const awayLogo = awayTeam?.id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${awayTeam.id}.png` : null;

      // ✅ Canonical ID that matches predictions
      const gid = `ncaam-${ev?.id || `${awayAbbr || "away"}@${homeAbbr || "home"}-${dateYYYYMMDD}`}`;

      const home = expandTeams
        ? {
            id: `ncaam-${String(homeAbbr || homeTeam?.id || "home").toLowerCase()}`,
            name: homeTeam?.displayName || homeTeam?.shortDisplayName || homeAbbr || "Home",
            abbr: homeAbbr,
            score: homeScore,
            logo: homeLogo,
            espnTeamId: homeTeam?.id || null,
          }
        : {
            id: `ncaam-${String(homeAbbr || homeTeam?.id || "home").toLowerCase()}`,
            name: homeAbbr || homeTeam?.id || "HOME",
            abbr: homeAbbr,
            score: homeScore,
          };

      const away = expandTeams
        ? {
            id: `ncaam-${String(awayAbbr || awayTeam?.id || "away").toLowerCase()}`,
            name: awayTeam?.displayName || awayTeam?.shortDisplayName || awayAbbr || "Away",
            abbr: awayAbbr,
            score: awayScore,
            logo: awayLogo,
            espnTeamId: awayTeam?.id || null,
          }
        : {
            id: `ncaam-${String(awayAbbr || awayTeam?.id || "away").toLowerCase()}`,
            name: awayAbbr || awayTeam?.id || "AWAY",
            abbr: awayAbbr,
            score: awayScore,
          };

      return normalizeGame({
        league: "ncaam",
        id: gid,
        date: dateYYYYMMDD,
        status,
        home,
        away,
        homeScore,
        awayScore,
        extra: { neutralSite, venue: venueName, espnEventId: ev?.id || null },
      });
    })
    .filter(Boolean);

  return { games, sourceUrl };
}

/**
 * ✅ Normalize NBA/NHL local responses into the same shape
 */
function normalizeLocalLeagueGames(league, payload, fallbackDate) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.games) ? payload.games : [];

  return list
    .map((g) => {
      const id = g?.id || g?.gameId || g?.game_id || null;
      if (!id) return null;

      const date = g?.date || fallbackDate;

      // Support multiple shapes for expanded teams
      const homeTeam = g?.home || g?.homeTeam || null;
      const awayTeam = g?.away || g?.awayTeam || null;

      const homeId = homeTeam?.id || g?.homeTeamId || g?.home_team_id || null;
      const awayId = awayTeam?.id || g?.awayTeamId || g?.away_team_id || null;

      const home = {
        id: String(homeId || ""),
        name: homeTeam?.name || homeTeam?.abbr || String(homeId || "HOME"),
        abbr: homeTeam?.abbr || null,
        score: homeTeam?.score ?? g?.homeScore ?? null,
        logo: homeTeam?.logo || null,
      };

      const away = {
        id: String(awayId || ""),
        name: awayTeam?.name || awayTeam?.abbr || String(awayId || "AWAY"),
        abbr: awayTeam?.abbr || null,
        score: awayTeam?.score ?? g?.awayScore ?? null,
        logo: awayTeam?.logo || null,
      };

      const homeScore = g?.homeScore ?? home?.score ?? null;
      const awayScore = g?.awayScore ?? away?.score ?? null;

      return normalizeGame({
        league,
        id: String(id),
        date,
        status: g?.status || "",
        home,
        away,
        homeScore,
        awayScore,
      });
    })
    .filter(Boolean);
}

/**
 * ✅ /api/ncaam/games — ESPN source
 */
router.get("/ncaam/games", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();
  const expandTeams = wantExpandTeams(req);

  try {
    const { games, sourceUrl } = await getNcaamGamesFromEspn(date, expandTeams);

    return res.json({
      ok: true,
      date,
      counts: { total: games.length, ncaam: games.length },
      games,
      errors: { ncaam: null },
      expandTeams,
      source: "espn-scoreboard",
      sourceUrl,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      date,
      counts: null,
      games: [],
      errors: { ncaam: String(e?.message || e) },
      expandTeams,
      source: "espn-scoreboard",
      sourceUrl: null,
    });
  }
});

/**
 * ✅ /api/games — unified
 * Always returns games normalized to {home,away,gameId}.
 */
router.get("/games", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();
  const expandTeams = wantExpandTeams(req);
  const league = String(req.query.league || "").toLowerCase().trim(); // optional filter

  let nbaGames = [];
  let nhlGames = [];
  let ncaamGames = [];

  let nbaError = null;
  let nhlError = null;
  let ncaamError = null;

  let ncaamSourceUrl = null;

  if (!league || league === "nba") {
    try {
      const url = `${SELF_BASE}/api/nba/games?date=${encodeURIComponent(date)}&expand=${expandTeams ? "teams" : "0"}`;
      const j = await fetchJson(url);
      nbaGames = normalizeLocalLeagueGames("nba", j, date);
    } catch (e) {
      nbaError = String(e?.message || e);
    }
  }

  if (!league || league === "nhl") {
    try {
      const url = `${SELF_BASE}/api/nhl/games?date=${encodeURIComponent(date)}&expand=${expandTeams ? "teams" : "0"}`;
      const j = await fetchJson(url);
      nhlGames = normalizeLocalLeagueGames("nhl", j, date);
    } catch (e) {
      nhlError = String(e?.message || e);
    }
  }

  if (!league || league === "ncaam") {
    try {
      const out = await getNcaamGamesFromEspn(date, expandTeams);
      ncaamGames = out.games;
      ncaamSourceUrl = out.sourceUrl;
    } catch (e) {
      ncaamError = String(e?.message || e);
    }
  }

  const games = [...nbaGames, ...nhlGames, ...ncaamGames];

  return res.json({
    ok: true,
    date,
    counts: {
      total: games.length,
      nba: nbaGames.length,
      nhl: nhlGames.length,
      ncaam: ncaamGames.length,
    },
    games,
    errors: { nba: nbaError, nhl: nhlError, ncaam: ncaamError },
    expandTeams,
    note: "NCAAM via ESPN scoreboard. NBA/NHL via local endpoints. All games normalized to {home,away,gameId}.",
    sourceUrl: ncaamSourceUrl,
  });
});

export default router;
