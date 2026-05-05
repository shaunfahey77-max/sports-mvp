import { db } from "@workspace/db";
import { evaluationResultsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { CandidateOutput } from "./scorePicks";

type OfficialSurfaceStatus = "official" | "suppressed";

export interface OfficialEvaluationSettlementInput {
  date: string;
  gameKey: string;
  market: string;
  pick: string;
  result: "win" | "loss" | "push" | "pending";
  closeOdds?: string | null;
  closeLine?: string | null;
  clvImpliedDelta?: string | null;
  clvLineDelta?: string | null;
}

function officialSurfaceStatusForCandidate(
  candidate: CandidateOutput,
): OfficialSurfaceStatus {
  return candidate.tier === "PASS" ? "suppressed" : "official";
}

export async function upsertOfficialCandidateEvaluation(
  candidate: CandidateOutput,
): Promise<void> {
  await db
    .insert(evaluationResultsTable)
    .values({
      date: candidate.snapshotDate,
      gameKey: candidate.gameKey,
      league: candidate.league,
      market: candidate.marketType,
      pick: candidate.side,
      publishOdds: String(candidate.publishOdds),
      publishLine:
        candidate.publishLine != null ? String(candidate.publishLine) : undefined,
      modelProbRaw: String(candidate.modelProbRaw),
      modelProbCalibrated: String(candidate.modelProbCalibrated),
      marketProbFair: String(candidate.marketProbFair),
      edge: String(candidate.edge),
      ev: String(candidate.ev),
      rankScore: String(candidate.rankScore),
      tier: candidate.tier,
      marketQuality: String(candidate.marketQuality),
      result: "pending",
      surfaceStatus: officialSurfaceStatusForCandidate(candidate),
      modelVersion: candidate.modelVersion,
      calibrationVersion: candidate.calibrationVersion,
      scoringVersion: "v1",
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
        marketQuality: sql`EXCLUDED.market_quality`,
        surfaceStatus: sql`EXCLUDED.surface_status`,
        modelVersion: sql`EXCLUDED.model_version`,
        calibrationVersion: sql`EXCLUDED.calibration_version`,
        scoringVersion: sql`EXCLUDED.scoring_version`,
        updatedAt: new Date(),
      },
    });
}

export async function settleOfficialEvaluationResult(
  input: OfficialEvaluationSettlementInput,
): Promise<void> {
  await db
    .update(evaluationResultsTable)
    .set({
      result: input.result,
      closeOdds: input.closeOdds ?? undefined,
      closeLine: input.closeLine ?? undefined,
      clvImpliedDelta: input.clvImpliedDelta ?? undefined,
      clvLineDelta: input.clvLineDelta ?? undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(evaluationResultsTable.date, input.date),
        eq(evaluationResultsTable.gameKey, input.gameKey),
        eq(evaluationResultsTable.market, input.market),
        eq(evaluationResultsTable.pick, input.pick),
      ),
    );
}

export async function deletePendingOfficialEvaluationResult(input: {
  date: string;
  gameKey: string;
  market: string;
  pick: string;
}): Promise<void> {
  await db
    .delete(evaluationResultsTable)
    .where(
      and(
        eq(evaluationResultsTable.date, input.date),
        eq(evaluationResultsTable.gameKey, input.gameKey),
        eq(evaluationResultsTable.market, input.market),
        eq(evaluationResultsTable.pick, input.pick),
        eq(evaluationResultsTable.surfaceStatus, "official"),
        eq(evaluationResultsTable.result, "pending"),
      ),
    );
}
