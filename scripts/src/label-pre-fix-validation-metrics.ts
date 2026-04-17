/**
 * Backfill `validation_metrics.data_quality` for pre-fix contaminated rows.
 *
 * For each league listed in PUBLIC_TRACK_RECORD_CUTOFFS, sets data_quality =
 * "pre_fix_contaminated" on every row whose run_date is STRICTLY BEFORE the
 * cutoff. Rows on or after the cutoff (and rows already labeled) are left
 * untouched. This script never deletes or rewrites the underlying numeric
 * metrics — it only stamps the audit label so the public read surface can
 * exclude these rows deterministically.
 *
 * Idempotent: re-running has no effect on already-labeled rows.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts label-pre-fix
 *   pnpm --filter @workspace/scripts label-pre-fix -- --dry-run
 */

import { db, validationMetricsTable } from "@workspace/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import {
  PUBLIC_TRACK_RECORD_CUTOFFS,
  DATA_QUALITY_PRE_FIX,
} from "../../artifacts/api-server/src/config/scoringModelConfig";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  let totalLabeled = 0;
  for (const [league, cutoff] of Object.entries(PUBLIC_TRACK_RECORD_CUTOFFS)) {
    if (!cutoff) continue;

    const candidates = await db
      .select({
        id: validationMetricsTable.id,
        runDate: validationMetricsTable.runDate,
        market: validationMetricsTable.market,
        windowDays: validationMetricsTable.windowDays,
      })
      .from(validationMetricsTable)
      .where(
        and(
          eq(validationMetricsTable.league, league),
          lt(validationMetricsTable.runDate, cutoff),
          isNull(validationMetricsTable.dataQuality),
        ),
      );

    console.log(
      `[${league}] cutoff=${cutoff}  rows_to_label=${candidates.length}` +
        (dryRun ? "  (dry-run)" : ""),
    );
    for (const c of candidates) {
      console.log(
        `  - id=${c.id}  run_date=${c.runDate}  market=${c.market ?? "(league)"}  window=${c.windowDays}`,
      );
    }

    if (!dryRun && candidates.length > 0) {
      const result = await db
        .update(validationMetricsTable)
        .set({ dataQuality: DATA_QUALITY_PRE_FIX })
        .where(
          and(
            eq(validationMetricsTable.league, league),
            lt(validationMetricsTable.runDate, cutoff),
            isNull(validationMetricsTable.dataQuality),
          ),
        )
        .returning({ id: validationMetricsTable.id });
      console.log(`[${league}] labeled ${result.length} row(s) as ${DATA_QUALITY_PRE_FIX}`);
      totalLabeled += result.length;
    }
  }
  console.log(`\nTotal rows labeled: ${totalLabeled}${dryRun ? "  (dry-run)" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("label-pre-fix failed:", err);
    process.exit(1);
  });
