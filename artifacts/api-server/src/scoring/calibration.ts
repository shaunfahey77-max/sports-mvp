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
    moneyline: { method: "sigmoid", version: "v1", sigmoidA: 1.05, sigmoidB: 0.0 },
    spread: { method: "sigmoid", version: "v1", sigmoidA: 1.02, sigmoidB: 0.0 },
    total: { method: "isotonic", version: "v1", isotonicBuckets: defaultIsotonicBuckets() },
  },
  ncaam: {
    moneyline: { method: "sigmoid", version: "v1", sigmoidA: 1.08, sigmoidB: 0.01 },
    spread: { method: "sigmoid", version: "v1", sigmoidA: 1.04, sigmoidB: 0.0 },
    total: { method: "isotonic", version: "v1", isotonicBuckets: defaultIsotonicBuckets() },
  },
  nhl: {
    moneyline: { method: "sigmoid", version: "v1", sigmoidA: 1.03, sigmoidB: 0.0 },
    spread: { method: "isotonic", version: "v1", isotonicBuckets: defaultIsotonicBuckets() },
    total: { method: "isotonic", version: "v1", isotonicBuckets: defaultIsotonicBuckets() },
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
  };
  return (leagueConfidence[league] ?? 0.75) * extremePenalty;
}
