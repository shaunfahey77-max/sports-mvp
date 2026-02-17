// apps/api/src/cron/dailyScore.js
import cron from "node-cron";

/**
 * Single runner used by BOTH:
 * - the scheduled cron
 * - the manual /api/admin/run-cron endpoint
 */
export async function runDailyScoreOnce({ date } = {}) {
  // Default = yesterday (UTC-safe date math)
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const ymd = (date && String(date).trim()) || d.toISOString().slice(0, 10);

  console.log(`[CRON] Running scoring job for ${ymd}`);

  // Lazy imports prevent circular dependency issues
  const { buildNbaPredictions } = await import("../routes/predict.js");
  const { scoreCompletedGames } = await import("../routes/score.js");

  // Build predictions (v2 premium model)
  const nba = await buildNbaPredictions(ymd, 14, { modelVersion: "v2" });

  // Score completed games
  const report = await scoreCompletedGames("nba", ymd, nba?.games || []);

  const scoredGames = Array.isArray(nba?.games) ? nba.games.length : 0;

  console.log(`[CRON] Completed scoring for ${ymd} (games=${scoredGames})`);

  return {
    ranFor: ymd,
    scoredGames,
    report,
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
        await runDailyScoreOnce();
      } catch (err) {
        console.error("[CRON] Error:", err);
      }
    },
    {
      timezone: "America/New_York", // ✅ Eastern Time (DST-aware)
    }
  );

  console.log(
    `[CRON] Scheduled daily scoring job: "${expr}" (America/New_York — 03:30 AM Eastern)`
  );
}
