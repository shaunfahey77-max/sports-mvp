// apps/api/src/routes/score.js
import express from "express";

const router = express.Router();

/**
 * GET /api/score/ping
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "score" });
});

function isFinalStatus(g) {
  const s = String(g?.status || "").toLowerCase();
  return s === "final" || s === "post" || s === "completed";
}

function getScoresFromGame(g) {
  const hs =
    typeof g?.homeScore === "number"
      ? g.homeScore
      : typeof g?.home?.score === "number"
      ? g.home.score
      : null;

  const as =
    typeof g?.awayScore === "number"
      ? g.awayScore
      : typeof g?.away?.score === "number"
      ? g.away.score
      : null;

  return { homeScore: hs, awayScore: as };
}

function getWinnerSide(homeScore, awayScore) {
  if (typeof homeScore !== "number" || typeof awayScore !== "number") return null;
  if (homeScore === awayScore) return "push";
  return homeScore > awayScore ? "home" : "away";
}

/**
 * Core scorer used by cron.
 * Returns a premium-style report:
 * - counts include graded (scored decisions)
 * - details include WIN/LOSS/PASS per game
 */
export async function scoreCompletedGames(league, dateYYYYMMDD, games = []) {
  const details = [];

  let inputGames = Array.isArray(games) ? games.length : 0;
  let completed = 0;
  let picks = 0;
  let noPick = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let graded = 0;

  for (const g of games || []) {
    const pick = g?.market?.pick ?? g?.pick?.pick ?? null; // prefer market pick, fall back to top pick
    const gameKey = String(g?.gameKey || g?.game_key || g?.gameId || g?.id || g?.eventId || "").trim() || null;

    const finalish = isFinalStatus(g);
    if (finalish) completed++;

    if (!pick || pick === "PASS") {
      noPick++;
      details.push({
        game_key: gameKey,
        matchup: `${g?.away?.abbr || g?.away?.name || "AWAY"} @ ${g?.home?.abbr || g?.home?.name || "HOME"}`,
        status: g?.status || null,
        homeScore: g?.homeScore ?? g?.home?.score ?? null,
        awayScore: g?.awayScore ?? g?.away?.score ?? null,
        pick: "PASS",
        result: "PASS",
        market: g?.market?.marketType || g?.market?.market || "moneyline",
      });
      continue;
    }

    picks++;

    if (!finalish) {
      details.push({
        game_key: gameKey,
        matchup: `${g?.away?.abbr || g?.away?.name || "AWAY"} @ ${g?.home?.abbr || g?.home?.name || "HOME"}`,
        status: g?.status || null,
        homeScore: g?.homeScore ?? g?.home?.score ?? null,
        awayScore: g?.awayScore ?? g?.away?.score ?? null,
        pick,
        result: "PENDING",
        market: g?.market?.marketType || g?.market?.market || "moneyline",
      });
      continue;
    }

    const { homeScore, awayScore } = getScoresFromGame(g);
    const winner = getWinnerSide(homeScore, awayScore);

    if (winner === "push") {
      pushes++;
      graded++;
      details.push({
        game_key: gameKey,
        matchup: `${g?.away?.abbr || g?.away?.name || "AWAY"} @ ${g?.home?.abbr || g?.home?.name || "HOME"}`,
        status: g?.status || null,
        homeScore,
        awayScore,
        pick,
        result: "PUSH",
        market: g?.market?.marketType || g?.market?.market || "moneyline",
      });
      continue;
    }

    if (winner === "home" || winner === "away") {
      graded++;
      const isWin = pick === winner;
      if (isWin) wins++;
      else losses++;

      details.push({
        game_key: gameKey,
        matchup: `${g?.away?.abbr || g?.away?.name || "AWAY"} @ ${g?.home?.abbr || g?.home?.name || "HOME"}`,
        status: g?.status || null,
        homeScore,
        awayScore,
        pick,
        result: isWin ? "WIN" : "LOSS",
        market: g?.market?.marketType || g?.market?.market || "moneyline",
      });
      continue;
    }

    // unknown
    details.push({
      game_key: gameKey,
      matchup: `${g?.away?.abbr || g?.away?.name || "AWAY"} @ ${g?.home?.abbr || g?.home?.name || "HOME"}`,
      status: g?.status || null,
      homeScore,
      awayScore,
      pick,
      result: "UNKNOWN",
      market: g?.market?.marketType || g?.market?.market || "moneyline",
    });
  }

  const winRate = graded ? wins / graded : null;

  return {
    ok: true,
    league,
    date: dateYYYYMMDD,
    counts: { inputGames, completed, picks, graded, wins, losses, pushes, noPick },
    metrics: { winRate, avgEdge: null, avgWinProb: null, avgConfidence: null },
    details,
  };
}

// ✅ IMPORTANT: default export router so index.js can `import scoreRouter from "./routes/score.js"`
export default router;