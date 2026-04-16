import app from "./app";
import { logger } from "./lib/logger";
import { startCronJobs } from "./services/cronService";
import { runMigrations } from "./lib/runMigrations";
import { getStripeSync } from "./stripeClient";
import { runMigrations as runStripeMigrations, type Logger as StripeSyncLogger } from "stripe-replit-sync";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const cronDisabled = ["1", "true", "yes"].includes(
  (process.env["DISABLE_CRON"] ?? "").toLowerCase()
);

async function initStripe() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe init");
    return;
  }

  try {
    // 1. Create stripe schema and tables (idempotent)
    const stripeSyncLogger: StripeSyncLogger = {
      info(msg: string) { logger.info({ pkg: "stripe-replit-sync" }, msg); },
      error(err: unknown, msg?: string) { logger.error({ pkg: "stripe-replit-sync", err }, msg ?? "stripe-replit-sync error"); },
      warn(msg: string) { logger.warn({ pkg: "stripe-replit-sync" }, msg); },
    };
    await runStripeMigrations({ databaseUrl, logger: stripeSyncLogger });

    // 2. Instantiate StripeSync (needed for webhook setup and backfill)
    const stripeSync = await getStripeSync();

    // 3. Register managed webhook with Stripe
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
    if (domain) {
      const webhookUrl = `https://${domain}/sports-mvp/api/stripe/webhook`;
      await stripeSync.findOrCreateManagedWebhook(webhookUrl);
      logger.info({ webhookUrl }, "Stripe managed webhook configured");
    } else {
      logger.warn("REPLIT_DOMAINS not set — skipping managed webhook registration");
    }

    // 4. Backfill all existing Stripe data to local stripe schema
    await stripeSync.syncBackfill();
    logger.info("Stripe syncBackfill complete");
  } catch (err) {
    logger.error({ err }, "Stripe initialization failed — continuing without Stripe sync");
  }
}

async function main() {
  await runMigrations();
  await initStripe();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening");
      process.exit(1);
    }

    logger.info({ port, cronDisabled }, "Server listening");

    if (!cronDisabled) {
      startCronJobs();
    } else {
      logger.info("Cron startup disabled by DISABLE_CRON");
    }
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
