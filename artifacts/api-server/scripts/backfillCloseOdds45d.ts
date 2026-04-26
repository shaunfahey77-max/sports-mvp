/**
 * One-shot historical CLV backfill — populates game_snapshots.close_* fields
 * for the trailing 45 days using the Odds API historical endpoint
 * (/v4/historical/sports/{sport}/odds), then re-runs the CLV writeback for
 * every settled scored_pick whose snapshot just gained a close.
 *
 * Why this exists:
 *   The 2026-04-26 CLV-integrity fix made the runClosingOddsCapture cron the
 *   single writer of close_*. Going forward, every new game gets a real
 *   T-2min close. But every snapshot already in the DB before the fix
 *   either has close_* == publish_* (fake-zero CLV) or close_* == NULL.
 *   This script re-creates those rows from the historical odds feed, paid
 *   for by the same Odds API key, scoped to the last 45 days.
 *
 * Behavior:
 *   - Selects all game_snapshots WHERE event_start in [now - 45d, now] AND
 *     home_close_ml IS NULL (real missing data — newly written by the
 *     CLV-integrity fix; pre-fix rows have copy-of-publish, see "purge"
 *     mode below).
 *   - For each snapshot, fetches /v4/historical/sports/{sport}/odds at
 *     event_start - 2 minutes (the conventional close moment), normalizes
 *     each returned game through transformGame, looks up the matching
 *     gameKey, and writes close_* fields.
 *   - After all close_* updates: re-runs computeClvWritebackValues for every
 *     settled scored_pick referencing an updated snapshot, so close_odds /
 *     close_line / clv_implied_delta / clv_line_delta are repaired in place.
 *
 * Modes (set via CLI flag):
 *   --mode=missing-only   (default) only backfill rows where home_close_ml IS NULL
 *   --mode=purge-and-redo first NULL out close_* on every snapshot in the
 *                         window, then backfill all of them. Use this once
 *                         post-deploy to remove the legacy publish=close
 *                         garbage; never run it on a healthy DB.
 *
 * Other CLI flags:
 *   --days=N              window length, default 45, max 90 (Odds API's
 *                         historical retention limit varies by plan).
 *   --leagues=nba,nhl     restrict to specific leagues; default = all
 *                         leagues present in game_snapshots.
 *   --dry-run             query and report counts; do not write anything.
 *   --max-games=N         hard cap on snapshots processed; for staged runs.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/backfillCloseOdds45d.ts \
 *     --mode=purge-and-redo --days=45
 *
 * Cost:
 *   One historical-endpoint call per snapshot. The Odds API charges these
 *   the same as live calls. ~30 games/day across nba+nhl × 45 days ≈ 1350
 *   calls. Confirm budget before running.
 */

import { db } from "@workspace/db";
import {
  gameSnapshotsTable,
  scoredPicksTable,
} from "@workspace/db";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { fetchHistoricalOdds, transformGame, SPORT_KEYS } from "../src/lib/oddsApi";
import { computeClvWritebackValues } from "../src/scoring/clvWriteback";
import { logger } from "../src/lib/logger";

