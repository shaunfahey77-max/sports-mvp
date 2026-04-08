import { Router } from "express";
import { runNightlyValidation } from "../services/cronService";
import { logger } from "../lib/logger";

const router = Router();

router.post("/admin/run-validation", async (_req, res) => {
  try {
    logger.info("Manual validation triggered via API");
    await runNightlyValidation();
    res.json({ ok: true, message: "Validation complete" });
  } catch (err) {
    logger.error({ err }, "Manual validation failed");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
