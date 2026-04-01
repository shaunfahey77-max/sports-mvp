// Single source of truth for all scoring configuration.
    // All thresholds, weights, limits, and toggle flags live here.
    // premiumSelection.js reads from this file — no threshold values elsewhere.

    export const MARKET_GATING = {
      nba: { moneyline: true, spread: false, total: false },
      ncaam: { moneyline: false, spread: false, total: true  },
      nhl:   { moneyline: true,  spread: false, total: false },
    };

    // Global fallback thresholds for any league/market not explicitly defined in MARKET_RULES
    // Tightened 2026-03-31: 90-day audit showed 643/696 rows tagged ELITE — far too permissive.
    export const THRESHOLDS = {
    minEvForStake100: 15,
    minKellyHalf: 0.05,
    minEdge: 0.06,
  };

    export const MARKET_RULES = {
      nba: {
        moneyline: {
          minOdds: -500,
          maxOdds: 700,
          minEdge: 0.06,
          minEvForStake100: 10,
          minKellyHalf: 0.04,
        },
        spread: {
          minEvForStake100: 8,
          minKellyHalf: 0.02,
          minEdge: 0.05,
          minOdds: -140,
          maxOdds: 180,
        },
        total: {
          minEvForStake100: 8,
          minKellyHalf: 0.02,
          minEdge: 0.05,
          minOdds: -140,
          maxOdds: 140,
        },
      },
      nhl: {
        moneyline: {
          // Model profitable on underdogs/even (+20.1% / +7.7% ROI) but loses on -120 to -150
          // favorites (-9.4% ROI on 114 picks). Block favorites above -108.
          minEvForStake100: 20,
          minKellyHalf: 0.05,
          minEdge: 0.08,
          minOdds: -108,
          maxOdds: 140,
        },
        spread: {
          minEvForStake100: 4,
          minKellyHalf: 0.015,
          minEdge: 0.02,
          minOdds: -260,
          maxOdds: 220,
        },
        total: {
          minEvForStake100: 7,
          minKellyHalf: 0.02,
          minEdge: 0.04,
          minOdds: -160,
          maxOdds: 140,
        },
      },
      ncaam: {
        // NCAAM total was +0.50% ROI — keep threshold, do not loosen.
        total: {
          minEvForStake100: 10,
          minKellyHalf: 0.025,
          minEdge: 0.08,
          minOdds: -140,
          maxOdds: 120,
        },
      },
    };

    // Scoring formula weights — must match weightedScore() in premiumSelection.js exactly.
    export const RANKING_WEIGHTS = {
      edge: 0.45,
      ev: 0.35,
      kelly: 0.20,
    };

    // Probability compression factor: shrinks model prob toward 0.5 to reduce overconfidence.
    export const CALIBRATION_FACTOR = 0.65;

    // Maximum candidates to surface per league after ranking.
    export const MAX_PICKS = {
      nba: 5,
      ncaam: 4,
      nhl: 5,
    };

    // Minimum premium score required for the top candidate to become the recommended pick.
    export const MIN_SCORE = {
      nba: 1.0,
      ncaam: 2.0,
      nhl: 3.0,
    };

    export const TIER_RANK = {
      PASS: 0,
      LEAN: 1,
      EDGE: 2,
      STRONG: 3,
      ELITE: 4,
    };
    