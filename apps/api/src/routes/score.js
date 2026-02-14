// apps/api/src/routes/score.js
import express from "express";

const router = express.Router();

/**
 * Helpers
 */
function isFinalStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "final" || s === "post" || s === "completed" || s.includes("final");
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getScoresFromGame(g) {
  const hs =
    safeNum(g?.homeScore) ??
    safeNum(g?.home?.score) ??
    safeNum(g?.homeTeam?.score) ??
    null;

  const as =
    safeNum(g?.awayScore) ??
    safeNum(g?.away?.score) ??
    safeNum(g?.awayTeam?.score) ??
    null;

  return { homeScore: hs, awayScore: as };
}

function getPickSide(g) {
  // unified contract: g.market.pick
  const p = g?.market?.pick ?? g?.pick ?? null;
  return p === "home" || p === "away" ? p : null;
}

function outcomeFromPick(pickSide, homeScore, awayScore) {
  if (!pickSide) return { result: "NOPICK", won: null };

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
    return { result: "NOSCORE", won: null };
  }

  if (homeScore === awayScore) return { result: "PUSH", won: 0 };

  const homeWon = homeScore > awayScore;
  const pickHome = pickSide === "home";
  const won = (homeWon && pickHome) || (!homeWon && !pickHome);

  return { result: won ? "WIN" : "LOSS", won: won ? 1 : 0 };
}

/**
 * ✅ Named export (cron/admin rely on this)
 */
export async function scoreCompletedGames(league, dateYYYYMMDD, games = []) {
  const rows = Array.isArray(games) ? games : [];

  let completed = 0;
  let picks = 0; // non-pass picks in completed games
  let graded = 0; // wins+losses+pushes
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noPick = 0; // completed finals that were PASS/null

  let sumEdge = 0;
  let nEdge = 0;

  let sumWinProb = 0;
  let nWinProb = 0;

  let sumConf = 0;
  let nConf = 0;

  const details = [];

  for (const g of rows) {
    const status = g?.status ?? g?.state ?? "";
    if (!isFinalStatus(status)) continue;

    const { homeScore, awayScore } = getScoresFromGame(g);
    completed++;

    const pickSide = getPickSide(g);
    if (!pickSide) {
      noPick++;
      continue;
    }

    // must have numeric scores to grade
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const { result } = outcomeFromPick(pickSide, homeScore, awayScore);

    picks++;
    graded++;

    if (result === "WIN") wins++;
    else if (result === "LOSS") losses++;
    else if (result === "PUSH") pushes++;

    const edge = safeNum(g?.market?.edge);
    if (Number.isFinite(edge)) {
      sumEdge += edge;
      nEdge++;
    }

    const winProb = safeNum(g?.market?.winProb);
    if (Number.isFinite(winProb)) {
      sumWinProb += winProb;
      nWinProb++;
    }

    const conf = safeNum(g?.market?.confidence);
    if (Number.isFinite(conf)) {
      sumConf += conf;
      nConf++;
    }

    details.push({
      gameId: g?.gameId ?? g?.id ?? null,
      date: g?.date ?? dateYYYYMMDD,
      status,
      pickSide,
      homeScore,
      awayScore,
      result,
      edge: Number.isFinite(edge) ? edge : null,
      winProb: Number.isFinite(winProb) ? winProb : null,
      confidence: Number.isFinite(conf) ? conf : null,
    });
  }

  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : null;

  return {
    ok: true,
    league,
    date: dateYYYYMMDD,
    counts: {
      inputGames: rows.length,
      completed,
      picks,      // non-pass picks among finals
      graded,     // picks that got a W/L/PUSH
      wins,
      losses,
      pushes,
      noPick,
    },
    metrics: {
      winRate,
      avgEdge: nEdge > 0 ? sumEdge / nEdge : null,
      avgWinProb: nWinProb > 0 ? sumWinProb / nWinProb : null,
      avgConfidence: nConf > 0 ? sumConf / nConf : null,
    },
    details, // keep for debugging; you can remove later
  };
}

/**
 * Router (optional)
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "score", version: "score-v2" });
});

export default router;
