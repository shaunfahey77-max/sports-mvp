/**
 * Calibration layer.
 * Applies sigmoid or isotonic calibration to raw model probabilities.
 */

export type CalibrationMethod = "sigmoid" | "isotonic" | "none";

export interface CalibrationParams {
  method: CalibrationMethod;
  version: string;
  sigmoidA?: number;
  sigmoidB?: number;
  isotonicBuckets?: Array<{ low: number; high: number; calibrated: number }>;
}

/**
 * Default sigmoid calibration parameters per league/market.
 * In production these would be fitted on out-of-sample historical data.
 */
export const DEFAULT_CALIBRATION_PARAMS: Record<string, Record<string, CalibrationParams>> = {
  nba: {
    moneyline: { method: "sigmoid", version: "v2", sigmoidA: 1.05, sigmoidB: 0.0 },
    // NBA spread (Phase 0.75C): tightened sigmoidA from 1.02 → 0.85 to shrink
    // model probabilities toward 0.5. POST evidence: meanModel 0.574 in the
    // [0.55,0.60) bucket realized 44.4% — overconfident by ~13pts. Sigmoid
    // with a<1 compresses without changing the rank ordering of picks.
    spread: { method: "sigmoid", version: "v3", sigmoidA: 0.85, sigmoidB: 0.0 },
    // NBA totals: compressed toward 50% — model noise alone should not generate strong edges.
    total: { method: "isotonic", version: "v2", isotonicBuckets: nbaTotalIsotonicBuckets() },
  },
  ncaam: {
    moneyline: { method: "sigmoid", version: "v2", sigmoidA: 1.08, sigmoidB: 0.01 },
    spread: { method: "sigmoid", version: "v2", sigmoidA: 1.04, sigmoidB: 0.0 },
    total: { method: "isotonic", version: "v2", isotonicBuckets: defaultIsotonicBuckets() },
  },
  nhl: {
    moneyline: { method: "sigmoid", version: "v2", sigmoidA: 1.03, sigmoidB: 0.0 },
    // NHL spread (puck line -1.5): aggressively compressed. ~45% of NHL games end within 1 goal;
    // a team's win probability does NOT translate cleanly to cover probability at -1.5.
    spread: { method: "isotonic", version: "v2", isotonicBuckets: nhlSpreadIsotonicBuckets() },
    total: { method: "none", version: "v3" },
  },
  // MLB Phase 0.75D foundation: identity sigmoid (a=1, b=0) on moneyline
  // since the model itself is market-anchored — no compression needed
  // until we have realized-result evidence to fit against. Run line and
  // totals are stubbed disabled in MARKET_DISABLED; no params needed.
  mlb: {
    moneyline: { method: "sigmoid", version: "v1", sigmoidA: 1.0, sigmoidB: 0.0 },
  },
};

function defaultIsotonicBuckets(): Array<{ low: number; high: number; calibrated: number }> {
  return [
    { low: 0.00, high: 0.10, calibrated: 0.05 },
    { low: 0.10, high: 0.20, calibrated: 0.15 },
    { low: 0.20, high: 0.30, calibrated: 0.25 },
    { low: 0.30, high: 0.40, calibrated: 0.35 },
    { low: 0.40, high: 0.50, calibrated: 0.47 },
    { low: 0.50, high: 0.60, calibrated: 0.53 },
    { low: 0.60, high: 0.70, calibrated: 0.63 },
    { low: 0.70, high: 0.80, calibrated: 0.73 },
    { low: 0.80, high: 0.90, calibrated: 0.83 },
    { low: 0.90, high: 1.00, calibrated: 0.93 },
  ];
}

/**
 * NHL spread (puck line -1.5) isotonic buckets.
 * Aggressively compressed toward 0.50: a high raw win probability does NOT imply
 * a high cover probability at -1.5 in a sport where ~45% of games end within 1 goal.
 * A team modeled at 70% to win might only be ~58% to win by 2+.
 */
