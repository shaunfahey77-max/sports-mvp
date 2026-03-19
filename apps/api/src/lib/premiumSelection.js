import {
  MARKET_GATING,
  MARKET_RULES,
  THRESHOLDS,
  HISTORICAL_MARKET_ROI,
  RANKING_WEIGHTS,
  TIER_RANK,
} from "../config/premiumStrategy.js";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeProb(p) {
  const n = num(p);
  if (n == null) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function marketAllowed(league, marketType) {
  return !!MARKET_GATING?.[league]?.[marketType];
}

function marketRule(league, marketType) {
  return MARKET_RULES?.[league]?.[marketType] || null;
}

function allowedTiersFor(league, marketType) {
  return marketRule(league, marketType)?.allowedTiers || THRESHOLDS.allowedTiers;
}

function tierAllowed(league, marketType, tier) {
  return allowedTiersFor(league, marketType).includes(String(tier || "PASS").toUpperCase());
}

function oddsWithinRange(league, marketType, odds) {
  const rule = marketRule(league, marketType);
  const o = num(odds);
  if (o == null) return false;

  const minOdds = num(rule?.minOdds);
  const maxOdds = num(rule?.maxOdds);

  if (minOdds != null && o < minOdds) return false;
  if (maxOdds != null && o > maxOdds) return false;
  return true;
}

function passesThresholds(league, candidate) {
  const marketType = String(candidate?.marketType || "").toLowerCase();
  const ev = num(candidate?.evForStake100);
  const kelly = num(candidate?.kellyHalf);
  const edge = num(candidate?.edge);
  const modelProb = normalizeProb(candidate?.modelProb);
  const odds = num(candidate?.odds);
  const tier = String(candidate?.tier || "PASS").toUpperCase();
  const rule = marketRule(league, marketType);

  const minEvForStake100 = num(rule?.minEvForStake100) ?? THRESHOLDS.minEvForStake100;
  const minKellyHalf = num(rule?.minKellyHalf) ?? THRESHOLDS.minKellyHalf;
  const minEdge = num(rule?.minEdge) ?? THRESHOLDS.minEdge;

  if (!marketAllowed(league, marketType)) return false;
  if (!tierAllowed(league, marketType, tier)) return false;
  if (odds == null || odds === 0) return false;
  if (!oddsWithinRange(league, marketType, odds)) return false;
  if (ev == null || ev < minEvForStake100) return false;
  if (kelly == null || kelly < minKellyHalf) return false;
  if (edge == null || edge < minEdge) return false;
  if (modelProb <= 0 || modelProb >= 1) return false;

  return true;
}

function marketRoiScore(league, marketType) {
  return num(HISTORICAL_MARKET_ROI?.[league]?.[marketType]) ?? 0;
}

/**
 * 🔥 KEY CHANGE:
 * - EV dominates
 * - small penalty for juiced lines
 * - ROI no longer dominates selection
 */
function weightedScore(league, candidate) {
  const ev = num(candidate?.evForStake100) ?? -9999;
  const kelly = num(candidate?.kellyHalf) ?? 0;
  const edge = num(candidate?.edge) ?? 0;
  const odds = num(candidate?.odds) ?? 0;
  const modelProb = normalizeProb(candidate?.modelProb);

  const juicePenalty = odds < -180 ? Math.abs(odds + 180) * 0.05 : 0;
  const probPenalty = modelProb > 0.75 ? (modelProb - 0.75) * 100 : 0;

  return (
    edge * 100 * 0.45 +
    ev * 0.35 +
    kelly * 100 * 0.20 -
    juicePenalty -
    probPenalty
  );
}

export function applyPremiumSelection(league, candidates = []) {
  const gated = candidates.filter((c) =>
    marketAllowed(league, String(c?.marketType || "").toLowerCase())
  );

  const filtered = gated.filter((c) => passesThresholds(league, c));

  const ranked = filtered
    .map((c) => ({
      ...c,
      premiumScore: weightedScore(league, c),
      tierRank: TIER_RANK[String(c?.tier || "PASS").toUpperCase()] ?? 0,
    }))
    .sort((a, b) => {
      if ((b.tierRank ?? 0) !== (a.tierRank ?? 0)) {
        return (b.tierRank ?? 0) - (a.tierRank ?? 0);
      }
      return (b.premiumScore ?? -1e9) - (a.premiumScore ?? -1e9);
    });

  return {
    candidates: ranked,
    recommended: ranked[0] || null,
  };
}
