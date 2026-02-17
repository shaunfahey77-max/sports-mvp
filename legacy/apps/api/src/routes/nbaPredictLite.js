import express from "express";

const router = express.Router();

const BASE = "https://api.balldontlie.io/v1";
const API_KEY = process.env.NBA_API_KEY;

// --- tiny in-memory cache (swap for Redis later) ---
const cache = new Map(); // key -> { expiresAt, value }
const getCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};
const setCache = (key, value, ttlMs) => {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
};

// --- helpers ---
const asInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function parseDateSafe(s) {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function eloExpected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function eloUpdate(elo, scoreActual, expected, k) {
  return elo + k * (scoreActual - expected);
}

async function bdlGet(path, params) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((x) => url.searchParams.append(`${k}[]`, String(x)));
    } else {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url, {
    headers: {
      Authorization: API_KEY, // ✅ balldontlie Free: key in Authorization header (no Bearer)
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`balldontlie ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fetch team info (FREE endpoint) and cache it.
 * balldontlie sometimes returns { data: {...} } so we normalize.
 */
async function fetchTeamById(teamId) {
  const cacheKey = `nba:team:${teamId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const resp = await bdlGet(`/teams/${teamId}`);
  const team = resp?.data ?? resp;

  const normalized = {
    teamId: team?.id ?? teamId,
    name: team?.full_name ?? team?.name ?? null,
    city: team?.city ?? null,
    abbr: team?.abbreviation ?? team?.abbr ?? null,
    conference: team?.conference ?? null,
    division: team?.division ?? null,
  };

  setCache(cacheKey, normalized, 24 * 60 * 60_000); // 24 hours
  return normalized;
}

// Fetch enough games for a team/season to compute last10 + Elo (Free endpoint /games).
async function fetchTeamSeasonGames(teamId, season) {
  const cacheKey = `nba:teamGames:${teamId}:${season}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const perPage = 100;
  const maxPages = 5;

  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const resp = await bdlGet("/games", {
      seasons: [season],
      team_ids: [teamId],
      per_page: perPage,
      page,
    });

    const data = resp?.data || [];
    all.push(...data);

    if (data.length < perPage) break;
    if (all.length >= 250) break;
  }

  const finals = all
    .filter((g) => typeof g.status === "string" && g.status.toLowerCase() === "final")
    .map((g) => ({
      id: g.id,
      dt: parseDateSafe(g.datetime || g.date),
      home_id: g.home_team?.id,
      away_id: g.visitor_team?.id,
      home_score: g.home_team_score,
      away_score: g.visitor_team_score,
    }))
    .filter((g) => g.dt); // ensure valid date

  finals.sort((a, b) => a.dt.getTime() - b.dt.getTime());

  setCache(cacheKey, finals, 5 * 60_000); // 5 minutes
  return finals;
}

function computeLastNForm(teamId, finalsAsc, n, asOfDate) {
  const filtered = asOfDate
    ? finalsAsc.filter((g) => g.dt.getTime() <= asOfDate.getTime())
    : finalsAsc;

  const last = filtered.slice(-n);
  if (last.length === 0) {
    return {
      count: 0,
      avg_margin: 0,
      avg_points_for: 0,
      avg_points_against: 0,
      record: "0-0",
      last_game_date: null,
      rest_days: null,
    };
  }

  let pf = 0;
  let pa = 0;
  let w = 0;
  let l = 0;

  for (const g of last) {
    const isHome = g.home_id === teamId;
    const teamScore = isHome ? g.home_score : g.away_score;
    const oppScore = isHome ? g.away_score : g.home_score;

    pf += teamScore ?? 0;
    pa += oppScore ?? 0;

    if (teamScore > oppScore) w += 1;
    else if (teamScore < oppScore) l += 1;
  }

  const avg_pf = pf / last.length;
  const avg_pa = pa / last.length;
  const avg_margin = (pf - pa) / last.length;

  const lastGame = last[last.length - 1];
  const lastDate = lastGame?.dt || null;
  const restDays = lastDate && asOfDate ? daysBetween(lastDate, asOfDate) : null;

  return {
    count: last.length,
    avg_margin: Number(avg_margin.toFixed(2)),
    avg_points_for: Number(avg_pf.toFixed(1)),
    avg_points_against: Number(avg_pa.toFixed(1)),
    record: `${w}-${l}`,
    last_game_date: lastDate ? lastDate.toISOString().slice(0, 10) : null,
    rest_days: restDays,
  };
}

function computeTeamEloLite(teamId, finalsAsc, asOfDate) {
  let elo = 1500;
  const K = 20;

  const filtered = asOfDate
    ? finalsAsc.filter((g) => g.dt.getTime() <= asOfDate.getTime())
    : finalsAsc;

  for (const g of filtered) {
    const isHome = g.home_id === teamId;
    const teamScore = isHome ? g.home_score : g.away_score;
    const oppScore = isHome ? g.away_score : g.home_score;

    if (teamScore === null || teamScore === undefined) continue;
    if (oppScore === null || oppScore === undefined) continue;

    const actual = teamScore > oppScore ? 1 : teamScore < oppScore ? 0 : 0.5;
    const expected = 0.5; // lite baseline (no opponent Elo)
    elo = eloUpdate(elo, actual, expected, K);
  }

  return Math.round(elo);
}

/**
 * GET /api/nba/predict-lite?home=14&away=2&season=2024&date=2025-02-01
 */
router.get("/predict-lite", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: "Missing NBA_API_KEY on server" });
    }

    const homeId = asInt(req.query.home);
    const awayId = asInt(req.query.away);
    const season = asInt(req.query.season) ?? 2024;

    if (!homeId || !awayId || homeId === awayId) {
      return res.status(400).json({ error: "Provide distinct home and away team IDs" });
    }

    const asOf = parseDateSafe(req.query.date) || new Date();

    const cacheKey = `nba:predictLite:${homeId}:${awayId}:${season}:${asOf.toISOString().slice(0, 10)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const [homeGamesAsc, awayGamesAsc, homeTeam, awayTeam] = await Promise.all([
      fetchTeamSeasonGames(homeId, season),
      fetchTeamSeasonGames(awayId, season),
      fetchTeamById(homeId),
      fetchTeamById(awayId),
    ]);

    const homeForm10 = computeLastNForm(homeId, homeGamesAsc, 10, asOf);
    const awayForm10 = computeLastNForm(awayId, awayGamesAsc, 10, asOf);

    const homeElo = computeTeamEloLite(homeId, homeGamesAsc, asOf);
    const awayElo = computeTeamEloLite(awayId, awayGamesAsc, asOf);

    const HOME_ADV_ELO = 65;
    const REST_ELO_PER_DAY = 8;
    const B2B_PENALTY_ELO = 15;

    const homeRest = homeForm10.rest_days;
    const awayRest = awayForm10.rest_days;

    const baseEloDiff = homeElo - awayElo;
    const homeAdv = HOME_ADV_ELO;

    let restAdj = 0;
    if (homeRest !== null && awayRest !== null) {
      const restDelta = clamp(homeRest - awayRest, -3, 3);
      restAdj += restDelta * REST_ELO_PER_DAY;

      if (homeRest === 0) restAdj -= B2B_PENALTY_ELO;
      if (awayRest === 0) restAdj += B2B_PENALTY_ELO;
    }

    const marginDelta = clamp(homeForm10.avg_margin - awayForm10.avg_margin, -15, 15);
    const formAdj = marginDelta * 3;

    const eloDiff = baseEloDiff + homeAdv + restAdj + formAdj;

    const winProb = eloExpected(0, -eloDiff);
    const projectedMargin = Number((eloDiff / 25).toFixed(1));

    const payload = {
      season,
      as_of: asOf.toISOString().slice(0, 10),
      home: {
        id: `nba-${homeTeam.abbr?.toLowerCase()}`,
        ...homeTeam,
        elo: homeElo,
        last10: homeForm10,
      },
      away: {
        id: `nba-${awayTeam.abbr?.toLowerCase()}`,
        ...awayTeam,
        elo: awayElo,
        last10: awayForm10,
      },
      prediction: {
        home_win_prob: Number(winProb.toFixed(3)),
        projected_margin: projectedMargin,
      },
      explain: {
        base_elo_diff: baseEloDiff,
        home_advantage: homeAdv,
        rest_adjustment: restAdj,
        form_adjustment: Number(formAdj.toFixed(1)),
        elo_diff_total: Number(eloDiff.toFixed(1)),
      },
      meta: {
        model: "elo-lite",
        data: "balldontlie-free",
        note: "Uses only game results (scores/dates). Box score stats require paid tier.",
        cached_seconds: 60,
      },
    };

    setCache(cacheKey, payload, 60_000);
    return res.json(payload);
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || "Server error" });
  }
});

export default router;
