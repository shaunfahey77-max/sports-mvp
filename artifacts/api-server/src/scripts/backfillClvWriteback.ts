/**
 * One-off backfill: recompute close_odds / close_line / clv_implied_delta /
 * clv_line_delta for every settled scored_picks row whose snapshot has the
 * source close-line data, but where the writeback never ran (because the
 * pre-Plan-1 cron paths hard-gated on `pick.market === "moneyline"`).
 *
 * Usage:
 *   tsx src/scripts/backfillClvWriteback.ts                  # dry-run (default)
 *   tsx src/scripts/backfillClvWriteback.ts --apply          # actually update rows
 *   tsx src/scripts/backfillClvWriteback.ts --apply --since=2026-04-01
 *
 * Read-only by default. The dry-run prints a per-market summary of what would
 * be updated and prints the first ~10 sample diffs per market for review.
 *
 * The backfill is idempotent and conservative: it only touches a column when
 * (a) the row currently has it null AND (b) the snapshot has the source data
 * to populate it. Already-populated columns are left untouched.
 *
 * Coverage limit: rows whose snapshot has no close-line data ingested
 * (game_snapshots.close_* still null) cannot be recovered — that's a
 * separate ingestion-coverage gap, not a writeback gap.
 */

import { db } from "@workspace/db";
import { scoredPicksTable, gameSnapshotsTable } from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { computeClvWritebackValues } from "../scoring/clvWriteback";

interface Args {
  apply: boolean;
  since: string | null;
}

function parseArgs(): Args {
  const args: Args = { apply: false, since: null };
  for (const a of process.argv.slice(2)) {
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--since=")) args.since = a.slice("--since=".length);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: tsx src/scripts/backfillClvWriteback.ts [--apply] [--since=YYYY-MM-DD]");
      process.exit(0);
    }
  }
  return args;
}

interface MarketSummary {
  picks: number;
  withSnapshot: number;
  wouldWriteCloseOdds: number;
  wouldWriteCloseLine: number;
  wouldWriteClvImplied: number;
  wouldWriteClvLine: number;
  noSourceData: number;
  samples: Array<{
    id: number;
    pick: string;
    publishOdds: string;
    publishLine: string | null;
    before: { closeOdds: string | null; closeLine: string | null; clvImpliedDelta: string | null; clvLineDelta: string | null };
    after: ReturnType<typeof computeClvWritebackValues>;
  }>;
}

