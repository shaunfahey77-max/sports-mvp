// apps/api/src/routes/upsets.js
import express from "express";

const router = express.Router();

/**
 * Upsets v8 — premium-safe
 * - Source: direct resolver from routes/predictions.js (preferred)
 * - Fallback: HTTP GET /api/predictions (keeps local+deploy working)
 *
 * leagues: nba | nhl | ncaam
 * query aliases:
 *  - windowDays OR window   (accepted; currently informational)
 *  - minWin OR minProb
 *  - limit
 *  - mode: watch | strict
 *  - model: v1 | v2 (forwarded)
 *
 * Response:
 *  - rows[] (for web UI)
 *  - candidates[] (back-compat)
 *  - meta.strictUnderdogPicks ALWAYS a number
 */

const VERSION = "upsets-v8-premium-resolver";

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function asInt(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function asFloat(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function pickSideToIsAwayPick(pick) {
  const p = String(pick || "").toLowerCase();
  if (p === "away") return true;
  if (p === "home") return false;
  return null;
}

// “Elo-ish” gap derived from factors (not true Elo).
// Positive => home favored, negative => away favored.
function computeGapFromFactors(factors) {
  const homeWin = Number(factors?.homeWinPct);
  const awayWin = Number(factors?.awayWinPct);
  const homeMargin = Number(factors?.homeMarginPerGame);
  const awayMargin = Number(factors?.awayMarginPerGame);
  const homeRecent = Number(factors?.homeRecentWinPct ?? factors?.homeRecent10WinPct);
  const awayRecent = Number(factors?.awayRecentWinPct ?? factors?.awayRecent10WinPct);

  const winDiff = Number.isFinite(homeWin) && Number.isFinite(awayWin) ? homeWin - awayWin : 0;
  const marginDiff =
    Number.isFinite(homeMargin) && Number.isFinite(awayMargin) ? homeMargin - awayMargin : 0;
  const recentDiff =
    Number.isFinite(homeRecent) && Number.isFinite(awayRecent) ? homeRecent - awayRecent : 0;

  // Scale into a ~“gap points” number that feels like Elo-ish magnitude.
  const gapPoints = winDiff * 220 + marginDiff * 10 + recentDiff * 160;
  return gapPoints; // + = home favored
}

function makeMatchup(away, home) {
  const a = away?.abbr || away?.name || "AWAY";
  const h = home?.abbr || home?.name || "HOME";
  return `${a} @ ${h}`;
}

// ✅ strict validation: must be a real prob between (0,1)
function isRealProb(p) {
  return Number.isFinite(p) && p > 0 && p < 1;
}

async function fetchJson(url) {
  // Node 18+ has global fetch. If you deploy on older Node, this will fail.
  // (If needed, swap to undici; keeping as-is for simplicity.)
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j?.error || `Request failed (${r.status})`;
    throw new Error(msg);
  }
  return j;
}

/**
 * Prefer a direct resolver from routes/predictions.js for speed + consistency.
 * Falls back to HTTP /api/predictions if no resolver is exported.
 */
async function getPremiumPredictions({ league, date, model, req }) {
  // 1) Preferred: direct function import
  try {
    const mod = await import("./predictions.js"); // same folder

    // If you have (or add) an exported helper like:
    // export async function getPredictionsFor({ league, date, model }) { ... }
    const fn =
      mod.getPredictionsFor ||
      mod.getPredictions ||
      mod.buildPredictions ||
      null;

    if (typeof fn === "function") {
      const out = await fn({ league, date, model });
      return out;
    }
  } catch {
    // ignore and fallback to HTTP
  }

  // 2) Fallback: call our own API using the request host
  const base = `${req.protocol}://${req.get("host")}`;
  const url =
    `${base}/api/predictions?league=${encodeURIComponent(league)}` +
    `&date=${encodeURIComponent(date)}` +
    (model ? `&model=${encodeURIComponent(model)}` : "");

  return await fetchJson(url);
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, route: "upsets", version: VERSION });
});

