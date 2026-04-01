import {
    MARKET_GATING,
    MARKET_RULES,
    THRESHOLDS,
    RANKING_WEIGHTS,
    CALIBRATION_FACTOR,
    MAX_PICKS,
    MIN_SCORE,
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

  // Compress model probability toward 0.5 to reduce overconfidence.
  // Factor comes from config (CALIBRATION_FACTOR = 0.4).
  function compressProb(p, factor = CALIBRATION_FACTOR) {
    const n = normalizeProb(p);
    return normalizeProb(0.5 + (n - 0.5) * factor);
  }

  function impliedProbFromAmericanOdds(odds) {
    const o = num(odds);
    if (o == null || o === 0) return null;
    if (o > 0) return 100 / (o + 100);
    return Math.abs(o) / (Math.abs(o) + 100);
  }

  function evFor100(prob, odds) {
    const p = normalizeProb(prob);
    const o = num(odds);
    if (o == null || o === 0) return null;
    const winProfit = o > 0 ? o : 10000 / Math.abs(o);
    return p * winProfit - (1 - p) * 100;
  }

  function kellyHalfFromProb(prob, odds) {
    const p = normalizeProb(prob);
    const o = num(odds);
    if (o == null || o === 0) return null;
    const b = o > 0 ? o / 100 : 100 / Math.abs(o);
    const q = 1 - p;
    const fullKelly = (b * p - q) / b;
    return Math.max(0, fullKelly / 2);
  }

  function marketAllowed(league, marketType) {
    return !!MARKET_GATING?.[league]?.[marketType];
  }

  function marketRule(league, marketType) {
    return MARKET_RULES?.[league]?.[marketType] || null;
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

  /**
   * Canonical calibrated metrics — single source of truth for EV, Kelly, edge, probability.
   * All scoring and filtering uses these values, not raw candidate fields.
   */
  function calibratedMetrics(candidate) {
      const odds = num(candidate?.odds);
      // rawWinProb is stored by computeMarketEV before market anchoring; fall back to modelProb
      const rawModelProb = normalizeProb(candidate?.rawWinProb ?? candidate?.modelProb);
      const modelProb = compressProb(rawModelProb);
      const impliedProb = impliedProbFromAmericanOdds(odds);

      // Candidates from buildMarketBundle already have edge/evForStake100/kellyHalf computed
      // by computeMarketEV with market anchoring (single calibration). Recomputing from a
      // further compressProb() call causes double-calibration: a legitimate +6% NBA edge
      // becomes negative after the second pass, failing every threshold check.
      const preEdge = num(candidate?.edge);
      const edge = Number.isFinite(preEdge)
        ? preEdge
        : impliedProb == null
          ? 0
          : modelProb - impliedProb;

      const preEv = num(candidate?.evForStake100);
      const evForStake100 = Number.isFinite(preEv)
        ? preEv
        : (evFor100(modelProb, odds) ?? 0);

      const preKelly = num(candidate?.kellyHalf);
      const kellyHalf = Number.isFinite(preKelly)
        ? preKelly
        : (kellyHalfFromProb(modelProb, odds) ?? 0);

      return {
        rawModelProb,
        modelProb,
        impliedProb,
        edge,
        evForStake100,
        kellyHalf,
        calibrationFactor: CALIBRATION_FACTOR,
      };
    }

  /**
   * Single threshold gate. Does NOT depend on upstream tier assignment.
   * Returns a structured result with pass/fail and rejection reason for audit.
   */
  function checkThresholds(league, candidate, metrics) {
    const marketType = String(candidate?.marketType || "").toLowerCase();
    const odds = num(candidate?.odds);
    const rule = marketRule(league, marketType);
    const { modelProb, edge, evForStake100, kellyHalf } = metrics;

    const minEvForStake100 = num(rule?.minEvForStake100) ?? THRESHOLDS.minEvForStake100;
    const minKellyHalf = num(rule?.minKellyHalf) ?? THRESHOLDS.minKellyHalf;
    const minEdge = num(rule?.minEdge) ?? THRESHOLDS.minEdge;
    const maxEdge = num(rule?.maxEdge) ?? null;

    if (!marketAllowed(league, marketType)) {
      return { passed: false, rejectionReason: "market_disabled", rejectionDetail: null };
    }
    if (odds == null || odds === 0) {
      return { passed: false, rejectionReason: "missing_odds", rejectionDetail: null };
    }
    if (!oddsWithinRange(league, marketType, odds)) {
      return {
        passed: false,
        rejectionReason: "odds_out_of_range",
        rejectionDetail: { actual: odds, minOdds: rule?.minOdds ?? null, maxOdds: rule?.maxOdds ?? null },
      };
    }
    if (modelProb <= 0 || modelProb >= 1) {
      return {
        passed: false,
        rejectionReason: "invalid_model_prob",
        rejectionDetail: { actual: modelProb },
      };
    }
    if (evForStake100 < minEvForStake100) {
      return {
        passed: false,
        rejectionReason: "ev_below_threshold",
        rejectionDetail: { actual: Number(evForStake100.toFixed(4)), required: minEvForStake100 },
      };
    }
    if (kellyHalf < minKellyHalf) {
      return {
        passed: false,
        rejectionReason: "kelly_below_threshold",
        rejectionDetail: { actual: Number(kellyHalf.toFixed(6)), required: minKellyHalf },
      };
    }
    if (edge < minEdge) {
      return {
        passed: false,
        rejectionReason: "edge_below_threshold",
        rejectionDetail: { actual: Number(edge.toFixed(4)), required: minEdge },
      };
    }
    if (maxEdge != null && edge > maxEdge) {
      return {
        passed: false,
        rejectionReason: "edge_above_max",
        rejectionDetail: { actual: Number(edge.toFixed(4)), maxAllowed: maxEdge },
      };
    }

    return { passed: true, rejectionReason: null, rejectionDetail: null };
  }

  /**
   * Weighted score. Weights are read from config (RANKING_WEIGHTS) — must stay in sync.
   * Formula: edge * 100 * 0.45 + ev * 0.35 + kelly * 100 * 0.20 - penalties
   */
  function weightedScore(metrics, odds) {
    const { edge, evForStake100, kellyHalf, modelProb } = metrics;
    const o = num(odds) ?? 0;

    const juicePenalty = o < -180 ? Math.abs(o + 180) * 0.05 : 0;
    const probPenalty = modelProb > 0.75 ? (modelProb - 0.75) * 100 : 0;

    return (
      edge * 100 * RANKING_WEIGHTS.edge +
      evForStake100 * RANKING_WEIGHTS.ev +
      kellyHalf * 100 * RANKING_WEIGHTS.kelly -
      juicePenalty -
      probPenalty
    );
  }

    // Tier assignment by absolute weighted score — not rank position.
    // ELITE ≥8 means genuinely high signal; rank-based assignment made 92% of picks ELITE.
    function tierByScore(score) {
      const s = Number(score ?? 0);
      if (s >= 8) return "ELITE";
      if (s >= 4) return "STRONG";
      return "EDGE";
    }

  /**
   * Main export. Single authority for candidate filtering, scoring, tiering, and selection.
   *
   * Steps:
   *  1. Gate by enabled market
   *  2. Compute calibrated metrics for every candidate
   *  3. Apply one threshold gate (attach rejection reason to failures)
   *  4. Rank passing candidates by weighted score
   *  5. Assign tiers by rank position
   *  6. Cap to MAX_PICKS
   *  7. Select recommended if top score >= MIN_SCORE
   */
  export function applyPremiumSelection(league, candidates = []) {
    const maxPicks = MAX_PICKS[league] ?? 5;
    const minScore = MIN_SCORE[league] ?? 3.0;

    const rejected = [];
    const passing = [];

    for (const c of candidates) {
      const marketType = String(c?.marketType || "").toLowerCase();

      if (!marketAllowed(league, marketType)) {
        rejected.push({
          ...c,
          passed: false,
          rejectionReason: "market_disabled",
          rejectionDetail: null,
        });
        continue;
      }

      const metrics = calibratedMetrics(c);
      const thresholdResult = checkThresholds(league, c, metrics);
      const score = weightedScore(metrics, c?.odds);

      const enriched = {
        ...c,
        ...metrics,
        premiumScore: score,
        ...thresholdResult,
      };

      if (thresholdResult.passed) {
        passing.push(enriched);
      } else {
        rejected.push(enriched);
      }
    }

    // Rank passing candidates by score descending
    passing.sort((a, b) => (b.premiumScore ?? -1e9) - (a.premiumScore ?? -1e9));

    // Assign tiers by rank position and cap
    const tiered = passing.map((c, i) => {
      const tier = tierByScore(c.premiumScore);
      return {
        ...c,
        tier,
        tierRank: TIER_RANK[tier] ?? 0,
      };
    });

    const capped = tiered.slice(0, maxPicks);
    const best = capped[0] || null;
    const recommended = best && (best.premiumScore ?? 0) >= minScore ? best : null;

    return {
      candidates: capped,
      rejected,
      recommended,
    };
  }
  