// apps/api/src/cron/dailyScore.js
import cron from "node-cron";

function ymdOrYesterdayUTC(date) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const fallback = d.toISOString().slice(0, 10);
  const ymd = (date && String(date).trim()) || fallback;
  return ymd;
}

/**
 * Try to get premium predictions via shared module function.
 * If not available, fallback to hitting our own HTTP endpoint.
 */
async function getPremiumPredictions({ league, date }) {
  // 1) Preferred: direct function import (no HTTP, fastest, consistent)
  try {
    const mod = await import("../routes/predictions.js");

    // If you already have / can add an exported helper like:
    // export async function getPredictionsFor({ league, date, ... })
    const fn =
      mod.getPredictionsFor ||
      mod.getPredictions ||
      mod.buildPredictions ||
      null;

    if (typeof fn === "function") {
      return await fn({ league, date });
    }
  } catch {
    // ignore and fallback to HTTP
  }

  // 2) Fallback: call our own API (slower but robust)
  const base = process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}`;
  const url = `${base}/api/predictions?league=${encodeURIComponent(league)}&date=${encodeURIComponent(date)}`;

  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    const msg = json?.error || `Failed to fetch premium predictions (${res.status})`;
    throw new Error(msg);
  }

  return json;
}

/**
 * Single runner used by BOTH:
 * - the scheduled cron
 * - the manual /api/admin/run-cron endpoint
 */
export async function runDailyScoreOnce({ date, league = "nba" } = {}) {
  const ymd = ymdOrYesterdayUTC(date);

  console.log(`[CRON] Running PREMIUM scoring job for ${league} on ${ymd}`);

  // Lazy import prevents circular dependency issues
  const { scoreCompletedGames } = await import("../routes/score.js");

  // Pull PREMIUM predictions (same contract the UI/upsets should use)
  const pred = await getPremiumPredictions({ league, date: ymd });

  // Normalize games array from common shapes
  const games =
    pred?.games ||
    pred?.data?.games ||
    pred?.rows ||
    [];

  const report = await scoreCompletedGames(league, ymd, games);

  const scoredGames = Array.isArray(games) ? games.length : 0;

  console.log(`[CRON] Completed PREMIUM scoring for ${league} ${ymd} (games=${scoredGames})`);

  return {
    ranFor: ymd,
    league,
    scoredGames,
    report,
    source: pred?.meta?.source || pred?._source || "premium-predictions",
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
        // NBA first (expand to nhl/ncaam after you confirm scoring is perfect)
        await runDailyScoreOnce({ league: "nba" });
      } catch (err) {
        console.error("[CRON] Error:", err?.message || err);
      }
    },
    { timezone: "America/New_York" }
  );

  console.log(`[CRON] Scheduled daily scoring job: "${expr}" (America/New_York — 03:30 AM Eastern)`);
}
