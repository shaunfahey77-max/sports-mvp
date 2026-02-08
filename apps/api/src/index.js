// apps/api/src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ✅ sanity route (proves we’re running THIS file)
app.get("/__ping", (_req, res) =>
  res.json({ ok: true, from: "apps/api/src/index.js" })
);

/**
 * Config
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";
const NHL_API_BASE = "https://api-web.nhle.com/v1";

/**
 * Caching
 * - short TTL for live pages
 * - longer TTL for heavy history pulls
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

async function fetchJson(url, { headers } = {}, { cacheTtlMs = CACHE_TTL_MS } = {}) {
  const cacheKey = `GET:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, { headers });

  // Handle rate limit explicitly
  if (res.status === 429) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Upstream 429 for ${url}${text ? ` — ${text}` : ""} — Too many requests, please try again later.`
    );
    err.status = 429;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Upstream error ${res.status} for ${url}${text ? ` — ${text}` : ""}`
    );
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  setCache(cacheKey, data, cacheTtlMs);
  return data;
}

/**
 * Helpers
 */
function normalizeDateParam(date) {
  if (!date) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return ok ? date : null;
}
function toNbaTeamId(abbr) {
  return `nba-${String(abbr || "").toLowerCase()}`;
}
function toNhlTeamId(triCode) {
  return `nhl-${String(triCode || "").toLowerCase()}`;
}
function wantExpandTeams(req) {
  const v = String(req.query.expand || "").toLowerCase();
  return v === "teams" || v === "true" || v === "1";
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function addDays(yyyyMmDd, deltaDays) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * =========================================
 * Elo (Premium MVP, free)
 * =========================================
 */
const ELO_BASE = 1500;

const ELO_CFG = {
  nba: { K: 20, HOME_ADV: 65 },
  nhl: { K: 18, HOME_ADV: 55 },
};

function eloExpected(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

function eloMovMultiplier(scoreDiff) {
  const d = Math.max(1, Number(scoreDiff) || 1);
  return Math.log(d + 1);
}

function eloUpdatePair({ rHome, rAway, homeScore, awayScore, cfg }) {
  const diff = Math.abs((homeScore ?? 0) - (awayScore ?? 0));
  const mov = eloMovMultiplier(diff);

  const expectedHome = eloExpected(rHome, rAway);

  let actualHome = 0.5;
  if (homeScore > awayScore) actualHome = 1;
  else if (homeScore < awayScore) actualHome = 0;

  const kAdj = clamp(cfg.K * mov, cfg.K * 0.75, cfg.K * 2.5);
  const delta = kAdj * (actualHome - expectedHome);

  return {
    rHomeNew: rHome + delta,
    rAwayNew: rAway - delta,
    expectedHome,
  };
}

function getRating(map, teamId) {
  return map.has(teamId) ? map.get(teamId) : ELO_BASE;
}

function probToConfidence(pHome, pick) {
  const p = pick === "home" ? pHome : 1 - pHome;
  return clamp(p, 0.51, 0.97);
}

/**
 * =========================================
 * Rest / Back-to-back adjustment
 * =========================================
 */
const REST_CFG = {
  nba: { b2bPenaltyElo: 25, threeInFourPenaltyElo: 15, longRestBonusElo: 8 },
  nhl: { b2bPenaltyElo: 20, threeInFourPenaltyElo: 12, longRestBonusElo: 6 },
};

function ymdToUtcMs(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getTime();
}
function daysBetweenUtc(ymdA, ymdB) {
  const a = ymdToUtcMs(ymdA);
  const b = ymdToUtcMs(ymdB);
  return Math.round((b - a) / 86400000);
}

function buildPlayedDatesMap({ league, histRows }) {
  const played = new Map();

  const add = (teamId, dateYmd) => {
    if (!teamId || !dateYmd) return;
    if (!played.has(teamId)) played.set(teamId, new Set());
    played.get(teamId).add(dateYmd);
  };

  if (league === "nba") {
    for (const g of histRows) {
      const hs = g?.home_team_score;
      const as = g?.visitor_team_score;
      if (typeof hs !== "number" || typeof as !== "number") continue;
      const dateYmd = String(g?.date || "").slice(0, 10);
      const homeId = toNbaTeamId(g?.home_team?.abbreviation);
      const awayId = toNbaTeamId(g?.visitor_team?.abbreviation);
      add(homeId, dateYmd);
      add(awayId, dateYmd);
    }
  } else {
    for (const g of histRows) {
      const hs = g?.homeScore;
      const as = g?.awayScore;
      if (typeof hs !== "number" || typeof as !== "number") continue;
      const dateYmd = String(g?.date || "");
      add(g?.homeTeamId, dateYmd);
      add(g?.awayTeamId, dateYmd);
    }
  }

  const out = new Map();
  for (const [teamId, set] of played.entries()) {
    out.set(teamId, [...set].sort());
  }
  return out;
}

function workloadForTeam(playedDatesArr, dateYmd) {
  if (!playedDatesArr || playedDatesArr.length === 0) {
    return { restDays: null, gamesLast4: 0, playedYesterday: false };
  }

  const yesterday = addDays(dateYmd, -1);
  const windowStart = addDays(dateYmd, -4);

  let gamesLast4 = 0;
  let playedYesterday = false;

  for (const d of playedDatesArr) {
    if (d >= windowStart && d <= yesterday) gamesLast4 += 1;
    if (d === yesterday) playedYesterday = true;
  }

  const lastPlayed = playedDatesArr[playedDatesArr.length - 1];
  const restDays = lastPlayed ? daysBetweenUtc(lastPlayed, dateYmd) - 1 : null;

  return { restDays, gamesLast4, playedYesterday };
}

function restEloAdjustment(league, workload) {
  const cfg = REST_CFG[league] || REST_CFG.nba;
  let adj = 0;

  if (workload.playedYesterday) adj -= cfg.b2bPenaltyElo;
  if (workload.gamesLast4 >= 3) adj -= cfg.threeInFourPenaltyElo;
  if (workload.restDays != null && workload.restDays >= 2) adj += cfg.longRestBonusElo;

  return clamp(adj, -40, 20);
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

async function getNbaGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  if (!NBA_API_KEY) {
    throw new Error("Missing NBA_API_KEY. Add it to apps/api/.env to enable NBA live data.");
  }

  const cacheKey = `NBA_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const all = [];
  const perPage = 100;

  for (let page = 1; page <= 10; page++) {
    const url =
      `${NBA_API_BASE}/games?per_page=${perPage}` +
      `&page=${page}` +
      `&start_date=${encodeURIComponent(startYYYYMMDD)}` +
      `&end_date=${encodeURIComponent(endYYYYMMDD)}`;

    const json = await fetchJson(
      url,
      { headers: { Authorization: NBA_API_KEY } },
      { cacheTtlMs: HEAVY_CACHE_TTL_MS }
    );

    const rows = json?.data || [];
    all.push(...rows);

    if (rows.length < perPage) break;
    await sleep(150);
  }

  setCache(cacheKey, all, HEAVY_CACHE_TTL_MS);
  return all;
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

async function getNhlGamesInRange(startYYYYMMDD, endYYYYMMDD) {
  const cacheKey = `NHL_RANGE:${startYYYYMMDD}:${endYYYYMMDD}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const all = [];
  let cur = startYYYYMMDD;

  for (let i = 0; i < 40_000; i++) {
    const games = await getNhlGamesByDate(cur, true);
    all.push(...games);

    if (cur === endYYYYMMDD) break;
    cur = addDays(cur, 1);
    await sleep(120);
  }

  setCache(cacheKey, all, HEAVY_CACHE_TTL_MS);
  return all;
}

/**
 * Predict payload builders
 */
async function buildNbaPredictPayload(date, windowDays) {
  const cfg = ELO_CFG.nba;

  const endHist = addDays(date, -1);
  const startHist = addDays(endHist, -(windowDays - 1));

  const meta = {
    league: "nba",
    date,
    windowDays,
    historyStart: startHist,
    historyEnd: endHist,
    model: "Elo (window-trained) + rest",
    note:
      "Elo ratings trained on recent completed games; predicts win probability with home advantage + rest/back-to-back adjustments.",
  };

  try {
    const todaysGames = await getNbaGamesByDate(date, true);
    const histRows = await getNbaGamesInRange(startHist, endHist);
    const playedMap = buildPlayedDatesMap({ league: "nba", histRows });

    const hist = [...histRows].sort((a, b) => {
      const ad = new Date(a?.date || 0).getTime();
      const bd = new Date(b?.date || 0).getTime();
      return ad - bd;
    });

    const ratings = new Map();
    let trainedGames = 0;

    for (const g of hist) {
      const hs = g?.home_team_score;
      const as = g?.visitor_team_score;
      if (typeof hs !== "number" || typeof as !== "number") continue;

      const homeAbbr = g?.home_team?.abbreviation;
      const awayAbbr = g?.visitor_team?.abbreviation;
      if (!homeAbbr || !awayAbbr) continue;

      const homeId = toNbaTeamId(homeAbbr);
      const awayId = toNbaTeamId(awayAbbr);

      const rHome = getRating(ratings, homeId) + cfg.HOME_ADV;
      const rAway = getRating(ratings, awayId);

      const { rHomeNew, rAwayNew } = eloUpdatePair({
        rHome,
        rAway,
        homeScore: hs,
        awayScore: as,
        cfg,
      });

      ratings.set(homeId, rHomeNew - cfg.HOME_ADV);
      ratings.set(awayId, rAwayNew);

      trainedGames += 1;
    }

    const predictions = todaysGames.map((g) => {
      const homeAbbr =
        g?.homeTeam?.abbr || (g.homeTeamId || "").replace("nba-", "").toUpperCase();
      const awayAbbr =
        g?.awayTeam?.abbr || (g.awayTeamId || "").replace("nba-", "").toUpperCase();

      const homeId = g.homeTeamId || toNbaTeamId(homeAbbr);
      const awayId = g.awayTeamId || toNbaTeamId(awayAbbr);

      const homeWork = workloadForTeam(playedMap.get(homeId), date);
      const awayWork = workloadForTeam(playedMap.get(awayId), date);

      const homeRestAdj = restEloAdjustment("nba", homeWork);
      const awayRestAdj = restEloAdjustment("nba", awayWork);

      const rHomeBase = getRating(ratings, homeId);
      const rAwayBase = getRating(ratings, awayId);

      const rHome = rHomeBase + cfg.HOME_ADV + homeRestAdj;
      const rAway = rAwayBase + awayRestAdj;

      const pHome = eloExpected(rHome, rAway);

      const pick = pHome >= 0.5 ? "home" : "away";
      const winnerTeamId = pick === "home" ? homeId : awayId;
      const winnerName = pick === "home" ? homeAbbr : awayAbbr;
      const confidence = probToConfidence(pHome, pick);

      return {
        gameId: g.id,
        date,
        status: g.status,
        home: { id: homeId, abbr: homeAbbr, name: homeAbbr },
        away: { id: awayId, abbr: awayAbbr, name: awayAbbr },
        prediction: {
          winnerTeamId,
          winnerName,
          confidence,
          factors: {
            model: "elo+rest",
            windowDays,
            pHomeWin: pHome,
            rHome,
            rAway,
            rHomeBase,
            rAwayBase,
            homeAdv: cfg.HOME_ADV,
            rest: {
              home: homeWork,
              away: awayWork,
              homeRestAdj,
              awayRestAdj,
            },
            trainedGames,
          },
        },
      };
    });

    return {
      meta: {
        ...meta,
        historyGamesFetched: histRows.length,
        historyGamesWithScores: trainedGames,
        teamsRated: ratings.size,
      },
      predictions,
    };
  } catch (e) {
    return {
      meta: {
        ...meta,
        error: String(e?.message || e),
        note: "NBA Elo predict returned safely with error info.",
      },
      predictions: [],
    };
  }
}

async function buildNhlPredictPayload(date, windowDays = 5) {
  const cfg = ELO_CFG.nhl;

  const endHist = addDays(date, -1);
  const startHist = addDays(endHist, -(windowDays - 1));

  const meta = {
    league: "nhl",
    date,
    windowDays,
    historyStart: startHist,
    historyEnd: endHist,
    model: "Elo (window-trained) + rest",
    note:
      "Elo ratings trained on recent completed games; predicts win probability with home ice advantage + rest/back-to-back adjustments.",
  };

  try {
    const histGames = await getNhlGamesInRange(startHist, endHist);
    const playedMap = buildPlayedDatesMap({ league: "nhl", histRows: histGames });

    const hist = [...histGames].sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const ratings = new Map();
    let trainedGames = 0;

    for (const g of hist) {
      const hs = g?.homeScore;
      const as = g?.awayScore;
      if (typeof hs !== "number" || typeof as !== "number") continue;

      const homeId = g.homeTeamId;
      const awayId = g.awayTeamId;
      if (!homeId || !awayId) continue;

      const rHome = getRating(ratings, homeId) + cfg.HOME_ADV;
      const rAway = getRating(ratings, awayId);

      const { rHomeNew, rAwayNew } = eloUpdatePair({
        rHome,
        rAway,
        homeScore: hs,
        awayScore: as,
        cfg,
      });

      ratings.set(homeId, rHomeNew - cfg.HOME_ADV);
      ratings.set(awayId, rAwayNew);

      trainedGames += 1;
    }

    const todaysGames = await getNhlGamesByDate(date, true);

    const predictions = todaysGames.map((g) => {
      const homeAbbr =
        g?.homeTeam?.abbr || (g.homeTeamId || "").replace("nhl-", "").toUpperCase();
      const awayAbbr =
        g?.awayTeam?.abbr || (g.awayTeamId || "").replace("nhl-", "").toUpperCase();

      const homeId = g.homeTeamId;
      const awayId = g.awayTeamId;

      const homeWork = workloadForTeam(playedMap.get(homeId), date);
      const awayWork = workloadForTeam(playedMap.get(awayId), date);

      const homeRestAdj = restEloAdjustment("nhl", homeWork);
      const awayRestAdj = restEloAdjustment("nhl", awayWork);

      const rHomeBase = getRating(ratings, homeId);
      const rAwayBase = getRating(ratings, awayId);

      const rHome = rHomeBase + cfg.HOME_ADV + homeRestAdj;
      const rAway = rAwayBase + awayRestAdj;

      const pHome = eloExpected(rHome, rAway);

      const pick = pHome >= 0.5 ? "home" : "away";
      const winnerTeamId = pick === "home" ? homeId : awayId;
      const winnerName = pick === "home" ? homeAbbr : awayAbbr;
      const confidence = probToConfidence(pHome, pick);

      return {
        gameId: g.id,
        date,
        status: g.status,
        home: { id: homeId, abbr: homeAbbr, name: homeAbbr },
        away: { id: awayId, abbr: awayAbbr, name: awayAbbr },
        prediction: {
          winnerTeamId,
          winnerName,
          confidence,
          factors: {
            model: "elo+rest",
            windowDays,
            pHomeWin: pHome,
            rHome,
            rAway,
            rHomeBase,
            rAwayBase,
            homeAdv: cfg.HOME_ADV,
            rest: {
              home: homeWork,
              away: awayWork,
              homeRestAdj,
              awayRestAdj,
            },
            trainedGames,
          },
        },
      };
    });

    return {
      meta: {
        ...meta,
        historyGamesFetched: histGames.length,
        historyGamesWithScores: trainedGames,
        teamsRated: ratings.size,
      },
      predictions,
    };
  } catch (e) {
    return {
      meta: { ...meta, error: String(e?.message || e) },
      predictions: [],
    };
  }
}

/**
 * Routes
 */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "sports-mvp-api", time: new Date().toISOString() })
);

