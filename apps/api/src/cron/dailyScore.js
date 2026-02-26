// apps/api/src/cron/dailyScore.js
import cron from "node-cron";

/**
 * Single runner used by BOTH:
 * - the scheduled cron
 * - the manual /api/admin/run-cron endpoint
 *
 * Supports multi-league scoring to match:
 *   /api/admin/run-cron?date=YYYY-MM-DD&leagues=nba,nhl,ncaam&force=1&grade=all
 */
export async function runDailyScoreOnce({ date, leagues, modelVersion, lookbackDays } = {}) {
  // Default = yesterday (UTC-safe date math)
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const ymd = (date && String(date).trim()) || d.toISOString().slice(0, 10);

  const leagueList = Array.isArray(leagues)
    ? leagues
    : String(leagues || "nba")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  // Defaults
  const mv = String(modelVersion || "v2");
  const lb = Number.isFinite(Number(lookbackDays)) ? Number(lookbackDays) : 14;

  console.log(`[CRON] Running scoring job for ${ymd} (leagues=${leagueList.join(",") || "nba"})`);

  // Lazy imports prevent circular dependency issues
  const { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } = await import("../routes/predict.js");
  const { scoreCompletedGames } = await import("../routes/score.js");

  const results = [];
  let totalScoredGames = 0;

  for (const league of leagueList) {
    try {
      if (league === "nba") {
        const nba = await buildNbaPredictions(ymd, lb, { modelVersion: mv });
        const report = await scoreCompletedGames("nba", ymd, nba?.games || []);
        const scoredGames = Array.isArray(nba?.games) ? nba.games.length : 0;
        totalScoredGames += scoredGames;

        results.push({ league: "nba", date: ymd, scoredGames, report });
        continue;
      }

      if (league === "nhl") {
        const nhl = await buildNhlPredictions(ymd, lb, { modelVersion: mv });
        const report = await scoreCompletedGames("nhl", ymd, nhl?.games || []);
        const scoredGames = Array.isArray(nhl?.games) ? nhl.games.length : 0;
        totalScoredGames += scoredGames;

        results.push({ league: "nhl", date: ymd, scoredGames, report });
        continue;
      }

      if (league === "ncaam") {
        const ncaam = await buildNcaamPredictions(ymd, lb, { modelVersion: mv });
        const report = await scoreCompletedGames("ncaam", ymd, ncaam?.games || []);
        const scoredGames = Array.isArray(ncaam?.games) ? ncaam.games.length : 0;
        totalScoredGames += scoredGames;

        results.push({ league: "ncaam", date: ymd, scoredGames, report });
        continue;
      }

      results.push({ league, date: ymd, scoredGames: 0, report: null, error: `unsupported_league:${league}` });
    } catch (err) {
      console.error(`[CRON] Error scoring ${league} for ${ymd}:`, err);
      results.push({ league, date: ymd, scoredGames: 0, report: null, error: String(err?.message || err) });
    }
  }

  console.log(`[CRON] Completed scoring for ${ymd} (totalGames=${totalScoredGames})`);

  return {
    ok: true,
    ranFor: ymd,
    scoredGames: totalScoredGames,
    results,
  };
}

/**
 * Schedule daily run at 03:30 AM Eastern Time
 * - Automatically handles DST
 * - Locked to America/New_York
 */
export function startDailyScoreJob() {
  const expr = "30 3 * * *"; // 03:30 local (America/New_York)

  cron.schedule(
    expr,
    async () => {
      try {
        await runDailyScoreOnce(); // defaults to yesterday + nba
      } catch (err) {
        // Never crash the API due to cron
        console.error("[CRON] Unhandled error:", err);
      }
    },
    {
      timezone: "America/New_York", // ✅ Eastern Time (DST-aware)
    }
  );

  console.log(`[CRON] Scheduled daily scoring job: "${expr}" (America/New_York — 03:30 AM Eastern)`);
}

/**
 * Compatibility export for /api/admin/run-cron
 * Your admin endpoint expects one of:
 * - runDailyScoreForDate(date, opts)
 * - runDailyScore(date, opts)
 * - scoreDate(date, opts)
 *
 * We provide runDailyScoreForDate and map it to the real runner.
 */
export async function runDailyScoreForDate(date, opts = {}) {
  return runDailyScoreOnce({ date, ...opts });
}