interface CliArgs {
  mode: "missing-only" | "purge-and-redo";
  days: number;
  leagues: string[] | null;
  dryRun: boolean;
  maxGames: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "missing-only",
    days: 45,
    leagues: null,
    dryRun: false,
    maxGames: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--mode=")) {
      const v = arg.slice("--mode=".length);
      if (v !== "missing-only" && v !== "purge-and-redo") {
        throw new Error(`--mode must be missing-only|purge-and-redo (got ${v})`);
      }
      args.mode = v;
    } else if (arg.startsWith("--days=")) {
      const n = Number(arg.slice("--days=".length));
      if (!Number.isInteger(n) || n <= 0 || n > 90) {
        throw new Error(`--days must be 1..90 (got ${n})`);
      }
      args.days = n;
    } else if (arg.startsWith("--leagues=")) {
      args.leagues = arg
        .slice("--leagues=".length)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (arg.startsWith("--max-games=")) {
      const n = Number(arg.slice("--max-games=".length));
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--max-games must be a positive integer (got ${n})`);
      }
      args.maxGames = n;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const start = new Date(Date.now() - args.days * 86400_000);
  const end = new Date();

  logger.info(
    {
      mode: args.mode,
      days: args.days,
      leagues: args.leagues ?? "all",
      dryRun: args.dryRun,
      maxGames: args.maxGames ?? "no-cap",
      window: { start: start.toISOString(), end: end.toISOString() },
    },
    "backfillCloseOdds45d: starting",
  );

  // 1. Optional purge: clear close_* on any snapshot in window AND clear the
  //    derived CLV fields on every settled scored_pick tied to those snapshots.
  //
  //    The two-step purge is critical (architect review fix). If we only NULL
  //    the snapshot.close_* fields and rely on the per-snapshot writeback loop
  //    later to repair scored_picks, then any snapshot that fails to find a
  //    historical match keeps its scored_picks at the OLD (publish==close,
  //    fake-zero) CLV — exactly the contamination we're trying to remove.
  //    Clearing both up-front means the worst case of a partial run is
  //    "honestly null CLV", never "contaminated with old fake-zero CLV".
  //
  //    Idempotent: re-running the purge after an abort is safe (it just
  //    re-NULLs already-NULL fields). The script is then restartable in
  //    --mode=missing-only to fill in unrepaired snapshots one at a time.
  if (args.mode === "purge-and-redo" && !args.dryRun) {
    const purged = await db
      .update(gameSnapshotsTable)
      .set({
        homeCloseMl: null,
        awayCloseMl: null,
        closeSpread: null,
        closeSpreadLine: null,
        closeAwaySpreadLine: null,
        closeTotal: null,
        closeOverLine: null,
        closeUnderLine: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          gte(gameSnapshotsTable.eventStart, start),
          lte(gameSnapshotsTable.eventStart, end),
          ...(args.leagues ? [inArray(gameSnapshotsTable.league, args.leagues)] : []),
        ),
      )
      .returning({ id: gameSnapshotsTable.id, gameKey: gameSnapshotsTable.gameKey });
    logger.info({ purgedRows: purged.length }, "backfillCloseOdds45d: close_* purged in window");

    if (purged.length > 0) {
      const purgedKeys = purged.map((p) => p.gameKey);
      const clvCleared = await db
        .update(scoredPicksTable)
        .set({
          closeOdds: null,
          closeLine: null,
          clvImpliedDelta: null,
          clvLineDelta: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(scoredPicksTable.gameKey, purgedKeys),
            inArray(scoredPicksTable.result, ["win", "loss", "push"]),
          ),
        )
        .returning({ id: scoredPicksTable.id });
      logger.info(
        { picksClvCleared: clvCleared.length },
        "backfillCloseOdds45d: scored_picks CLV fields cleared for purged snapshots",
      );
    }
  } else if (args.mode === "purge-and-redo") {
    logger.info({}, "backfillCloseOdds45d: dry-run — would purge close_* and CLV fields in window");
  }

  // 2. Select snapshots with NULL home_close_ml in the window.
  const candidates = await db
    .select()
    .from(gameSnapshotsTable)
    .where(
      and(
        gte(gameSnapshotsTable.eventStart, start),
        lte(gameSnapshotsTable.eventStart, end),
        sql`${gameSnapshotsTable.homeCloseMl} IS NULL`,
        ...(args.leagues ? [inArray(gameSnapshotsTable.league, args.leagues)] : []),
      ),
    );

  const targets = args.maxGames != null ? candidates.slice(0, args.maxGames) : candidates;

  logger.info(
    { totalCandidates: candidates.length, targets: targets.length },
    "backfillCloseOdds45d: candidates selected",
  );

  if (args.dryRun) {
    logger.info({}, "backfillCloseOdds45d: dry-run — exiting without API calls or writes");
    return;
  }

  // 3. For each snapshot, fetch historical odds at event_start - 2 minutes.
  let captured = 0;
  let missed = 0;
  let apiErrors = 0;
  const repairedSnapshotIds: number[] = [];

  for (const snap of targets) {
    const sportKey = SPORT_KEYS[snap.league];
    if (!sportKey) {
      logger.warn(
        { gameKey: snap.gameKey, league: snap.league },
        "backfillCloseOdds45d: no sportKey for league, skipping",
      );
      continue;
    }

    // T-2min close convention. The historical endpoint returns the snapshot
    // closest to the requested timestamp; T-2min lines up with the live
    // capture cron's window.
    const closeMoment = new Date(new Date(snap.eventStart).getTime() - 2 * 60_000);
    const isoMoment = closeMoment.toISOString();

    try {
      const { data: histGames, headers } = await fetchHistoricalOdds(sportKey, isoMoment);

      let matched: ReturnType<typeof transformGame> | null = null;
      for (const game of histGames) {
        const fresh = transformGame(game, snap.league);
        if (fresh && fresh.gameKey === snap.gameKey) {
          matched = fresh;
          break;
        }
      }

      if (!matched) {
        missed++;
        logger.warn(
          {
            gameKey: snap.gameKey,
            league: snap.league,
            isoMoment,
            histGameCount: histGames.length,
            creditsRemaining: headers.requestsRemaining,
          },
          "backfillCloseOdds45d: no historical match for game",
        );
        continue;
      }

      await db
        .update(gameSnapshotsTable)
        .set({
          homeCloseMl: String(matched.homePublishMl),
          awayCloseMl: String(matched.awayPublishMl),
          closeSpread: matched.publishSpread != null ? String(matched.publishSpread) : undefined,
          closeSpreadLine:
            matched.publishSpreadLine != null ? String(matched.publishSpreadLine) : undefined,
          closeAwaySpreadLine:
            matched.publishAwaySpreadLine != null
              ? String(matched.publishAwaySpreadLine)
              : undefined,
          closeTotal: matched.publishTotal != null ? String(matched.publishTotal) : undefined,
          closeOverLine:
            matched.publishOverLine != null ? String(matched.publishOverLine) : undefined,
          closeUnderLine:
            matched.publishUnderLine != null ? String(matched.publishUnderLine) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(gameSnapshotsTable.id, snap.id));

      repairedSnapshotIds.push(snap.id);
      captured++;

      if (captured % 50 === 0) {
        logger.info(
          { captured, missed, apiErrors, creditsRemaining: headers.requestsRemaining },
          "backfillCloseOdds45d: progress",
        );
      }
    } catch (err) {
      apiErrors++;
      logger.error(
        { gameKey: snap.gameKey, isoMoment, err },
        "backfillCloseOdds45d: historical fetch failed",
      );
    }
  }

  logger.info(
    { captured, missed, apiErrors, repaired: repairedSnapshotIds.length },
    "backfillCloseOdds45d: close_* writes complete",
  );

  // 4. Re-run CLV writeback for every settled scored_pick whose snapshot was
  //    just repaired. We must re-fetch each snapshot to get the freshly
  //    written close_* values, then call the same helper used by the
  //    nightly validation path.
  let picksRepaired = 0;
  let picksSkipped = 0;
  for (const snapId of repairedSnapshotIds) {
    const [snap] = await db
      .select()
      .from(gameSnapshotsTable)
      .where(eq(gameSnapshotsTable.id, snapId))
      .limit(1);
    if (!snap) continue;

    const settled = await db
      .select()
      .from(scoredPicksTable)
      .where(
        and(
          eq(scoredPicksTable.gameKey, snap.gameKey),
          inArray(scoredPicksTable.result, ["win", "loss", "push"]),
        ),
      );

    for (const pick of settled) {
      const clv = computeClvWritebackValues(pick, snap);
      // Skip writebacks where computeClvWritebackValues yields all-null —
      // that signals an unhandled market, not a fix-worthy event. Emitting
      // four NULL UPDATEs would still bump updated_at and create noise.
      if (
        clv.closeOdds == null &&
        clv.closeLine == null &&
        clv.clvImpliedDelta == null &&
        clv.clvLineDelta == null
      ) {
        picksSkipped++;
        continue;
      }
      await db
        .update(scoredPicksTable)
        .set({
          closeOdds: clv.closeOdds,
          closeLine: clv.closeLine,
          clvImpliedDelta: clv.clvImpliedDelta,
          clvLineDelta: clv.clvLineDelta,
          updatedAt: new Date(),
        })
        .where(eq(scoredPicksTable.id, pick.id));
      picksRepaired++;
    }
  }

  logger.info(
    {
      mode: args.mode,
      days: args.days,
      snapshotsCaptured: captured,
      snapshotsMissed: missed,
      apiErrors,
      picksRepaired,
      picksSkipped,
    },
    "backfillCloseOdds45d: complete",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "backfillCloseOdds45d: fatal");
    process.exit(1);
  });
