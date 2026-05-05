import { db } from "@workspace/db";
import { evaluationResultsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface EvaluationResultUpsertInput {
  date: string;
  gameKey: string;
  league: string;
  market: string;
  pick: string;
  publishOdds: string;
  publishLine?: string | null;
  modelProbRaw: string;
  modelProbCalibrated: string;
  marketProbFair: string;
  edge: string;
  ev: string;
  rankScore: string;
  tier: string;
  marketQuality: string;
  calibrationConfidence?: string;
  result: "win" | "loss" | "push" | "pending";
  closeOdds?: string | null;
  closeLine?: string | null;
  clvImpliedDelta?: string | null;
  clvLineDelta?: string | null;
  surfaceStatus: "official" | "model_watch" | "suppressed";
  modelVersion: string;
  calibrationVersion: string;
  scoringVersion: string;
}

/**
 * Transition helper for the rebuild's unified evaluation surface.
 *
 * Legacy tables remain in place while user-facing reads migrate, but all new
 * grading work should begin dual-writing here so evaluation truth stops being
 * split across multiple persistence paths.
 */
export async function upsertEvaluationResult(
  row: EvaluationResultUpsertInput,
): Promise<void> {
  await db
    .insert(evaluationResultsTable)
    .values({
      date: row.date,
      gameKey: row.gameKey,
      league: row.league,
      market: row.market,
      pick: row.pick,
      publishOdds: row.publishOdds,
      publishLine: row.publishLine ?? undefined,
      modelProbRaw: row.modelProbRaw,
      modelProbCalibrated: row.modelProbCalibrated,
      marketProbFair: row.marketProbFair,
      edge: row.edge,
      ev: row.ev,
      rankScore: row.rankScore,
      tier: row.tier,
      marketQuality: row.marketQuality,
      calibrationConfidence: row.calibrationConfidence ?? "1",
      result: row.result,
      closeOdds: row.closeOdds ?? undefined,
      closeLine: row.closeLine ?? undefined,
      clvImpliedDelta: row.clvImpliedDelta ?? undefined,
      clvLineDelta: row.clvLineDelta ?? undefined,
      surfaceStatus: row.surfaceStatus,
      modelVersion: row.modelVersion,
      calibrationVersion: row.calibrationVersion,
      scoringVersion: row.scoringVersion,
    })
    .onConflictDoUpdate({
      target: [
        evaluationResultsTable.date,
        evaluationResultsTable.gameKey,
        evaluationResultsTable.market,
        evaluationResultsTable.pick,
      ],
      set: {
        publishOdds: sql`EXCLUDED.publish_odds`,
        publishLine: sql`EXCLUDED.publish_line`,
        modelProbRaw: sql`EXCLUDED.model_prob_raw`,
        modelProbCalibrated: sql`EXCLUDED.model_prob_calibrated`,
        marketProbFair: sql`EXCLUDED.market_prob_fair`,
        edge: sql`EXCLUDED.edge`,
        ev: sql`EXCLUDED.ev`,
        rankScore: sql`EXCLUDED.rank_score`,
        tier: sql`EXCLUDED.tier`,
        marketQuality: sql`EXCLUDED.market_quality`,
        calibrationConfidence: sql`EXCLUDED.calibration_confidence`,
        result: sql`EXCLUDED.result`,
        closeOdds: sql`EXCLUDED.close_odds`,
        closeLine: sql`EXCLUDED.close_line`,
        clvImpliedDelta: sql`EXCLUDED.clv_implied_delta`,
        clvLineDelta: sql`EXCLUDED.clv_line_delta`,
        surfaceStatus: sql`EXCLUDED.surface_status`,
        modelVersion: sql`EXCLUDED.model_version`,
        calibrationVersion: sql`EXCLUDED.calibration_version`,
        scoringVersion: sql`EXCLUDED.scoring_version`,
        updatedAt: new Date(),
      },
    });
}
