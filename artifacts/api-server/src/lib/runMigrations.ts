import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import path from "path";
import { logger } from "./logger";
import { applyContaminatedNhlLabels } from "./applyContaminatedNhlLabels";

export async function runMigrations(): Promise<void> {
  // process.cwd() = artifacts/api-server when running dev
  // Go up two levels to the workspace root, then into lib/db/migrations
  const migrationsFolder = path.resolve(process.cwd(), "../../lib/db/migrations");
  logger.info({ migrationsFolder }, "Running database migrations");
  await migrate(db, { migrationsFolder });
  logger.info("Database migrations completed successfully");

  // Idempotent data-fix: ensure the NHL contaminated_ingest labels are
  // applied on every deploy. The dev database was labeled out-of-band
  // via a one-off SQL UPDATE; production has a separate database that
  // needs the same labels for the read-side filters to be effective.
  await applyContaminatedNhlLabels();
}
