// apps/api/scripts/backfillCanary.js
    // Canary backfill using the live scoring architecture.
    // Uses runDailyScoreOnce from dailyScore.js — same predict.js, premiumSelection.js,
    // premiumStrategy.js, and writeSlatePicksToLedger path as live scoring.
    //
    // Usage:
    //   node --env-file=.env scripts/backfillCanary.js          # 7-day canary (default)
    //   BACKFILL_DAYS=30 node --env-file=.env scripts/backfillCanary.js  # 30-day window
    //
    // Run from: apps/api/
    //
    // NOTE: Each date is wiped clean before re-scoring so that disabling a market
    // (e.g. NHL spread) removes old picks automatically — no manual cleanup needed.

    import { runDailyScoreOnce } from "../src/cron/dailyScore.js";
    import { supabase } from "../src/db/dailyLedger.js";

    const DAYS = Number(process.env.BACKFILL_DAYS) || 7;
    const LEAGUES = ["nba", "ncaam", "nhl"];

    async function deletePicksForDate(date) {
      const { error, count } = await supabase
        .from("picks_daily")
        .delete({ count: "exact" })
        .eq("date", date)
        .in("league", LEAGUES);
      if (error) throw new Error(`Failed to delete picks for ${date}: ${error.message}`);
      return count ?? 0;
    }

    console.log(`Starting canary backfill: ${DAYS} day(s)`);
    console.log("Architecture: predict.js → premiumSelection.js → premiumStrategy.js → writeSlatePicksToLedger");
    console.log("Clean-slate mode: existing picks deleted before each date is re-scored\n");

    for (let i = 1; i <= DAYS; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);

      console.log(`=== [${i}/${DAYS}] Backfilling ${date} ===`);
      try {
        const deleted = await deletePicksForDate(date);
        if (deleted > 0) console.log(`  Cleared ${deleted} stale pick(s) for ${date}`);

        const { ok, results, totalGames } = await runDailyScoreOnce({
          date,
          leagues: LEAGUES,
        });
        console.log(`  totalGames=${totalGames} ok=${ok}`);
        for (const r of results) {
          if (r.ok) {
            const rep = r.report || {};
            console.log(`  ${r.league.toUpperCase()}: graded=${rep.graded ?? "?"} wins=${rep.wins ?? "?"} losses=${rep.losses ?? "?"} recommended=${rep.recommended ?? "?"}`);
          } else {
            console.log(`  ${r.league.toUpperCase()}: ERROR — ${r.error}`);
          }
        }
      } catch (err) {
        console.error(`  FATAL error on ${date}: ${err.message}`);
      }
    }

    console.log("\nBackfill complete.");
    