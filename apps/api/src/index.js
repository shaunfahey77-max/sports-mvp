import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

/**
 * Config
 */
const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || ""; // Balldontlie API key
const NHL_API_BASE = "https://api-web.nhle.com/v1"; // NHL api-web endpoints

// super-light caching to avoid hammering upstreams while you develop
const CACHE_TTL_MS = 60_000;
const cache = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value) {
  cache.set(key, { time: Date.now(), value });
}

async function fetchJson(url, { headers } = {}) {
  const cacheKey = `GET:${url}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Upstream error ${res.status} for ${url}${text ? ` — ${text}` : ""}`
    );
  }

  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

/**
 * Helpers
 */
function normalizeDateParam(date) {
  // expects YYYY-MM-DD (your frontend already uses this)
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

/**
 * NBA (Balldontlie)
 */
async function getNbaTeams() {
  if (!NBA_API_KEY) {
    throw new Error(
      "Missing NBA_API_KEY. Add it to apps/api/.env to enable NBA live data."
    );
  }

  const url = `${NBA_API_BASE}/teams`;
  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });

  // Balldontlie returns modern teams + historical/defunct teams.
  // We only want the current NBA 30 teams (ids 1–30).
  const teams = (json?.data || [])
    .filter((t) => Number(t?.id) >= 1 && Number(t?.id) <= 30)
    .map((t) => ({
      id: toNbaTeamId(t.abbreviation),
      name: t.full_name || `${t.city} ${t.name}`.trim(),
      city: t.city || "",
      abbr: t.abbreviation || "",
      _source: { provider: "balldontlie", teamId: t.id },
    }));

  // Safety: de-dupe by abbreviation (prevents collisions like duplicate WAS)
  const byAbbr = new Map();
  for (const t of teams) {
    if (t?.abbr) byAbbr.set(t.abbr, t);
  }

  return { teams: Array.from(byAbbr.values()), byAbbr };
}

async function getNbaGamesByDate(dateYYYYMMDD, expandTeams) {
  if (!NBA_API_KEY) {
    throw new Error(
      "Missing NBA_API_KEY. Add it to apps/api/.env to enable NBA live data."
    );
  }

  // Balldontlie: dates[] as array param
  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(
    dateYYYYMMDD
  )}`;
  const json = await fetchJson(url, { headers: { Authorization: NBA_API_KEY } });
  const rows = json?.data || [];

  return rows.map((g) => {
    const homeAbbr = g?.home_team?.abbreviation;
    const awayAbbr = g?.visitor_team?.abbreviation;

    const base = {
      id: `nba-${g.id}`,
      // Normalize to YYYY-MM-DD for the frontend/date filtering
      date: String(g?.date || "").slice(0, 10),
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
      },
      awayTeam: {
        id: toNbaTeamId(awayAbbr),
        name: g?.visitor_team?.full_name || "",
        city: g?.visitor_team?.city || "",
        abbr: awayAbbr || "",
      },
    };
  });
}

/**
 * NHL (api-web.nhle.com)
 */
async function getNhlTeams() {
  // standings/now includes team meta
  const url = `${NHL_API_BASE}/standings/now`;
  const json = await fetchJson(url);

  const records = Array.isArray(json?.standings) ? json.standings : [];

  const teams = records
    .map((r) => {
      const tri = r?.teamAbbrev?.default || r?.teamAbbrev || r?.teamAbbrev?.en;
      const name = r?.teamName?.default || r?.teamName || r?.teamName?.en;
      const city = r?.teamCommonName?.default || r?.teamCommonName || "";
      if (!tri || !name) return null;

      return {
        id: toNhlTeamId(tri),
        name: name,
        city: city || "",
        abbr: tri,
      };
    })
    .filter(Boolean);

  const map = new Map();
  for (const t of teams) map.set(t.abbr, t);
  return { teams: Array.from(map.values()), byAbbr: map };
}

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
      id: `nhl-${g.id}`,
      date: dateYYYYMMDD,
      homeTeamId: toNhlTeamId(homeTri),
      awayTeamId: toNhlTeamId(awayTri),
    };

    if (!expandTeams) return base;

    return {
      ...base,
      homeTeam: {
        id: toNhlTeamId(homeTri),
        name: g?.homeTeam?.placeName?.default
          ? `${g.homeTeam.placeName.default} ${
              g.homeTeam?.commonName?.default || ""
            }`.trim()
          : g?.homeTeam?.commonName?.default || homeTri || "",
        city: g?.homeTeam?.placeName?.default || "",
        abbr: homeTri || "",
      },
      awayTeam: {
        id: toNhlTeamId(awayTri),
        name: g?.awayTeam?.placeName?.default
          ? `${g.awayTeam.placeName.default} ${
              g.awayTeam?.commonName?.default || ""
            }`.trim()
          : g?.awayTeam?.commonName?.default || awayTri || "",
        city: g?.awayTeam?.placeName?.default || "",
        abbr: awayTri || "",
      },
    };
  });
}

/**
 * Routes
 */
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "sports-mvp-api",
    time: new Date().toISOString(),
  })
);

// Teams
app.get("/api/nba/teams", async (_req, res) => {
  try {
    const { teams } = await getNbaTeams();
    res.json(teams);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/nhl/teams", async (_req, res) => {
  try {
    const { teams } = await getNhlTeams();
    res.json(teams);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Games (by date)
app.get("/api/nba/games", async (req, res) => {
  try {
    const date =
      normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const expand = wantExpandTeams(req);
    const games = await getNbaGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/nhl/games", async (req, res) => {
  try {
    const date =
      normalizeDateParam(req.query.date) || new Date().toISOString().slice(0, 10);
    const expand = wantExpandTeams(req);
    const games = await getNhlGamesByDate(date, expand);
    res.json(games);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
