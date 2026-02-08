// apps/api/src/routes/upsets.js
import express from "express";

const router = express.Router();

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const logistic = (z) => 1 / (1 + Math.exp(-z));

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return iso(d);
}

function getTeamIds(g) {
  const home = g.home_team?.id ?? g.homeTeam?.id ?? g.home_team_id ?? g.homeTeamId;
  const away = g.visitor_team?.id ?? g.awayTeam?.id ?? g.visitor_team_id ?? g.awayTeamId;
  return { home, away };
}

function getScores(g) {
  const hs = g.home_team_score ?? g.homeScore ?? g.home_score ?? g.homeTeamScore;
  const as = g.visitor_team_score ?? g.awayScore ?? g.away_score ?? g.awayTeamScore;
  return { hs, as };
}

function buildRecentWinPct(games) {
  const rec = new Map(); // teamId -> {w,l,g}
  const bump = (teamId, didWin) => {
    const cur = rec.get(teamId) || { w: 0, l: 0, g: 0 };
    cur.g += 1;
    if (didWin) cur.w += 1;
    else cur.l += 1;
    rec.set(teamId, cur);
  };

  for (const g of games) {
    const { home, away } = getTeamIds(g);
    const { hs, as } = getScores(g);
    if (home == null || away == null) continue;
    if (typeof hs !== "number" || typeof as !== "number") continue;

    const homeWin = hs > as;
    bump(home, homeWin);
    bump(away, !homeWin);
  }

  const winPct = new Map();
  for (const [teamId, v] of rec.entries()) {
    winPct.set(teamId, v.g ? v.w / v.g : 0.5);
  }
  return winPct;
}

function computeWinProb(underdogForm, favoriteForm, underdogIsHome) {
  const formDiff = underdogForm - favoriteForm; // usually negative
  const homeBoost = underdogIsHome ? 0.08 : 0.0;
  const z = (formDiff * 3.5) + homeBoost;
  return clamp(logistic(z), 0.05, 0.95);
}

// Pull games day-by-day using your existing /api/{league}/games?date=YYYY-MM-DD route
async function fetchGamesRange({ league, from, to, base }) {
  const out = [];
  let d = from;
  while (d <= to) {
    const url = `${base}/api/${league}/games?date=${d}&expand=teams`;
    const r = await fetch(url);
    const j = await r.json();
    const games = j?.games || j || [];
    out.push(...games);
    d = addDays(d, 1);
  }
  return out;
}

router.get("/", async (req, res) => {
  try {
    const league = (req.query.league || "nba").toLowerCase(); // nba|nhl
    const date = req.query.date || iso(new Date());
    const windowDays = Number(req.query.windowDays || 14);
    const minProb = Number(req.query.minProb || 0.40);

    const port = process.env.PORT || 3001;
    const base = `http://127.0.0.1:${port}`;

    // Today’s slate
    const scheduleResp = await fetch(`${base}/api/${league}/games?date=${date}&expand=teams`);
    const scheduleJson = await scheduleResp.json();
    const todaysGames = scheduleJson?.games || scheduleJson || [];

    // History (range fetch, safe)
    const from = addDays(date, -windowDays);
    const histGames = await fetchGamesRange({ league, from, to: date, base });

    const winPct = buildRecentWinPct(histGames);

    const candidates = [];

    for (const g of todaysGames) {
      const homeTeam = g.home_team || g.homeTeam;
      const awayTeam = g.visitor_team || g.awayTeam;
      if (!homeTeam || !awayTeam) continue;

      const homeForm = winPct.get(homeTeam.id) ?? 0.5;
      const awayForm = winPct.get(awayTeam.id) ?? 0.5;

      const underdogIsHome = homeForm < awayForm;
      const underdog = underdogIsHome ? homeTeam : awayTeam;
      const favorite = underdogIsHome ? awayTeam : homeTeam;

      const underForm = underdogIsHome ? homeForm : awayForm;
      const favForm = underdogIsHome ? awayForm : homeForm;

      const winProb = computeWinProb(underForm, favForm, underdogIsHome);
      if (winProb < minProb) continue;

      const why = [];
      if (Math.abs(underForm - favForm) <= 0.10) why.push("Close recent form");
      if (underdogIsHome) why.push("Home boost");
      if (underForm >= 0.55) why.push("Underdog trending up");

      candidates.push({
        id: `${league}-${g.id}-${date}`,
        league,
        date,
        matchup: `${underdog.abbreviation || underdog.abbr || underdog.name} @ ${favorite.abbreviation || favorite.abbr || favorite.name}`,
        underdog: {
          id: underdog.id,
          name: underdog.full_name || underdog.name,
          abbr: underdog.abbreviation || underdog.abbr,
          isHome: underdogIsHome,
          recentWinPct: underForm,
        },
        favorite: {
          id: favorite.id,
          name: favorite.full_name || favorite.name,
          abbr: favorite.abbreviation || favorite.abbr,
          isHome: !underdogIsHome,
          recentWinPct: favForm,
        },
        winProb,
        why,
      });
    }

    candidates.sort((a, b) => b.winProb - a.winProb);

    res.json({
      ok: true,
      league,
      date,
      windowDays,
      minProb,
      count: candidates.length,
      candidates,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