function newMarketSummary(): MarketSummary {
  return {
    picks: 0,
    withSnapshot: 0,
    wouldWriteCloseOdds: 0,
    wouldWriteCloseLine: 0,
    wouldWriteClvImplied: 0,
    wouldWriteClvLine: 0,
    noSourceData: 0,
    samples: [],
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const mode = args.apply ? "APPLY" : "DRY-RUN";
  console.log(`\n=== CLV writeback backfill — ${mode} ===`);
  if (args.since) console.log(`Filtering to picks with date >= ${args.since}`);
  console.log("");

  // Fetch all settled (non-pending) scored_picks rows that are missing at least
  // one of the four CLV columns. We do not filter on market here so the script
  // can also re-fill ML rows that were missed during outages.
  const baseConditions = [sql`${scoredPicksTable.result} <> 'pending'`];
  if (args.since) {
    baseConditions.push(sql`${scoredPicksTable.date} >= ${args.since}`);
  }
  baseConditions.push(
    sql`(${scoredPicksTable.closeOdds} IS NULL
       OR ${scoredPicksTable.closeLine} IS NULL
       OR ${scoredPicksTable.clvImpliedDelta} IS NULL
       OR ${scoredPicksTable.clvLineDelta} IS NULL)`,
  );

  const picks = await db
    .select()
    .from(scoredPicksTable)
    .where(and(...baseConditions));

  console.log(`Candidate scored_picks rows (settled, missing >=1 CLV field): ${picks.length}`);

  if (picks.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Batch-fetch matching snapshots by gameKey (chunked to avoid IN() bloat).
  const gameKeys = Array.from(new Set(picks.map((p) => p.gameKey)));
  const snapByKey = new Map<string, typeof gameSnapshotsTable.$inferSelect>();
  const CHUNK = 500;
  for (let i = 0; i < gameKeys.length; i += CHUNK) {
    const slice = gameKeys.slice(i, i + CHUNK);
    const rows = await db
      .select()
      .from(gameSnapshotsTable)
      .where(inArray(gameSnapshotsTable.gameKey, slice));
    for (const r of rows) snapByKey.set(r.gameKey, r);
  }

  const summaries: Record<string, MarketSummary> = {
    moneyline: newMarketSummary(),
    spread: newMarketSummary(),
    total: newMarketSummary(),
  };

  let totalUpdates = 0;

  for (const pick of picks) {
    const summary = summaries[pick.market] ?? (summaries[pick.market] = newMarketSummary());
    summary.picks++;

    const snap = snapByKey.get(pick.gameKey);
    if (!snap) continue;
    summary.withSnapshot++;

    const clv = computeClvWritebackValues(
      {
        market: pick.market,
        pick: pick.pick,
        publishOdds: pick.publishOdds,
        publishLine: pick.publishLine,
      },
      snap,
    );

    // Only count + apply a column if (a) currently null AND (b) we computed a value.
    const update: Record<string, string> = {};
    if (pick.closeOdds == null && clv.closeOdds != null) {
      update.closeOdds = clv.closeOdds;
      summary.wouldWriteCloseOdds++;
    }
    if (pick.closeLine == null && clv.closeLine != null) {
      update.closeLine = clv.closeLine;
      summary.wouldWriteCloseLine++;
    }
    if (pick.clvImpliedDelta == null && clv.clvImpliedDelta != null) {
      update.clvImpliedDelta = clv.clvImpliedDelta;
      summary.wouldWriteClvImplied++;
    }
    if (pick.clvLineDelta == null && clv.clvLineDelta != null) {
      update.clvLineDelta = clv.clvLineDelta;
      summary.wouldWriteClvLine++;
    }

    if (Object.keys(update).length === 0) {
      summary.noSourceData++;
      continue;
    }

    if (summary.samples.length < 10) {
      summary.samples.push({
        id: pick.id,
        pick: pick.pick,
        publishOdds: pick.publishOdds,
        publishLine: pick.publishLine,
        before: {
          closeOdds: pick.closeOdds,
          closeLine: pick.closeLine,
          clvImpliedDelta: pick.clvImpliedDelta,
          clvLineDelta: pick.clvLineDelta,
        },
        after: clv,
      });
    }

    if (args.apply) {
      await db
        .update(scoredPicksTable)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(scoredPicksTable.id, pick.id));
      totalUpdates++;
    }
  }

  // Print per-market summary.
  console.log("\nPer-market summary:");
  console.log(
    "market    | picks | w/snap | +closeOdds | +closeLine | +clvImpl | +clvLine | nothingToDo",
  );
  console.log(
    "----------|-------|--------|------------|------------|----------|----------|------------",
  );
  for (const market of ["moneyline", "spread", "total"]) {
    const s = summaries[market]!;
    console.log(
      `${market.padEnd(9)} | ${String(s.picks).padStart(5)} | ${String(s.withSnapshot).padStart(6)} | ${String(s.wouldWriteCloseOdds).padStart(10)} | ${String(s.wouldWriteCloseLine).padStart(10)} | ${String(s.wouldWriteClvImplied).padStart(8)} | ${String(s.wouldWriteClvLine).padStart(8)} | ${String(s.noSourceData).padStart(11)}`,
    );
  }

  // Sample diffs.
  for (const market of ["moneyline", "spread", "total"]) {
    const s = summaries[market]!;
    if (s.samples.length === 0) continue;
    console.log(`\nSample diffs (${market}, first ${s.samples.length}):`);
    for (const sample of s.samples) {
      console.log(
        `  id=${sample.id} pick=${sample.pick} pubOdds=${sample.publishOdds} pubLine=${sample.publishLine ?? "-"}`,
      );
      console.log(
        `    before: closeOdds=${sample.before.closeOdds ?? "null"} closeLine=${sample.before.closeLine ?? "null"} clvImpl=${sample.before.clvImpliedDelta ?? "null"} clvLine=${sample.before.clvLineDelta ?? "null"}`,
      );
      console.log(
        `    after : closeOdds=${sample.after.closeOdds ?? "-"} closeLine=${sample.after.closeLine ?? "-"} clvImpl=${sample.after.clvImpliedDelta ?? "-"} clvLine=${sample.after.clvLineDelta ?? "-"}`,
      );
    }
  }

  console.log(
    `\n${args.apply ? "APPLIED" : "DRY-RUN ONLY — would have applied"} updates to ${args.apply ? totalUpdates : Object.values(summaries).reduce((acc, s) => acc + s.picks - s.noSourceData - (s.picks - s.withSnapshot), 0)} rows.`,
  );
  if (!args.apply) console.log("Re-run with --apply to actually update rows.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
