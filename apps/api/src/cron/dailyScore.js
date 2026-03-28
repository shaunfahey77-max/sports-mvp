// apps/api/src/cron/dailyScore.js
import "dotenv/config";
import cron from "node-cron";
import { writeSlatePicksToLedger, upsertPerformanceDaily } from "../db/dailyLedger.js";
import { MARKET_GATING } from "../config/premiumStrategy.js";

/**
 * Premium v20 CRON runner (market-aware)
 * - Grades moneyline / spread / total using `game.recommendedBet` (v18 predict contract)
 * - Computes wins/losses/push/pass + win rate
 * - Computes simple ROI using American odds (1u stake per graded pick)
 * - Safe error containment (never crashes API)
 *
 * NOTE:
 * - This runner DOES NOT depend on routes/score.js, so it won't break if score router is legacy.
 * - It still writes the full `games` array to the ledger so you can audit picks later.
 */

const DEFAULT_LOOKBACK = Object.freeze({
  nba: 14,
  nhl: 40,
  ncaam: 45,
});

function ymdYesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseLeagueList(leagues) {
  const list = Array.isArray(leagues)
    ? leagues.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    : String(leagues || "nba,nhl,ncaam")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  return Array.from(new Set(list));
}

function getLookbackForLeague(league, lookbackDays) {
  const override = Number.isFinite(Number(lookbackDays)) ? Number(lookbackDays) : null;
  if (override != null) return override;
  return DEFAULT_LOOKBACK[league] ?? 14;
}

