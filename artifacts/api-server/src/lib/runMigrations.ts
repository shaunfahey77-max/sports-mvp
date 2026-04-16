import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@workspace/db";
import path from "path";
import { logger } from "./logger";

export async function runMigrations(): Promise<void> {
  // process.cwd() = artifacts/api-server when running dev
  // Go up two levels to the workspace root, then into lib/db/migrations
  const migrationsFolder = path.resolve(process.cwd(), "../../lib/db/migrations");
  logger.info({ migrationsFolder }, "Running database migrations");
  await migrate(db, { migrationsFolder });
  logger.info("Database migrations completed successfully");
}
