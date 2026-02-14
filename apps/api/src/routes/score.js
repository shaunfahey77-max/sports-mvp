// apps/api/src/routes/score.js
import express from "express";
import { listPicks, updatePick } from "../store/picksStore.js";

// NOTE: These three functions must return an array of games like:
// [{ gameId, status, winnerTeamId, winnerTeamName }]
// I’m giving you working NBA (balldontlie) and ESPN NCAAM;
// NHL you can wire to your existing NHL fetch (or keep stub until ready).

const router = express.Router();

const NBA_API_BASE = "https://api.balldontlie.io/v1";
const NBA_KEY = process.env.BALLDONTLIE_API_KEY;

// ---------- Helpers ----------
function isFinalStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "final" || s === "post" || s === "completed";
}

async function fetchJSON(url, headers = {}) {
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Upstream ${r.status} for ${url} — ${text}`.slice(0, 400));
  }
  return r.json();
}

// ---------- League fetchers ----------
async function fetchNBAResults(date) {
  if (!NBA_KEY) throw new Error("Missing BALLDONTLIE_API_KEY");
  const url = `${NBA_API_BASE}/games?per_page=100&dates[]=${encodeURIComponent(date)}`;
  const json = await fetchJSON(url, { Authorization: NBA_KEY });

  const games = Array.isArray(json.data) ? json.data : [];
  return games.map((g) => {
    const homeId = g.home_team?.id;
    const awayId = g.visitor_team?.id;
    const homePts = Number(g.home_team_score);
    const awayPts = Number(g.visitor_team_score);

    const winner =
      Number.isFinite(homePts) && Number.isFinite(awayPts)
        ? homePts > awayPts
          ? { id: `nba-${homeId}`, name: g.home_team?.abbreviation || g.home_team?.name }
          : { id: `nba-${awayId}`, name: g.visitor_team?.abbreviation || g.visitor_team?.name }
        : { id: null, name: null };

    return {
      gameId: `nba-${g.id}`,
      status: g.status,
      winnerTeamId: isFinalStatus(g.status) ? winner.id : null,
      winnerTeamName: isFinalStatus(g.status) ? winner.name : null,
    };
  });
}

async function fetchNCAAMResults(date) {
  // ESPN scoreboard: date is YYYYMMDD
  const yyyymmdd = date.replaceAll("-", "");
  const url = `https://site.web.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${yyyymmdd}`;
  const json = await fetchJSON(url);

  const events = Array.isArray(json.events) ? json.events : [];
  return events.map((ev) => {
    const comp = ev.competitions?.[0];
    const status = comp?.status?.type?.name || comp?.status?.type?.state || comp?.status?.type?.description;

    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const winnerComp = competitors.find((c) => c.winner === true);

    const winnerTeamId = winnerComp?.team?.id ? `ncaam-${winnerComp.team.id}` : null;
    const winnerTeamName = winnerComp?.team?.abbreviation || winnerComp?.team?.shortDisplayName || null;

    return {
      gameId: `ncaam-${ev.id}`,
      status,
      winnerTeamId: isFinalStatus(status) ? winnerTeamId : null,
      winnerTeamName: isFinalStatus(status) ? winnerTeamName : null,
    };
  });
}

async function fetchNHLResults(_date) {
  // Plug in YOUR NHL fetcher here (you already have NHL in the app).
  // Return objects shaped like { gameId:"nhl-xxxx", status:"Final", winnerTeamId:"nhl-TEAMID", winnerTeamName:"BOS" }
  return [];
}

// POST /api/score?date=YYYY-MM-DD&league=nba|nhl|ncaam|all
router.post("/", async (req, res) => {
  try {
    const date = String(req.query.date || "").slice(0, 10);
    const leagueParam = String(req.query.league || "all").toLowerCase();

    if (!date || date.length !== 10) return res.status(400).json({ ok: false, error: "Missing/invalid date" });

    const leagues = leagueParam === "all" ? ["nba", "nhl", "ncaam"] : [leagueParam];

    let totalScored = 0;
    let totalConsidered = 0;

    for (const league of leagues) {
      const picks = listPicks({ league, date });
      if (!picks.length) continue;

      let results = [];
      if (league === "nba") results = await fetchNBAResults(date);
      if (league === "ncaam") results = await fetchNCAAMResults(date);
      if (league === "nhl") results = await fetchNHLResults(date);

      const byGameId = new Map(results.map((g) => [g.gameId, g]));

      for (const p of picks) {
        totalConsidered += 1;

        const g = byGameId.get(p.gameId);
        if (!g) continue;
        if (!g.winnerTeamId) continue; // not final / not scoreable

        const correct = String(p.predictedTeamId) === String(g.winnerTeamId);

        updatePick(p.league, p.gameId, p.date, {
          scored: true,
          correct,
          winnerTeamId: g.winnerTeamId,
          winnerTeamName: g.winnerTeamName,
          status: g.status,
        });

        totalScored += 1;
      }
    }

    res.json({ ok: true, date, league: leagueParam, considered: totalConsidered, newlyScored: totalScored });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

export default router;