async function loadBuilders() {
  // avoids circular import issues; predict exports named builders
  const mod = await import("../routes/predict.js");
  return {
    buildNbaPredictions: mod.buildNbaPredictions,
    buildNhlPredictions: mod.buildNhlPredictions,
    buildNcaamPredictions: mod.buildNcaamPredictions,
  };
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isFinal(game) {
  const s = String(game?.status || "").toLowerCase();
  return s === "final" || s.includes("final") || s.includes("post");
}

function getScores(game) {
  const hs = safeNum(game?.score?.home ?? game?.home?.score);
  const as = safeNum(game?.score?.away ?? game?.away?.score);
  if (hs == null || as == null) return null;
  return { hs, as, total: hs + as };
}

function americanProfitPer1u(oddsAmerican) {
  const o = Number(oddsAmerican);
  if (!Number.isFinite(o) || o === 0) return null;
  if (o > 0) return o / 100; // win profit on 1u stake
  return 100 / Math.abs(o);
}

/**
 * Grade a single game’s recommended bet.
 * Returns one of: "WIN" | "LOSS" | "PUSH" | "PASS" | "NO_SCORE"
 */
function gradeRecommendedBet(game) {
  const bet = game?.recommendedBet || null;
  const tier = String(bet?.tier || game?.market?.tier || "PASS");
  if (!bet || tier === "PASS") return { result: "PASS", profit: 0, tier, marketType: null };

  if (!isFinal(game)) return { result: "NO_SCORE", profit: 0, tier, marketType: bet.marketType || null };

  const scores = getScores(game);
  if (!scores) return { result: "NO_SCORE", profit: 0, tier, marketType: bet.marketType || null };

  const mt = String(bet.marketType || "").toLowerCase();
  const side = String(bet.side || "").toLowerCase();
  const line = safeNum(bet.line);
  const odds = safeNum(bet.odds);
  const profitOnWin = americanProfitPer1u(odds);

  // If we can't compute profit, we'll still grade W/L/P, but ROI will skip it.
  const winProfit = profitOnWin == null ? 0 : profitOnWin;

  const { hs, as, total } = scores;

  // MONEYLINE
  if (mt === "moneyline") {
    const homeWon = hs > as;
    const awayWon = as > hs;
    if (hs === as) return { result: "PUSH", profit: 0, tier, marketType: "moneyline" };

    const didWin = side === "home" ? homeWon : side === "away" ? awayWon : false;
    if (didWin) return { result: "WIN", profit: winProfit, tier, marketType: "moneyline" };
    return { result: "LOSS", profit: -1, tier, marketType: "moneyline" };
  }

  // SPREAD
  if (mt === "spread") {
    if (line == null) return { result: "PASS", profit: 0, tier: "PASS", marketType: "spread" };

    // The line is the side's line (home -3.5 or away +3.5).
    let adjustedHome = hs;
    let adjustedAway = as;

    if (side === "home") adjustedHome = hs + line;
    else if (side === "away") adjustedAway = as + line;
    else return { result: "PASS", profit: 0, tier: "PASS", marketType: "spread" };

    if (adjustedHome === adjustedAway) return { result: "PUSH", profit: 0, tier, marketType: "spread" };
    const didWin = adjustedHome > adjustedAway;
    if (didWin) return { result: "WIN", profit: winProfit, tier, marketType: "spread" };
    return { result: "LOSS", profit: -1, tier, marketType: "spread" };
  }

  // TOTALS
  if (mt === "total" || mt === "totals") {
    if (line == null) return { result: "PASS", profit: 0, tier: "PASS", marketType: "total" };

    if (total === line) return { result: "PUSH", profit: 0, tier, marketType: "total" };

    if (side !== "over" && side !== "under") {
      return { result: "PASS", profit: 0, tier: "PASS", marketType: "total" };
    }

    const didWin = side === "over" ? total > line : total < line;
    if (didWin) return { result: "WIN", profit: winProfit, tier, marketType: "total" };
    return { result: "LOSS", profit: -1, tier, marketType: "total" };
  }

  // Unknown market type => treat as PASS (safe)
  return { result: "PASS", profit: 0, tier: "PASS", marketType: mt || null };
}

/**
 * Score a full slate.
 * Returns: { counts, metrics, byMarket, byTier }
 */
function scoreSlate(games) {
  const counts = {
    inputGames: games.length,
    completedFinals: 0,
    completedWithScore: 0,
    picks: 0,
    graded: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    pass: 0,
  };

  let profitUnits = 0;
  let profitCounted = 0;

  const byMarket = {}; // { moneyline: {wins,losses,pushes,pass,graded,profit} ... }
  const byTier = {};   // { ELITE: {wins,losses,pushes,pass,graded,profit} ... }

  function ensure(map, key) {
    if (!map[key]) map[key] = { wins: 0, losses: 0, pushes: 0, pass: 0, graded: 0, profit: 0 };
    return map[key];
  }

  for (const g of games) {
    if (isFinal(g)) counts.completedFinals++;

    const scores = getScores(g);
    if (scores) counts.completedWithScore++;

    const bet = g?.recommendedBet || null;
    const tier = String(bet?.tier || g?.market?.tier || "PASS");
    const graded = gradeRecommendedBet(g);

    const mtKey = graded.marketType || String(bet?.marketType || "unknown").toLowerCase();
    const tierKey = tier || "UNKNOWN";

    if (graded.result === "NO_SCORE") continue;

    if (graded.result === "PASS") {
      counts.pass++;
      ensure(byMarket, mtKey).pass += 1;
      ensure(byTier, tierKey).pass += 1;
      continue;
    }

    counts.picks++;
    counts.graded++;

    ensure(byMarket, mtKey).graded += 1;
    ensure(byTier, tierKey).graded += 1;

    if (graded.result === "WIN") {
      counts.wins++;
      ensure(byMarket, mtKey).wins += 1;
      ensure(byTier, tierKey).wins += 1;
    } else if (graded.result === "LOSS") {
      counts.losses++;
      ensure(byMarket, mtKey).losses += 1;
      ensure(byTier, tierKey).losses += 1;
    } else if (graded.result === "PUSH") {
      counts.pushes++;
      ensure(byMarket, mtKey).pushes += 1;
      ensure(byTier, tierKey).pushes += 1;
    }

    if (Number.isFinite(graded.profit)) {
      profitUnits += graded.profit;
      profitCounted += 1;
      ensure(byMarket, mtKey).profit += graded.profit;
      ensure(byTier, tierKey).profit += graded.profit;
    }
  }

  const winRate = counts.graded ? counts.wins / counts.graded : null;
  const roi = profitCounted ? profitUnits / profitCounted : null; // per 1u stake per graded bet

  return {
    counts,
    metrics: { winRate, roi, profitUnits, profitCounted },
    byMarket,
    byTier,
  };
}

export async function runDailyScoreOnce({ date, leagues, lookbackDays, modelVersion } = {}) {
  const ymd = (date && String(date).trim()) || ymdYesterdayUTC();
  const leagueList = parseLeagueList(leagues);
  const mv = String(modelVersion || "v2").toLowerCase();

  const { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } = await loadBuilders();

  console.log(`[CRON v21] Run scoring for ${ymd} leagues=${leagueList.join(",")}`);

  const results = [];
  let totalGames = 0;

  for (const league of leagueList) {
    try {
      const lb = getLookbackForLeague(league, lookbackDays);

      let slate;
      if (league === "nba") slate = await buildNbaPredictions(ymd, lb, { modelVersion: mv });
      else if (league === "nhl") slate = await buildNhlPredictions(ymd, lb);
      else if (league === "ncaam") slate = await buildNcaamPredictions(ymd, lb, { tournamentMode: false, modeLabel: "regular" });
      else {
        results.push({ league, ok: false, date: ymd, error: `unsupported_league:${league}` });
        continue;
      }

      const games = Array.isArray(slate?.games) ? slate.games : [];
      totalGames += games.length;

      // Scrub recommendedBet for any market type blocked by MARKET_GATING.
      // Prevents modelOnly fallbacks (e.g. NCAAM moneyline) from being written
      // to the ledger as real picks when their market type is gated off.
      const leagueGating = MARKET_GATING[league] || {};
      const gatedGames = games.map((g) => {
        const bet = g?.recommendedBet;
        if (!bet) return g;
        const mt = String(bet.marketType || "").toLowerCase();
        if (leagueGating[mt] === false) return { ...g, recommendedBet: null };
        return g;
      });

      // 1) Ledger write (what we recommended, regardless of finals)
      await writeSlatePicksToLedger({
        date: ymd,
        league,
        modelVersion: slate?.meta?.model || "premium-v18",
        oddsOk: Boolean(slate?.meta?.odds?.ok),
        games: gatedGames,
      });

      // 2) Score completed finals (market-aware, based on recommendedBet)
      const report = scoreSlate(games);
      const counts = report?.counts || {};
      const metrics = report?.metrics || {};

      const wins = Number(counts.wins ?? 0);
      const losses = Number(counts.losses ?? 0);
      const pushes = Number(counts.pushes ?? 0);
      const pass = Number(counts.pass ?? 0);

      const graded = Number.isFinite(Number(counts.graded)) ? Number(counts.graded) : wins + losses + pushes;
      const winRate = Number.isFinite(Number(metrics.winRate)) ? Number(metrics.winRate) : graded ? wins / graded : null;

      // 3) Persist daily performance
      // IMPORTANT: If your DB table does NOT have roi/profit_units/by_market/by_tier columns,
      // remove those 4 fields below.
      await upsertPerformanceDaily({
        date: ymd,
        league,
        model_version: slate?.meta?.model || "premium-v18",
        window_days: lb,

        games: games.length,
        completed: Number(counts.completedFinals ?? 0),
        picks: Number(counts.picks ?? 0),

        wins,
        losses,
        pushes,
        pass,

        scored: graded,
        acc: winRate,
        win_rate: winRate,

        roi: Number.isFinite(Number(metrics.roi)) ? Number(metrics.roi) : null,
        profit_units: Number.isFinite(Number(metrics.profitUnits)) ? Number(metrics.profitUnits) : null,
        by_market: report?.byMarket ?? null,
        by_tier: report?.byTier ?? null,

        odds_ok: slate?.meta?.odds?.ok ?? null,
        odds_reason: slate?.meta?.odds?.reason ?? null,

        error: null,
        notes: null,
      });

      results.push({ league, ok: true, date: ymd, report });
      console.log(`[CRON v21] ${league} ${ymd}: graded=${graded} W=${wins} L=${losses} P=${pushes} PASS=${pass}`);
    } catch (err) {
      console.error(`[CRON v21] Error scoring ${league} for ${ymd}:`, err);
      results.push({ league, ok: false, date: ymd, error: String(err?.message || err) });
    }
  }

  console.log(`[CRON v21] Completed scoring for ${ymd} totalGames=${totalGames}`);

  return { ok: true, ranFor: ymd, totalGames, results };
}

/**
 * Daily schedule: 03:30 AM Eastern (DST safe) — v20 (model-only backfill enabled)
 */
export function startDailyScoreJob() {
  const expr = "30 3 * * *";

  cron.schedule(
    expr,
    async () => {
      try {
        await runDailyScoreOnce(); // defaults: yesterday + nba
      } catch (err) {
        console.error("[CRON v21] Unhandled error:", err);
      }
    },
    { timezone: "America/New_York" }
  );

  console.log(`[CRON v21] Scheduled daily scoring job: "${expr}" (America/New_York)`);
}

/**
 * Compatibility export for admin endpoints
 */
export async function runDailyScoreForDate(date, opts = {}) {
  return runDailyScoreOnce({ date, ...opts });
}
