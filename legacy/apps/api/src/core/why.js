// legacy/apps/api/src/lib/why.js
import { round, pct, confidenceProxy, confidenceTier } from "./modelMath.js";

function fmtSigned(x, digits = 3) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${round(n, digits)}`;
}

function pickHeadline(pickSide, edge) {
  const ps = String(pickSide || "").toUpperCase();
  const e = Number(edge);

  if (!ps) return "Model signal";
  if (!Number.isFinite(e)) return `${ps} side signal`;

  if (e >= 0.06) return `${ps} side value`;
  if (e >= 0.02) return `${ps} lean`;
  if (e <= -0.06) return `${ps} is risky (negative edge)`;
  if (e <= -0.02) return `${ps} is thin (negative edge)`;
  return `${ps} marginal value`;
}

/**
 * Build a premium WHY object (headline + bullets) from minimal model fields.
 */
export function buildWhy({ pickSide, winProb, edge, underdogWin, matchup } = {}) {
  const wp = Number(winProb);
  const ed = Number(edge);
  const uw = Number(underdogWin);

  const conf = confidenceProxy({ winProb: wp, edge: ed });
  const tier = confidenceTier(conf);

  const headline = pickHeadline(pickSide, ed);

  const bullets = [];
  if (matchup) bullets.push(`Matchup: ${matchup}`);
  if (pickSide) bullets.push(`Pick: ${String(pickSide).toUpperCase()} (edge ${fmtSigned(ed, 3)})`);
  if (Number.isFinite(wp)) bullets.push(`Model winProb: ${pct(wp, 1) ?? "—"}`);
  if (Number.isFinite(uw)) bullets.push(`Underdog win est: ${pct(uw, 1) ?? "—"}`);
  bullets.push(`Confidence tier: ${tier} (proxy)`);

  return { headline, bullets, deltas: [] };
}

/**
 * Ensure any row has a valid WHY object for the web UI.
 */
export function ensureWhy(row) {
  const direct = row?.why && typeof row.why === "object" ? row.why : null;
  if (direct?.headline) return direct;

  const pickWhy = row?.pick?.why && typeof row.pick.why === "object" ? row.pick.why : null;
  if (pickWhy?.headline) return pickWhy;

  return buildWhy({
    matchup: row?.matchup,
    pickSide: row?.pick?.pickSide,
    winProb: row?.pick?.winProb,
    edge: row?.pick?.edge,
    underdogWin: row?.winProb,
  });
}
