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
      Authorization: API_KEY, // ✅ NO "Bearer"
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
 * GET /api/nba/teams/:teamId/last5?season=2024
 */
router.get("/teams/:teamId/last5", async (req, res) => {
  try {
    // 🔍 DEBUG LOG — THIS IS THE ONLY ADDITION
    console.log(
      "[NBA LAST5] API KEY loaded:",
      Boolean(API_KEY),
      "length:",
      API_KEY?.length
    );

    if (!API_KEY) {
      return res
        .status(500)
        .json({ error: "Missing NBA_API_KEY on server" });
    }

    const teamId = asInt(req.params.teamId);
    if (!teamId || teamId < 1 || teamId > 50) {
      return res.status(400).json({ error: "Invalid teamId" });
    }

    const season = asInt(req.query.season) ?? 2024;

    const cacheKey = `nba:last5:${teamId}:${season}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const gamesResp = await bdlGet("/games", {
      seasons: [season],
      team_ids: [teamId],
      per_page: 100,
    });

    const games = (gamesResp.data || [])
      .filter(
        (g) =>
          typeof g.status === "string" &&
          g.status.toLowerCase() === "final"
      )
      .map((g) => ({
        id: g.id,
        date: g.datetime || g.date,
        home_team_id: g.home_team?.id,
        visitor_team_id: g.visitor_team?.id,
        home_team_score: g.home_team_score,
        visitor_team_score: g.visitor_team_score,
        opponent_id:
          g.home_team?.id === teamId
            ? g.visitor_team?.id
            : g.home_team?.id,
        is_home: g.home_team?.id === teamId,
      }))
      .sort(
        (a, b) =>
          new Date(b.date).getTime() -
          new Date(a.date).getTime()
      )
      .slice(0, 5);

    if (games.length === 0) {
      const payload = { teamId, season, games: [], totals: null };
      setCache(cacheKey, payload, 60_000);
      return res.json(payload);
    }

    const gameIds = games.map((g) => g.id);

    let cursor = null;
    const teamTotalsByGame = new Map();

    const initTotals = () => ({
      pts: 0,
      ast: 0,
      reb: 0,
      oreb: 0,
      dreb: 0,
      stl: 0,
      blk: 0,
      turnover: 0,
      pf: 0,
      fgm: 0,
      fga: 0,
      fg3m: 0,
      fg3a: 0,
      ftm: 0,
      fta: 0,
    });

    for (let i = 0; i < 20; i++) {
      const statsResp = await bdlGet("/stats", {
        game_ids: gameIds,
        per_page: 100,
        ...(cursor ? { cursor } : {}),
      });

      for (const s of statsResp.data || []) {
        if (!s?.game?.id || s.team?.id !== teamId) continue;

        const gid = s.game.id;
        if (!teamTotalsByGame.has(gid)) {
          teamTotalsByGame.set(gid, initTotals());
        }

        const t = teamTotalsByGame.get(gid);
        t.pts += s.pts ?? 0;
        t.ast += s.ast ?? 0;
        t.reb += s.reb ?? 0;
        t.oreb += s.oreb ?? 0;
        t.dreb += s.dreb ?? 0;
        t.stl += s.stl ?? 0;
        t.blk += s.blk ?? 0;
        t.turnover += s.turnover ?? 0;
        t.pf += s.pf ?? 0;
        t.fgm += s.fgm ?? 0;
        t.fga += s.fga ?? 0;
        t.fg3m += s.fg3m ?? 0;
        t.fg3a += s.fg3a ?? 0;
        t.ftm += s.ftm ?? 0;
        t.fta += s.fta ?? 0;
      }

      cursor = statsResp.meta?.next_cursor ?? null;
      if (!cursor) break;
    }

    const enriched = games.map((g) => ({
      ...g,
      team_totals: teamTotalsByGame.get(g.id) || null,
    }));

    const withTotals = enriched.filter((g) => g.team_totals);
    const avg = withTotals.length
      ? Object.keys(withTotals[0].team_totals).reduce(
          (acc, k) => {
            const sum = withTotals.reduce(
              (s, gg) => s + (gg.team_totals[k] ?? 0),
              0
            );
            acc[k] = Number(
              (sum / withTotals.length).toFixed(1)
            );
            return acc;
          },
          {}
        )
      : null;

    const payload = {
      teamId,
      season,
      games: enriched,
      last5_avg: avg,
      meta: { source: "balldontlie", cached_seconds: 60 },
    };

    setCache(cacheKey, payload, 60_000);
    return res.json(payload);
  } catch (e) {
    const status = e.status || 500;
    return res
      .status(status)
      .json({ error: e.message || "Server error" });
  }
});

export default router;
