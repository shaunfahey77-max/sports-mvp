/**
 * One-shot freeze of a 45-day validation snapshot into a read-only Postgres
 * schema (`validation_45d`). Designed to be run *after* the CLV-integrity
 * fix has been deployed AND scripts/backfillCloseOdds45d.ts has been run
 * AND /admin/clv-health has been verified to show real, non-degenerate CLV.
 *
 * Why a frozen snapshot:
 *   The whole point of the 2026-04-26 plan is to compare model performance
 *   under different selection / threshold / calibration overlays without
 *   the underlying picks rolling forward day-to-day. A live `WHERE date >=
 *   X` query against `public.scored_picks` shifts every night as the cron
 *   adds new picks and settles old ones, contaminating any back-test.
 *   Cloning into a separate schema with SELECT-only grants gives every
 *   simulator run a stable, reproducible reference.
 *
 * What gets frozen:
 *   public.scored_picks    → validation_45d.scored_picks
 *   public.game_snapshots  → validation_45d.game_snapshots
 *   public.candidate_bets  → validation_45d.candidate_bets
 *   plus a metadata row in validation_45d.snapshot_metadata.
 *
 *   Filter: date / event_start within the last `--days` (default 45).
 *
 * Safety:
 *   - REFUSES to run if validation_45d already exists, unless --force is set.
 *     Re-running with --force drops and recreates the schema (data loss in
 *     the snapshot ONLY; public schema is never touched).
 *   - REVOKEs INSERT/UPDATE/DELETE on the new schema from PUBLIC and grants
 *     SELECT only. The owner role still has full privileges (necessary so a
 *     subsequent --force re-run can drop it).
 *   - Adds CHECK constraint validation_45d.scored_picks.result IN
 *     ('win','loss','push','pending') so any later corruption attempt is
 *     visible at INSERT time.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/freezeValidationSnapshot.ts \
 *     --days=45 --label="post-clv-fix-2026-04-26"
 *
 *   pnpm --filter @workspace/api-server exec tsx scripts/freezeValidationSnapshot.ts \
 *     --days=45 --force --label="post-clv-fix-2026-04-26-rerun"
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../src/lib/logger";

interface CliArgs {
  days: number;
  label: string;
  force: boolean;
  schemaName: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    days: 45,
    label: "",
    force: false,
    schemaName: "validation_45d",
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--force") {
      args.force = true;
    } else if (arg.startsWith("--days=")) {
      const n = Number(arg.slice("--days=".length));
      if (!Number.isInteger(n) || n <= 0 || n > 365) {
        throw new Error(`--days must be 1..365 (got ${n})`);
      }
      args.days = n;
    } else if (arg.startsWith("--label=")) {
      args.label = arg.slice("--label=".length);
    } else if (arg.startsWith("--schema=")) {
      const v = arg.slice("--schema=".length);
      // Conservative identifier rule — Postgres allows more, but this guard
      // protects against accidental SQL injection via shell args.
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(v)) {
        throw new Error(`--schema must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/ (got ${v})`);
      }
      args.schemaName = v;
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  if (!args.label) {
    throw new Error("--label is required (e.g. --label=post-clv-fix-2026-04-26)");
  }
  return args;
}

async function schemaExists(name: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = ${name}`,
  );
  // drizzle's pg execute returns a result with `.rows`; normalise across
  // node-postgres + pg-mem for type safety in scripts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (result as any).rows ?? (Array.isArray(result) ? result : []);
  return rows.length > 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  logger.info(
    { schema: args.schemaName, days: args.days, label: args.label, force: args.force },
    "freezeValidationSnapshot: starting",
  );

  const exists = await schemaExists(args.schemaName);
  if (exists && !args.force) {
    logger.error(
      { schema: args.schemaName },
      "freezeValidationSnapshot: schema already exists; pass --force to drop and recreate",
    );
    process.exit(2);
  }

  // Build the cutoff date strings. scored_picks.date and game_snapshots.snapshot_date
  // are both DATE; candidate_bets.snapshot_date is DATE. We compute one
  // YYYY-MM-DD cutoff and pass it everywhere for consistency.
  const cutoffDate = new Date(Date.now() - args.days * 86400_000)
    .toISOString()
    .slice(0, 10);

  // Schema name is hard-validated above; safe to interpolate via sql.raw.
  // CREATE SCHEMA + CREATE TABLE AS SELECT is the fastest reliable path —
  // CTAS preserves column types and copies indexes only as separate DDL,
  // which is fine for a read-only mirror.
  if (exists && args.force) {
    await db.execute(sql.raw(`DROP SCHEMA "${args.schemaName}" CASCADE`));
    logger.info({ schema: args.schemaName }, "freezeValidationSnapshot: dropped existing schema");
  }

  await db.execute(sql.raw(`CREATE SCHEMA "${args.schemaName}"`));

  // Clone scored_picks (filtered to last N days).
  await db.execute(
    sql.raw(`
      CREATE TABLE "${args.schemaName}".scored_picks AS
      SELECT * FROM public.scored_picks WHERE date >= '${cutoffDate}'
    `),
  );
  await db.execute(
    sql.raw(`
      ALTER TABLE "${args.schemaName}".scored_picks
        ADD CONSTRAINT scored_picks_result_chk
        CHECK (result IN ('win','loss','push','pending'))
    `),
  );
  await db.execute(
    sql.raw(`CREATE INDEX scored_picks_date_idx ON "${args.schemaName}".scored_picks(date)`),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX scored_picks_league_market_idx ON "${args.schemaName}".scored_picks(league, market)`,
    ),
  );

  // Clone game_snapshots (filtered to last N days).
  await db.execute(
    sql.raw(`
      CREATE TABLE "${args.schemaName}".game_snapshots AS
      SELECT * FROM public.game_snapshots WHERE snapshot_date >= '${cutoffDate}'
    `),
  );
  await db.execute(
    sql.raw(
      `CREATE INDEX game_snapshots_game_key_idx ON "${args.schemaName}".game_snapshots(game_key)`,
    ),
  );

  // Clone candidate_bets (filtered to last N days).
  await db.execute(
    sql.raw(`
      CREATE TABLE "${args.schemaName}".candidate_bets AS
      SELECT * FROM public.candidate_bets WHERE snapshot_date >= '${cutoffDate}'
    `),
  );

  // Metadata row — single source of truth for what this frozen schema
  // represents. Any simulator run should print this when invoked, so
  // results can be unambiguously traced back to the freeze.
  await db.execute(
    sql.raw(`
      CREATE TABLE "${args.schemaName}".snapshot_metadata (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        cutoff_date DATE NOT NULL,
        days_window INTEGER NOT NULL,
        frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        scored_picks_count INTEGER NOT NULL,
        game_snapshots_count INTEGER NOT NULL,
        candidate_bets_count INTEGER NOT NULL
      )
    `),
  );

  // Counts come straight from the cloned tables, not from public, so the
  // metadata always agrees with the snapshot it describes.
  await db.execute(
    sql.raw(`
      INSERT INTO "${args.schemaName}".snapshot_metadata
        (label, cutoff_date, days_window, scored_picks_count, game_snapshots_count, candidate_bets_count)
      VALUES (
        '${args.label.replace(/'/g, "''")}',
        '${cutoffDate}',
        ${args.days},
        (SELECT COUNT(*) FROM "${args.schemaName}".scored_picks),
        (SELECT COUNT(*) FROM "${args.schemaName}".game_snapshots),
        (SELECT COUNT(*) FROM "${args.schemaName}".candidate_bets)
      )
    `),
  );

  // Lock down: revoke writes from PUBLIC, grant SELECT only. The owner
  // role retains full privileges so this script can drop the schema on a
  // subsequent --force re-run.
  await db.execute(
    sql.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA "${args.schemaName}" FROM PUBLIC`),
  );
  await db.execute(
    sql.raw(`GRANT USAGE ON SCHEMA "${args.schemaName}" TO PUBLIC`),
  );
  await db.execute(
    sql.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA "${args.schemaName}" TO PUBLIC`),
  );

  // Read back the metadata row so the operator sees what got frozen.
  const meta = await db.execute(
    sql.raw(`SELECT * FROM "${args.schemaName}".snapshot_metadata ORDER BY id DESC LIMIT 1`),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaRow = (meta as any).rows?.[0] ?? (Array.isArray(meta) ? meta[0] : null);

  logger.info(
    { schema: args.schemaName, metadata: metaRow },
    "freezeValidationSnapshot: complete (read-only schema created)",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "freezeValidationSnapshot: fatal");
    process.exit(1);
  });