function nhlSpreadIsotonicBuckets(): Array<{ low: number; high: number; calibrated: number }> {
  // Phase 0.75C: upper buckets pulled further toward 0.5. POST evidence
  // (across all NHL surfaced picks, dominated by spread once total is
  // gated): model 0.687 → realized 25.0% in [0.65,0.70); model 0.729 →
  // realized 33.3% in [0.70,1.00). Existing 0.56 / 0.61 calibrated values
  // were not shrinking enough. Lower buckets unchanged — they were honest.
  return [
    { low: 0.00, high: 0.10, calibrated: 0.05 },
    { low: 0.10, high: 0.20, calibrated: 0.12 },
    { low: 0.20, high: 0.30, calibrated: 0.22 },
    { low: 0.30, high: 0.40, calibrated: 0.33 },
    { low: 0.40, high: 0.50, calibrated: 0.46 },
    { low: 0.50, high: 0.60, calibrated: 0.52 },
    { low: 0.60, high: 0.70, calibrated: 0.54 },
    { low: 0.70, high: 0.80, calibrated: 0.57 },
    { low: 0.80, high: 0.90, calibrated: 0.62 },
    { low: 0.90, high: 1.00, calibrated: 0.66 },
  ];
}

/**
 * NBA totals isotonic buckets.
 * Compressed in the 0.50–0.70 range: the model's total estimate is derived from
 * the posted line ± small noise, so probabilities above ~0.57 reflect noise, not signal.
 */
function nbaTotalIsotonicBuckets(): Array<{ low: number; high: number; calibrated: number }> {
  return [
    { low: 0.00, high: 0.10, calibrated: 0.05 },
    { low: 0.10, high: 0.20, calibrated: 0.15 },
    { low: 0.20, high: 0.30, calibrated: 0.25 },
    { low: 0.30, high: 0.40, calibrated: 0.35 },
    { low: 0.40, high: 0.50, calibrated: 0.47 },
    { low: 0.50, high: 0.60, calibrated: 0.52 },
    { low: 0.60, high: 0.70, calibrated: 0.57 },
    { low: 0.70, high: 0.80, calibrated: 0.64 },
    { low: 0.80, high: 0.90, calibrated: 0.73 },
    { low: 0.90, high: 1.00, calibrated: 0.83 },
  ];
}

function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function applySigmoid(prob: number, a: number, b: number): number {
  return sigmoid(a * logit(prob) + b);
}

function applyIsotonic(
  prob: number,
  buckets: Array<{ low: number; high: number; calibrated: number }>
): number {
  for (const bucket of buckets) {
    if (prob >= bucket.low && prob < bucket.high) {
      return bucket.calibrated;
    }
  }
  return prob;
}

export function calibrateProb(
  rawProb: number,
  params: CalibrationParams
): number {
  if (params.method === "sigmoid") {
    const a = params.sigmoidA ?? 1.0;
    const b = params.sigmoidB ?? 0.0;
    return applySigmoid(rawProb, a, b);
  }
  if (params.method === "isotonic" && params.isotonicBuckets) {
    return applyIsotonic(rawProb, params.isotonicBuckets);
  }
  return rawProb;
}

export function getCalibrationParams(league: string, marketType: string): CalibrationParams {
  return (
    DEFAULT_CALIBRATION_PARAMS[league]?.[marketType] ?? {
      method: "none",
      version: "v1",
    }
  );
}

/**
 * Returns a calibration confidence score (0–1) representing
 * how reliable the calibration is for this model/market combination.
 */
export function getCalibrationConfidence(
  league: string,
  marketType: string,
  rawProb: number
): number {
  const mid = Math.abs(rawProb - 0.5);
  const extremePenalty = mid > 0.3 ? 0.85 : 1.0;
  const leagueConfidence: Record<string, number> = {
    nba: 0.92,
    ncaam: 0.80,
    nhl: 0.87,
    // MLB Phase 0.75D foundation: confidence held below NBA/NHL until we
    // have a realized-result sample to validate calibration against.
    mlb: 0.85,
  };
  return (leagueConfidence[league] ?? 0.75) * extremePenalty;
}