app.get("/api/nba/teams", async (_req, res) => {
  const { teams } = await getNbaTeams();
  res.json(teams);
});

app.get("/api/nba/games", async (req, res) => {
  try {
    const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const expand = wantExpandTeams(req);
    const games = await getNbaGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/nhl/games", async (req, res) => {
  try {
    const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const expand = wantExpandTeams(req);
    const games = await getNhlGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/nba/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Math.max(3, Math.min(30, Number(req.query.window || 14)));
  const payload = await buildNbaPredictPayload(date, windowDays);
  res.json(payload);
});

app.get("/api/nhl/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Math.max(3, Math.min(30, Number(req.query.window || 5)));
  const payload = await buildNhlPredictPayload(date, windowDays);
  res.json(payload);
});

app.get("/api/predictions", async (req, res) => {
  const league = String(req.query.league || "nba").toLowerCase();
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const windowDays = Math.max(3, Math.min(30, Number(req.query.window || 14)));

  if (league === "nba") {
    const payload = await buildNbaPredictPayload(date, windowDays);
    return res.json({ league, date, count: payload.predictions?.length || 0, ...payload });
  }

  if (league === "nhl") {
    const payload = await buildNhlPredictPayload(date, windowDays);
    return res.json({ league, date, count: payload.predictions?.length || 0, ...payload });
  }

  return res.status(400).json({ error: "Unsupported league. Use league=nba or league=nhl", got: league });
});

/**
 * ✅ Upset Watch (INLINE — single source of truth)
 * Query:
 *   /api/upsets?league=nba|nhl&date=YYYY-MM-DD&window=5&minGap=15&limit=12
 */
app.get("/api/upsets", async (req, res) => {
  try {
    const league = String(req.query.league || "nba").toLowerCase();
    const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const windowDays = clamp(Number(req.query.window || 5), 3, 30);
    const minGap = clamp(Number(req.query.minGap || 15), 0, 250);
    const limit = clamp(Number(req.query.limit || 12), 1, 50);

    const payload =
      league === "nhl"
        ? await buildNhlPredictPayload(date, windowDays)
        : await buildNbaPredictPayload(date, windowDays);

    const preds = Array.isArray(payload?.predictions) ? payload.predictions : [];

    const rows = preds
      .map((p) => {
        const f = p?.prediction?.factors || {};
        const pHomeWin = Number(f.pHomeWin);
        if (!Number.isFinite(pHomeWin)) return null;

        const homeId = p?.home?.id;
        const awayId = p?.away?.id;

        const winnerId = p?.prediction?.winnerTeamId;
        const winnerSide = winnerId === homeId ? "home" : "away";
        const winProb = winnerSide === "home" ? pHomeWin : 1 - pHomeWin;

        const rHomeBase = Number(f.rHomeBase);
        const rAwayBase = Number(f.rAwayBase);
        const winnerBase = winnerSide === "home" ? rHomeBase : rAwayBase;
        const loserBase = winnerSide === "home" ? rAwayBase : rHomeBase;

        const baseGap = loserBase - winnerBase;

        const isAwayPick = winnerSide === "away";
        const isLowerRatedWin = Number.isFinite(baseGap) && baseGap >= minGap;

        const closeness = 1 - Math.min(1, Math.abs(winProb - 0.5) / 0.5);
        const score = (Math.max(0, baseGap) / 50) + (closeness * 0.75) + (isAwayPick ? 0.15 : 0);

        return {
          league,
          gameId: p?.gameId,
          date,
          status: p?.status || "",
          home: p?.home,
          away: p?.away,
          pick: {
            winnerTeamId: winnerId,
            winnerName: p?.prediction?.winnerName,
            side: winnerSide,
            winProb,
            confidence: Number(p?.prediction?.confidence) || null,
          },
          signals: {
            baseGap: Number.isFinite(baseGap) ? baseGap : null,
            isAwayPick,
            rest: f?.rest || null,
            trainedGames: f?.trainedGames ?? null,
            score,
          },
          why: [
            isAwayPick ? "Away team pick" : null,
            isLowerRatedWin ? `Lower-rated win (gap ${Math.round(baseGap)} Elo)` : null,
          ].filter(Boolean),
        };
      })
      .filter(Boolean)
      .filter((r) => r.signals && (r.signals.isAwayPick || (r.signals.baseGap != null && r.signals.baseGap >= minGap)))
      .sort((a, b) => (b.signals.score || 0) - (a.signals.score || 0))
      .slice(0, limit);

    res.json({
      ok: true,
      meta: {
        league,
        date,
        windowDays,
        minGap,
        limit,
        sourceModel: payload?.meta?.model || "elo+rest",
        trainedGames: payload?.meta?.historyGamesWithScores ?? null,
      },
      rows,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/games", async (req, res) => {
  const date = normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
  const expandTeams = wantExpandTeams(req);

  let nbaGames = [];
  let nhlGames = [];
  let nbaError = null;
  let nhlError = null;

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

  res.json({
    date,
    expandTeams,
    counts: { total: nbaGames.length + nhlGames.length, nba: nbaGames.length, nhl: nhlGames.length },
    games: [...nbaGames, ...nhlGames],
    errors: { nba: nbaError, nhl: nhlError },
  });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
