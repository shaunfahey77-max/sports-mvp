// apps/api/src/cron/dailyScore.js
import cron from "node-cron";
import {
  upsertPerformanceDaily,
  writeSlatePicksToLedger,
} from "../db/dailyLedger.js";

/**
 * Single runner used by BOTH:
 * - the scheduled cron
 * - the manual /api/admin/run-cron endpoint
 *
 * Premium goals:
 * - per-league lookback defaults (NBA/NHL/NCAAM are not the same)
 * - persist scored + acc/win_rate correctly
 * - stable, non-spaghetti control flow
 * - consistent result shape for backfills
 */

// Per-league default windows (match your model expectations)
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
    : String(leagues || "nba")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  // de-dupe while preserving order
  return Array.from(new Set(list));
}

function parseModelVersion(modelVersion) {
  return String(modelVersion || "v2").trim() || "v2";
}

/**
 * lookbackDays:
 * - if provided, overrides ALL leagues (useful for experiments)
 * - otherwise uses per-league defaults above
 */
function getLookbackForLeague(league, lookbackDays) {
  const override = Number.isFinite(Number(lookbackDays))
    ? Number(lookbackDays)
    : null;
  if (override != null) return override;
  return DEFAULT_LOOKBACK[league] ?? 14;
}

export async function runDailyScoreOnce({
  date,
  leagues,
  modelVersion,
  lookbackDays,
} = {}) {
  const ymd = (date && String(date).trim()) || ymdYesterdayUTC();
  const leagueList = parseLeagueList(leagues);
  const mv = parseModelVersion(modelVersion);

  console.log(
    `[CRON] Running scoring job for ${ymd} (leagues=${
      leagueList.join(",") || "nba"
    })`
  );

  // Lazy imports prevent circular dependency issues
  const { buildNbaPredictions, buildNhlPredictions, buildNcaamPredictions } =
    await import("../routes/predict.js");
  const { scoreCompletedGames } = await import("../routes/score.js");

  const results = [];
  let totalScoredGames = 0;

  async function persistDaily({ league, slate, report }) {
    const counts = report?.counts || {};
    const metrics = report?.metrics || {};

    const wins = counts.wins ?? 0;
    const losses = counts.losses ?? 0;
    const pushes = counts.pushes ?? 0;

    // ✅ scored = graded if present, else wins+losses+pushes
    const scored = Number.isFinite(Number(counts.graded))
      ? Number(counts.graded)
      : wins + losses + pushes;

    // ✅ accuracy/win_rate: prefer metrics.winRate else compute
    const acc = Number.isFinite(Number(metrics.winRate))
      ? Number(metrics.winRate)
      : scored
      ? wins / scored
      : null;

    await upsertPerformanceDaily({
      date: ymd,
      league,
      games:
        counts.inputGames ??
        (Array.isArray(slate?.games) ? slate.games.length : 0),
      completed: counts.completed ?? 0,
      picks: counts.picks ?? 0,
      wins,
      losses,
      pushes,
      pass: counts.noPick ?? 0,

      // ✅ IMPORTANT: these fix /api/performance scored + acc showing 0/null
      scored,
      acc,
      win_rate: acc,

      model_version: mv,
      vegas_ok: slate?.meta?.vegasOk ?? null,

      error: report?.ok === false ? "score_failed" : null,
      notes: null,
    });
  }

  for (const league of leagueList) {
    try {
      if (league === "nba") {
        const lb = getLookbackForLeague("nba", lookbackDays);
        const nba = await buildNbaPredictions(ymd, lb, { modelVersion: mv });

        await writeSlatePicksToLedger({
          date: ymd,
          league: "nba",
          games: nba?.games || [],
          modelVersion: mv,
        });

        const report = await scoreCompletedGames("nba", ymd, nba?.games || []);
        await persistDaily({ league: "nba", slate: nba, report });

        totalScoredGames += Array.isArray(nba?.games) ? nba.games.length : 0;
        results.push({ league: "nba", ok: true, date: ymd, report });
        continue;
      }

      if (league === "nhl") {
        // ✅ KEY FIX: NHL needs a deeper lookback than NBA
        const lb = getLookbackForLeague("nhl", lookbackDays);
        const nhl = await buildNhlPredictions(ymd, lb, { modelVersion: mv });

        await writeSlatePicksToLedger({
          date: ymd,
          league: "nhl",
          games: nhl?.games || [],
          modelVersion: mv,
        });

        const report = await scoreCompletedGames("nhl", ymd, nhl?.games || []);
        await persistDaily({ league: "nhl", slate: nhl, report });

        totalScoredGames += Array.isArray(nhl?.games) ? nhl.games.length : 0;
        results.push({ league: "nhl", ok: true, date: ymd, report });
        continue;
      }

      if (league === "ncaam") {
        const lb = getLookbackForLeague("ncaam", lookbackDays);
        const ncaam = await buildNcaamPredictions(ymd, lb, {
          modelVersion: mv,
        });

        await writeSlatePicksToLedger({
          date: ymd,
          league: "ncaam",
          games: ncaam?.games || [],
          modelVersion: mv,
        });

        const report = await scoreCompletedGames(
          "ncaam",
          ymd,
          ncaam?.games || []
        );
        await persistDaily({ league: "ncaam", slate: ncaam, report });

        totalScoredGames += Array.isArray(ncaam?.games)
          ? ncaam.games.length
          : 0;
        results.push({ league: "ncaam", ok: true, date: ymd, report });
        continue;
      }

      results.push({
        league,
        ok: false,
        date: ymd,
        report: null,
        error: `unsupported_league:${league}`,
      });
    } catch (err) {
      console.error(`[CRON] Error scoring ${league} for ${ymd}:`, err);
      results.push({
        league,
        ok: false,
        date: ymd,
        report: null,
        error: String(err?.message || err),
      });
    }
  }

  console.log(
    `[CRON] Completed scoring for ${ymd} (totalGames=${totalScoredGames})`
  );

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
    { timezone: "America/New_York" }
  );

  console.log(
    `[CRON] Scheduled daily scoring job: "${expr}" (America/New_York — 03:30 AM Eastern)`
  );
}

/**
 * Compatibility export for /api/admin/run-cron
 */
export async function runDailyScoreForDate(date, opts = {}) {
  return runDailyScoreOnce({ date, ...opts });
}