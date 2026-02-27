// apps/api/src/routes/ev.js
import express from "express";

const router = express.Router();

/**
 * Helpers
 */
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function americanToDecimal(american) {
  const a = toNum(american);
  if (a == null || a === 0) return null;
  if (a > 0) return 1 + a / 100;
  return 1 + 100 / Math.abs(a);
}

function americanToImpliedProb(american) {
  const a = toNum(american);
  if (a == null || a === 0) return null;
  if (a > 0) return 100 / (a + 100);
  return Math.abs(a) / (Math.abs(a) + 100);
}

/**
 * EV per $1 stake:
 * decimalOdds = d
 * profit if win = d - 1
 * EV = p*(d-1) - (1-p)
 */
function evPerDollar(p, decimalOdds) {
  if (!Number.isFinite(p) || !Number.isFinite(decimalOdds)) return null;
  return p * (decimalOdds - 1) - (1 - p);
}

/**
 * Kelly fraction for $1 bankroll:
 * b = decimalOdds - 1
 * f* = (bp - q) / b
 */
function kellyFraction(p, decimalOdds) {
  if (!Number.isFinite(p) || !Number.isFinite(decimalOdds)) return null;
  const b = decimalOdds - 1;
  if (!(b > 0)) return null;
  const q = 1 - p;
  return (b * p - q) / b;
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "ev", version: "ev-v1" });
});

/**
 * GET /api/ev?odds=-110&modelProb=0.56&stake=100
 *
 * Required:
 * - odds (american)
 * - modelProb (0..1)
 *
 * Optional:
 * - stake (default 100)
 */
router.get("/", (req, res) => {
  const odds = toNum(req.query.odds);
  const modelProbRaw = toNum(req.query.modelProb ?? req.query.p);
  const stake = toNum(req.query.stake) ?? 100;

  if (odds == null) {
    return res.status(400).json({ ok: false, error: "Missing or invalid odds (american), e.g. -110 or +120" });
  }
  if (modelProbRaw == null) {
    return res.status(400).json({ ok: false, error: "Missing or invalid modelProb (0..1), e.g. 0.56" });
  }

  const modelProb = clamp(modelProbRaw, 0, 1);

  const decimalOdds = americanToDecimal(odds);
  const impliedProb = americanToImpliedProb(odds);

  if (decimalOdds == null || impliedProb == null) {
    return res.status(400).json({ ok: false, error: "Could not derive implied/decimal odds from provided american odds" });
  }

  const edge = modelProb - impliedProb;
  const ev1 = evPerDollar(modelProb, decimalOdds);
  const evStake = ev1 != null ? ev1 * stake : null;

  const breakEven = impliedProb; // same concept
  const kelly = kellyFraction(modelProb, decimalOdds);
  const kellyClamped = kelly == null ? null : clamp(kelly, -1, 1);
  const halfKelly = kellyClamped == null ? null : kellyClamped / 2;

  // Profit / loss for stake
  const profitIfWin = stake * (decimalOdds - 1);
  const lossIfLose = stake;

  return res.json({
    ok: true,
    inputs: { odds, modelProb, stake },
    derived: {
      decimalOdds,
      impliedProb,
      breakEvenProb: breakEven,
      edge,
    },
    ev: {
      perDollar: ev1,
      forStake: evStake,
      profitIfWin,
      lossIfLose,
    },
    kelly: {
      full: kellyClamped,
      half: halfKelly,
      note: "Negative Kelly => no bet. Consider half-kelly for volatility control.",
    },
  });
});

export default router;