import type { CandidateBet } from "@workspace/api-client-react";

export type CandidateSurfaceStatus =
  | "shadow"
  | "model_watch"
  | "official"
  | "suppressed";

export function resolveCandidateSurfaceStatus(
  bet: Pick<CandidateBet, "surfaceStatus" | "selectionReason">,
): CandidateSurfaceStatus {
  if (
    bet.surfaceStatus === "shadow" ||
    bet.surfaceStatus === "model_watch" ||
    bet.surfaceStatus === "official" ||
    bet.surfaceStatus === "suppressed"
  ) {
    return bet.surfaceStatus;
  }

  if (bet.selectionReason === "model_watch_only") return "model_watch";
  if (bet.selectionReason === "market_disabled") return "suppressed";
  return "shadow";
}

export function partitionCandidatesBySurfaceStatus(
  candidates: readonly CandidateBet[],
): {
  liveCandidates: CandidateBet[];
  passCandidates: CandidateBet[];
} {
  const liveCandidates = candidates.filter((c) => {
    const surfaceStatus = resolveCandidateSurfaceStatus(c);
    return c.tier !== "PASS" && surfaceStatus !== "suppressed";
  });

  const passCandidates = candidates.filter((c) => {
    const surfaceStatus = resolveCandidateSurfaceStatus(c);
    return c.tier === "PASS" && surfaceStatus === "model_watch";
  });

  return {
    liveCandidates,
    passCandidates,
  };
}
