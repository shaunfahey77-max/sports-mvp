import app from "./app";
import { logger } from "./lib/logger";
import { startCronJobs } from "./services/cronService";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const cronDisabled = ["1", "true", "yes"].includes(
  (process.env["DISABLE_CRON"] ?? "").toLowerCase()
);

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
