import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { scoredPicksTable, validationMetricsTable } from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { computeValidationMetrics, type PickWithFullData } from "../scoring/validatePicks";
import { americanToDecimal } from "../scoring/marketProb";

const router: IRouter = Router();

router.get("/performance", async (req, res): Promise<void> => {
  const { league, market } = req.query as Record<string, string | undefined>;
  const window = parseInt((req.query.window as string) ?? "30");

  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - window);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  const conditions = [gte(scoredPicksTable.date, cutoff)];
  if (league) conditions.push(eq(scoredPicksTable.league, league));
  if (market) conditions.push(eq(scoredPicksTable.market, market));

  const picks = await db
    .select()
    .from(scoredPicksTable)
    .where(and(...conditions));

  const picksForValidation: PickWithFullData[] = picks.map((p) => ({
    id: p.id,
    league: p.league,
    market: p.market,
    pick: p.pick,
    publishOdds: parseFloat(p.publishOdds),
    closeOdds: p.closeOdds ? parseFloat(p.closeOdds) : null,
    closeLine: p.closeLine ? parseFloat(p.closeLine) : null,
    publishLine: p.publishLine ? parseFloat(p.publishLine) : null,
    modelProbCalibrated: parseFloat(p.modelProbCalibrated),
    result: p.result as "win" | "loss" | "push" | "pending",
    ev: parseFloat(p.ev),
    edge: parseFloat(p.edge),
    clvImpliedDelta: p.clvImpliedDelta ? parseFloat(p.clvImpliedDelta) : null,
    tier: p.tier,
  }));

  const metrics = computeValidationMetrics(picksForValidation, window);

  res.json({
    windowDays: window,
    league: league ?? null,
    market: market ?? null,
    ...metrics,
  });
});

router.get("/performance/history", async (req, res): Promise<void> => {
  const { league, market } = req.query as Record<string, string | undefined>;
  const days = parseInt((req.query.days as string) ?? "45");

  const conditions = [];
  if (league) conditions.push(eq(validationMetricsTable.league, league));
  if (market) conditions.push(eq(validationMetricsTable.market, market));

  const records =
    conditions.length > 0
      ? await db
          .select()
          .from(validationMetricsTable)
          .where(and(...conditions))
          .orderBy(desc(validationMetricsTable.runDate))
          .limit(days)
      : await db
          .select()
          .from(validationMetricsTable)
          .orderBy(desc(validationMetricsTable.runDate))
          .limit(days);

  res.json(records);
});

export default router;
