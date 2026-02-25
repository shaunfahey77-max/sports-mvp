// apps/api/src/routes/score.js
import express from "express";

const router = express.Router();

/* =========================================================
   Helpers
   ========================================================= */

function normStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isFinalStatus(status) {
  const s = normStatus(status);

  // IMPORTANT:
  // ESPN sometimes uses "post" for "postponed" / "post" state-like values.
  // Do NOT treat "post" as final.
  if (!s) return false;

  // Most common finals
  if (s === "final") return true;
  if (s === "completed" || s === "complete") return true;

  // Handles "final/ot", "final (ot)", "final - so", etc.
  if (s.includes("final")) return true;

  return false;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getScoresFromGame(g) {
  const hs =
    safeNum(g?.homeScore) ??
    safeNum(g?.home_score) ??
    safeNum(g?.home?.score) ??
    safeNum(g?.homeTeam?.score) ??
    null;

  const as =
    safeNum(g?.awayScore) ??
    safeNum(g?.away_score) ??
    safeNum(g?.away?.score) ??
    safeNum(g?.awayTeam?.score) ??
    null;

  return { homeScore: hs, awayScore: as };
}

function hasRealScores(homeScore, awayScore) {
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return false;

  // Critical guard to avoid placeholder 0-0 "scores"
  if (homeScore + awayScore <= 0) return false;

  return true;
}

function getPickSide(g) {
  // unified contract: g.market.pick OR legacy g.pick
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

/* =========================================================
   ✅ Named export (cron/admin rely on this)
   - opts is optional and backwards compatible
   ========================================================= */

export async function scoreCompletedGames(league, dateYYYYMMDD, games = [], opts = {}) {
  const rows = Array.isArray(games) ? games : [];

  // currently unused by logic, but accepted for compatibility
  const force = String(opts.force || "0") === "1" || opts.force === true;
  const grade = String(opts.grade || "all"); // e.g. all | picks
  void force;
  void grade;

  let completed = 0;
  let picks = 0;     // non-pass picks among finals
  let graded = 0;    // wins+losses+pushes
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noPick = 0;

  let sumEdge = 0;
  let nEdge = 0;

  let sumWinProb = 0;
  let nWinProb = 0;

  let sumConf = 0;
  let nConf = 0;

  const details = [];

  for (const g of rows) {
    const status = g?.status ?? g?.state ?? g?.gameStatus ?? "";
    if (!isFinalStatus(status)) continue;

    const { homeScore, awayScore } = getScoresFromGame(g);

    // ✅ Only count as "completed" if it has real scores
    if (!hasRealScores(homeScore, awayScore)) continue;

    completed++;

    const pickSide = getPickSide(g);
    if (!pickSide) {
      noPick++;
      continue;
    }

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

  const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

  return {
    ok: true,
    league,
    date: dateYYYYMMDD,
    counts: {
      inputGames: rows.length,
      completed,
      picks,
      graded,
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
    details, // keep for now (debugging). You can remove later.
  };
}

/* =========================================================
   Router (optional)
   ========================================================= */

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "score", version: "score-v3-real-finals-only" });
});

export default router;