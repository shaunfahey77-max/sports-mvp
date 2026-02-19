// legacy/apps/api/src/routes/adminPerformance.js
import express from "express";

const router = express.Router();

router.get("/admin/performance/ping", (_req, res) => {
  res.json({ ok: true, route: "adminPerformance", version: "v3-no-run-cron" });
});

export default router;
