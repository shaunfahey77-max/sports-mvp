// legacy/apps/api/src/lib/modelMath.js

export function clamp(x, lo = 0, hi = 1) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function safeNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function round(x, digits = 3) {
  const n = safeNum(x, 0);
  const p = 10 ** Math.max(0, digits | 0);
  return Math.round(n * p) / p;
}

export function pct(x, digits = 1) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return `${(n * 100).toFixed(digits)}%`;
}

/**
 * A lightweight proxy (not a true calibration) that produces a stable tier label
 * for UI while your real calibration evolves.
 */
export function confidenceProxy({ winProb, edge }) {
  const p = clamp(winProb, 0, 1);
  const e = safeNum(edge, 0);

  const dist = Math.abs(p - 0.5);            // 0..0.5
  const mag = Math.min(0.5, Math.abs(e));    // cap

  const raw = 0.55 * (dist / 0.5) + 0.45 * (mag / 0.2);
  return clamp(raw, 0, 1);
}

export function confidenceTier(conf) {
  const c = clamp(conf, 0, 1);
  if (c >= 0.8) return "HIGH";
  if (c >= 0.6) return "MED";
  return "LOW";
}
