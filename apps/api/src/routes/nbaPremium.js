// apps/api/src/routes/nbaPremium.js
import express from "express";

const router = express.Router();

/* ===============================
   Simple, Self-Contained Premium
   =============================== */

const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_API_KEY = process.env.NBA_API_KEY || "";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function readDate(req) {
  const d = req.query.date;
  if (!d) return new Date().toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? d
    : new Date().toISOString().slice(0, 10);
}

function addDays(date, delta) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Authorization: NBA_API_KEY },
  });
  if (!res.ok) throw new Error("Upstream error");
  return res.json();
}

function eloExpected(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

/* ===============================
   Premium Picks Endpoint
   =============================== */

router.get("/nba/picks", async (req, res) => {
  try {
    if (!NBA_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing NBA_API_KEY in apps/api/.env",
      });
    }

    const date = readDate(req);
    const windowDays = clamp(Number(req.query.windowDays ?? 30), 7, 120);

    const endHist = addDays(date, -1);
    const startHist = addDays(endHist, -(windowDays - 1));

    // Fetch history
    const histUrl =
      `${NBA_API_BASE}/games?per_page=100` +
      `&start_date=${startHist}` +
      `&end_date=${endHist}`;

    const histJson = await fetchJson(histUrl);
    const hist = histJson.data || [];

    const ratings = new Map();
    const BASE = 1500;
    const HOME_ADV = 65;

    function getRating(id) {
      return ratings.has(id) ? ratings.get(id) : BASE;
    }

    // Train Elo
    for (const g of hist) {
      if (
        typeof g.home_team_score !== "number" ||
        typeof g.visitor_team_score !== "number"
      )
        continue;

      const h = "nba-" + g.home_team.abbreviation.toLowerCase();
      const a = "nba-" + g.visitor_team.abbreviation.toLowerCase();

      const rH = getRating(h) + HOME_ADV;
      const rA = getRating(a);

      const expected = eloExpected(rH, rA);
      const actual =
        g.home_team_score > g.visitor_team_score ? 1 : 0;

      const K = 20;
      const delta = K * (actual - expected);

      ratings.set(h, rH + delta - HOME_ADV);
      ratings.set(a, rA - delta);
    }

    // Fetch today's games
    const gamesUrl =
      `${NBA_API_BASE}/games?per_page=100&dates[]=${date}`;

    const gamesJson = await fetchJson(gamesUrl);
    const games = gamesJson.data || [];

    const picks = [];

    for (const g of games) {
      const status = (g.status || "").toLowerCase();

      // remove live distortion
      if (
        status.includes("q") ||
        status.includes("final") ||
        status.includes("ot")
      )
        continue;

      const h = "nba-" + g.home_team.abbreviation.toLowerCase();
      const a = "nba-" + g.visitor_team.abbreviation.toLowerCase();

      const rH = getRating(h);
      const rA = getRating(a);

      let pHome = eloExpected(rH + HOME_ADV, rA);

      // Bayesian shrinkage toward 50%
      const priorWeight = 25;
      const modelWeight = 20;

      pHome =
        (0.5 * priorWeight + pHome * modelWeight) /
        (priorWeight + modelWeight);

      // Hard caps to prevent 94% nonsense
      pHome = clamp(pHome, 0.18, 0.82);

      const side = pHome >= 0.5 ? "home" : "away";
      const winProb =
        side === "home" ? pHome : 1 - pHome;

      picks.push({
        gameId: "nba-" + g.id,
        date,
        home: g.home_team.full_name,
        away: g.visitor_team.full_name,
        pick: side === "home"
          ? g.home_team.abbreviation
          : g.visitor_team.abbreviation,
        winProb,
        confidence:
          winProb > 0.65
            ? "High"
            : winProb > 0.57
            ? "Medium"
            : "Low",
      });
    }

    return res.json({
      ok: true,
      meta: {
        league: "nba",
        date,
        windowDays,
        teamsRated: ratings.size,
      },
      picks,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
    });
  }
});

export default router;
