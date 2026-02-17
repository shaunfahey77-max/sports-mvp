// apps/api/src/lib/nbaElo.js
import fs from "fs";
import path from "path";

const CACHE_DIR = path.resolve(process.cwd(), "data");
const ELO_CACHE_FILE = path.join(CACHE_DIR, "elo_nba_cache.json");

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readCache() {
  ensureDir();
  if (!fs.existsSync(ELO_CACHE_FILE)) return { builtAt: null, elos: {} };
  try {
    return JSON.parse(fs.readFileSync(ELO_CACHE_FILE, "utf8"));
  } catch {
    return { builtAt: null, elos: {} };
  }
}

function writeCache(obj) {
  ensureDir();
  fs.writeFileSync(ELO_CACHE_FILE, JSON.stringify(obj, null, 2), "utf8");
}

function kFactor() {
  return 18; // stable
}

function expectedScore(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function updateElo(eloA, eloB, scoreA) {
  const ea = expectedScore(eloA, eloB);
  const k = kFactor();
  const newA = eloA + k * (scoreA - ea);
  const newB = eloB + k * ((1 - scoreA) - (1 - ea));
  return [newA, newB];
}

function gameIdFrom(g) {
  const date = String(g.date || "").slice(0, 10);
  const away = g.visitor_team?.abbreviation || g.away_team?.abbreviation || "AWY";
  const home = g.home_team?.abbreviation || "HME";
  return `nba-${date}-${away}-${home}`;
}

/**
 * Pull finals from balldontlie between dates and update Elo.
 * We cache results so it doesn't hammer API every refresh.
 */
export async function buildEloFromHistory({ fetchGamesBetween, daysBack = 120 }) {
  const cache = readCache();
  const now = Date.now();

  // Rebuild at most once every 6 hours
  if (cache?.builtAt && now - new Date(cache.builtAt).getTime() < 6 * 60 * 60 * 1000) {
    return cache.elos || {};
  }

  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const finals = await fetchGamesBetween(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));

  const elos = {};
  // initialize at 1500
  function get(teamAbbr) {
    if (!elos[teamAbbr]) elos[teamAbbr] = 1500;
    return elos[teamAbbr];
  }
  function set(teamAbbr, v) {
    elos[teamAbbr] = v;
  }

  // process finals in chronological order
  finals
    .filter((g) => g.status === "Final" || g.status === "final" || g.status === "finished")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((g) => {
      const home = g.home_team?.abbreviation;
      const away = g.visitor_team?.abbreviation || g.away_team?.abbreviation;
      const hs = Number(g.home_team_score);
      const as = Number(g.visitor_team_score ?? g.away_team_score);

      if (!home || !away) return;
      if (!Number.isFinite(hs) || !Number.isFinite(as)) return;

      const homeElo = get(home);
      const awayElo = get(away);

      const homeWin = hs > as ? 1 : 0;
      const [newHome, newAway] = updateElo(homeElo, awayElo, homeWin);

      set(home, newHome);
      set(away, newAway);
    });

  writeCache({ builtAt: new Date().toISOString(), elos });

  return elos;
}

export function pregameModelProbFromElo({ homeAbbr, awayAbbr, elos }) {
  const homeElo = elos?.[homeAbbr] ?? 1500;
  const awayElo = elos?.[awayAbbr] ?? 1500;

  // home court bump: ~+55 Elo
  const homeAdj = homeElo + 55;

  const pHome = 1 / (1 + Math.pow(10, (awayElo - homeAdj) / 400));
  return pHome;
}

export function makeGameId(g) {
  return gameIdFrom(g);
}
