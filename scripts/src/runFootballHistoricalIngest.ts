/**
 * Run the historical-ingest service for NFL or NCAAF over a date window
 * and block until it finishes (or the timeout fires).
 *
 * Cost: ~30 credits per (date × league) — verified empirically against
 * the Odds API historical endpoint on 2025-01-05. Uses the same
 * service code path as the existing NBA/NHL ingest, so all the
 * downstream behavior (game_snapshots upsert + scored_picks insert
 * for non-PASS picks) is identical.
 *
 * No deploy, no public exposure — this only writes historical rows
 * to game_snapshots / scored_picks for the requested league. Cron
 * still does not pull NFL/NCAAF and the public surface still does
 * not list them.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx \
 *     src/runFootballHistoricalIngest.ts \
 *     --league nfl --start 2025-09-01 --end 2026-02-10 \
 *     [--delay-ms 250] [--poll-ms 5000] [--timeout-ms 1800000]
 */

import {
  startHistoricalIngest,
  getHistoricalIngestStatus,
} from "../../artifacts/api-server/src/services/historicalIngest";
import type { League } from "../../artifacts/api-server/src/config/scoringModelConfig";

interface Args {
  league: League;
  start: string;
  end: string;
  delayMs: number;
  pollMs: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    delayMs: 250,
    pollMs: 5000,
    timeoutMs: 30 * 60 * 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === "--league") out.league = next() as League;
    else if (a === "--start") out.start = next();
    else if (a === "--end") out.end = next();
    else if (a === "--delay-ms") out.delayMs = Number(next());
    else if (a === "--poll-ms") out.pollMs = Number(next());
    else if (a === "--timeout-ms") out.timeoutMs = Number(next());
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.league || !out.start || !out.end) {
    throw new Error("--league, --start, --end are all required");
  }
  return out as Args;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const existing = getHistoricalIngestStatus();
  if (existing?.status === "running") {
    console.error(
      "Another historical ingest is already running:",
      JSON.stringify(existing, null, 2)
    );
    process.exit(2);
  }

  console.log(
    JSON.stringify({
      msg: "Starting historical ingest",
      league: args.league,
      start: args.start,
      end: args.end,
      delayMs: args.delayMs,
    })
  );

  startHistoricalIngest({
    leagues: [args.league],
    startDate: args.start,
    endDate: args.end,
    delayMs: args.delayMs,
  });

  const t0 = Date.now();
  let lastDates = -1;
  while (true) {
    const s = getHistoricalIngestStatus();
    if (!s) {
      console.error("Status disappeared unexpectedly");
      process.exit(3);
    }
    if (s.datesProcessed !== lastDates) {
      lastDates = s.datesProcessed;
      const pct = s.datesTotal > 0 ? ((s.datesProcessed / s.datesTotal) * 100).toFixed(1) : "0";
      console.log(
        JSON.stringify({
          progress: `${pct}%`,
          datesProcessed: s.datesProcessed,
          datesTotal: s.datesTotal,
          gamesIngested: s.gamesIngested,
          picksInserted: s.picksInserted,
          creditsUsed: s.creditsUsed,
          errorsSoFar: s.errors.length,
          elapsedSec: Math.round((Date.now() - t0) / 1000),
        })
      );
    }
    if (s.status === "complete" || s.status === "failed") {
      console.log(
        JSON.stringify({
          msg: "Ingest finished",
          finalStatus: s.status,
          datesProcessed: s.datesProcessed,
          datesTotal: s.datesTotal,
          gamesIngested: s.gamesIngested,
          picksInserted: s.picksInserted,
          creditsUsed: s.creditsUsed,
          errors: s.errors.slice(0, 20),
          elapsedSec: Math.round((Date.now() - t0) / 1000),
        })
      );
      process.exit(s.status === "complete" ? 0 : 4);
    }
    if (Date.now() - t0 > args.timeoutMs) {
      console.error(
        JSON.stringify({
          msg: "Timed out waiting for ingest",
          status: s,
          elapsedSec: Math.round((Date.now() - t0) / 1000),
        })
      );
      process.exit(5);
    }
    await sleep(args.pollMs);
  }
}

main().catch((err) => {
  console.error("runFootballHistoricalIngest failed:", err);
  process.exit(1);
});
