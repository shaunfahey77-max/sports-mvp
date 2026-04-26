/**
 * Pure Brier-score helpers for the internal calibration-review tool.
 *
 * The Brier score is the mean squared error between a probability forecast
 * and the realized binary outcome (0 or 1). Range [0, 1]; lower is better;
 * naive 50/50 forecasting always scores 0.25.
 *
 * Brier skill score (BSS) compares two forecasters on the same outcomes:
 *   BSS = 1 - brierA / brierB
 * Positive BSS means forecaster A beats forecaster B; zero means tie;
 * negative means A is worse. We use it to compare the model's calibrated
 * probability against the no-vig market probability (`market_prob_fair`)
 * to see whether the model adds value over just trusting the closing line.
 *
 * This module is intentionally side-effect-free, has no DB / env reads,
 * and consumes plain numeric inputs. Callers do all coercion.
 */

export interface BrierInput {
  /** Probability forecast in [0, 1]. Rows outside this range are skipped. */
  prob: number;
  /** Realized binary outcome. Pushes / pending must NOT be passed in. */
  outcome: 0 | 1;
}

/**
 * Compute the Brier score over the given (prob, outcome) pairs.
 * Returns null when the input has no usable rows.
 *
 * Skipping rules (silent, not an error):
 *   - prob is not a finite number
 *   - prob < 0 or prob > 1
 *   - outcome is not exactly 0 or 1
 */
export function computeBrierScore(rows: readonly BrierInput[]): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.prob)) continue;
    if (r.prob < 0 || r.prob > 1) continue;
    if (r.outcome !== 0 && r.outcome !== 1) continue;
    const diff = r.prob - r.outcome;
    sum += diff * diff;
    n++;
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * Brier skill score = 1 - brierModel / brierReference.
 * Returns null when either Brier is null OR when brierReference is 0
 * (perfect reference forecaster — undefined improvement ratio).
 */
export function computeBrierSkillScore(
  brierModel: number | null,
  brierReference: number | null,
): number | null {
  if (brierModel == null || brierReference == null) return null;
  if (brierReference === 0) return null;
  return 1 - brierModel / brierReference;
}
