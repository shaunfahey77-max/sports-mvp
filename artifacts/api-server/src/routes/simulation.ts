import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { simulationRunsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { StartSimulationBody } from "@workspace/api-zod";
import { runSimulation } from "../simulation/simulate45Days";

const router: IRouter = Router();

router.post("/simulate", async (req, res): Promise<void> => {
  const parsed = StartSimulationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    startDate,
    days = 45,
    leagues = ["nba", "nhl", "ncaam"],
    markets = ["moneyline", "spread", "total"],
    modelVersion = "v1",
    scoringVersion = "v1",
    calibrationVersion = "v1",
  } = parsed.data;

  const runId = await runSimulation({
    startDate,
    days,
    leagues: leagues as import("../config/scoringModelConfig").League[],
    markets: markets as import("../config/scoringModelConfig").MarketType[],
    modelVersion,
    scoringVersion,
    calibrationVersion,
  });

  const [run] = await db
    .select()
    .from(simulationRunsTable)
    .where(eq(simulationRunsTable.runId, runId));

  res.status(201).json(run);
});

router.get("/simulate/list", async (_req, res): Promise<void> => {
  const runs = await db
    .select()
    .from(simulationRunsTable)
    .orderBy(desc(simulationRunsTable.createdAt))
    .limit(50);
  res.json(runs);
});

router.get("/simulate/:runId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

  const [run] = await db
    .select()
    .from(simulationRunsTable)
    .where(eq(simulationRunsTable.runId, rawId));

  if (!run) {
    res.status(404).json({ error: "Simulation run not found" });
    return;
  }

  res.json(run);
});

export default router;