router.get("/", async (req, res) => {
  const t0 = Date.now();
  try {
    const league = String(req.query.league || "nba").trim().toLowerCase();
    const date = String(req.query.date || iso(new Date())).slice(0, 10);

    // accepted (currently informational, but we keep returning it)
    const windowDays = clamp(asInt(req.query.windowDays ?? req.query.window, 14), 3, 90);

    // minWin is “underdog win equity” threshold
    const minWin = clamp(asFloat(req.query.minWin ?? req.query.minProb, 0.3), 0.05, 0.95);

    const limit = clamp(asInt(req.query.limit, 20), 1, 50);

    const mode = String(req.query.mode || "watch").trim().toLowerCase(); // watch | strict

    // forward model to predictions if provided (v1/v2)
    const model = req.query.model != null ? String(req.query.model).trim().toLowerCase() : null;

    const pred = await getPremiumPredictions({ league, date, model, req });

    const games = Array.isArray(pred?.games) ? pred.games : [];
    const slateGames = games.length;

    let strictUnderdogPicks = 0;
    const rows = [];

    for (const g of games) {
      const home = g?.home || g?.homeTeam || null;
      const away = g?.away || g?.awayTeam || null;
      if (!home || !away) continue;

      const market = g?.market || {};
      const pick = market?.pick; // "home" | "away" | null
      const conf = Number(market?.confidence);

      if (!pick) continue;

      const isAwayPick = pickSideToIsAwayPick(pick);
      if (isAwayPick == null) continue;

      // Determine favorite from factor-derived gap (positive = home favored)
      const baseGap = computeGapFromFactors(g?.factors);
      const favoriteSide = baseGap >= 0 ? "home" : "away";
      const underdogSide = favoriteSide === "home" ? "away" : "home";

      const modelSide = isAwayPick ? "away" : "home";

      // Prefer model-provided winProb ONLY if it's a real probability.
      // Treat market.winProb as "picked side win probability".
      const rawWinProb = market?.winProb;
      const modelPickWinProb = isRealProb(rawWinProb) ? Number(rawWinProb) : null;

      // Fallback: infer from confidence only if confidence is sane.
      const modelPickWinProbFromConf = Number.isFinite(conf) ? clamp(conf, 0.05, 0.95) : null;

      const useModelWinProb = modelPickWinProb != null;
      const pPick = useModelWinProb ? modelPickWinProb : modelPickWinProbFromConf;

      // If we still can't get a prob, skip (can’t score upset equity)
      if (pPick == null) continue;

      // Underdog win probability:
      // If model picked underdog -> p(underdog)=pPick
      // If model picked favorite -> p(underdog)=1-pPick
      const modelPickedUnderdog = modelSide === underdogSide;
      const underdogWinProb = modelPickedUnderdog ? pPick : 1 - pPick;

      if (modelPickedUnderdog) strictUnderdogPicks += 1;
      if (mode === "strict" && !modelPickedUnderdog) continue;

      if (underdogWinProb < minWin) continue;

      const underdogTeam = underdogSide === "home" ? home : away;
      const favoriteTeam = underdogSide === "home" ? away : home;

      const why = [];
      why.push(`Underdog equity: ${(underdogWinProb * 100).toFixed(1)}%`);
      why.push(`Favorite side (gap): ${favoriteSide.toUpperCase()} (${Math.round(Math.abs(baseGap))})`);
      if (modelPickedUnderdog) why.push("Model already picked underdog");
      why.push(useModelWinProb ? "Using model winProb" : "Using confidence fallback");

      // Score for sorting: higher equity + closer matchup
      const score = underdogWinProb * 100 - Math.abs(baseGap) * 0.04;

      rows.push({
        id: g?.gameId || `${league}-${date}-${makeMatchup(away, home)}`,
        gameId: g?.gameId || null,
        league,
        date,
        matchup: makeMatchup(away, home),

        home: {
          id: home?.id,
          name: home?.name,
          abbr: home?.abbr,
          logo: home?.logo,
        },
        away: {
          id: away?.id,
          name: away?.name,
          abbr: away?.abbr,
          logo: away?.logo,
        },

        underdog: {
          id: underdogTeam?.id,
          name: underdogTeam?.name,
          abbr: underdogTeam?.abbr,
          isHome: underdogSide === "home",
        },
        favorite: {
          id: favoriteTeam?.id,
          name: favoriteTeam?.name,
          abbr: favoriteTeam?.abbr,
          isHome: underdogSide !== "home",
        },

        winProb: underdogWinProb,

        pick: {
          pickSide: modelSide,
          recommendedTeamId: market?.recommendedTeamId ?? null,
          recommendedTeamName: market?.recommendedTeamName ?? null,
          edge: Number.isFinite(Number(market?.edge)) ? Number(market.edge) : null,
          confidence: Number.isFinite(conf) ? conf : null,
          winProb: pPick, // picked-side win prob (or confidence fallback)
        },

        signals: {
          baseGap,
          isAwayPick: modelSide === "away",
          score,
          mode,
          favoriteSide,
          underdogSide,
          usedModelWinProb: useModelWinProb,
          model: model || null,
        },

        why,
      });
    }

    rows.sort((a, b) => (b?.signals?.score ?? 0) - (a?.signals?.score ?? 0));
    const trimmed = rows.slice(0, limit);

    return res.json({
      ok: true,
      league,
      date,
      mode,
      windowDays,
      minWin,
      count: trimmed.length,
      rows: trimmed,
      candidates: trimmed, // back-compat
      meta: {
        source: pred?.meta?.source || "premium-predictions",
        slateGames,
        rowsIn: trimmed.length,
        strictUnderdogPicks, // ALWAYS a number
        windowDaysUsed: windowDays,
        minWinUsed: minWin,
        limitUsed: limit,
        modelForwarded: model || null,
        elapsedMs: Date.now() - t0,
        version: VERSION,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
