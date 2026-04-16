/**
 * Backfill daily validation_metrics rows from scored_picks.
 * Usage: pnpm --filter @workspace/scripts exec tsx src/backfill-validation-metrics.ts <startDate> <endDate>
 * Dates are YYYY-MM-DD (ET calendar days).
 */

import { backfillValidationMetrics } from "../../artifacts/api-server/src/services/cronService";

async function main() {
  const [startDate, endDate] = process.argv.slice(2);
  if (!startDate || !endDate) {
    console.error("Usage: backfill-validation-metrics <startDate> <endDate>");
    process.exit(2);
  }

  const result = await backfillValidationMetrics(startDate, endDate);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
