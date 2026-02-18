// legacy/apps/api/src/routes/ncaamPredict.js
import express from "express";

const router = express.Router();

// ✅ ESPN scoreboard (WORKING host per your curl)
const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

function normalizeDateParam(dateLike) {
  const s = String(dateLike || "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYYMMDD -> YYYY-MM-DD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  return null;
}

function todayUTCYYYYMMDD() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utc.toISOString().slice(0, 10);
}

function ymdToEspnDate(ymd) {
  return String(ymd || "").replaceAll("-", "");
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      "user-agent": "sports-mvp/1.0 (+local dev)",
      accept: "application/json,text/plain,*/*",
    },
  }).finally(() => clearTimeout(t));

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstream ${res.status} for ${url}${text ? ` — ${text}` : ""}`);
  }

  return res.json();
}

function parseRecordSummary(summary) {
  // "17-8" -> {wins:17, losses:8, games:25, pct:0.68}
  const s = String(summary || "").trim();
  const m = s.match(/^(\d+)\s*-\s*(\d+)/);
  if (!m) return null;

  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const games = wins + losses;
  if (!Number.isFinite(wins) || !Number.isFinite(losses) || games <= 0) return null;

  return { wins, losses, games, pct: wins / games };
}

function pickRecordObj(competitor) {
  // ESPN sometimes has:
  // competitor.records = [{ summary:"17-8", type:"total" }, ...]
  // or competitor.record = ...
  const recs = safeArr(competitor?.records);
  const best =
    recs.find((r) => String(r?.type || "").toLowerCase() === "total") ||
    recs.find((r) => String(r?.name || "").toLowerCase() === "overall") ||
    recs[0] ||
    null;

  const summary = best?.summary || competitor?.record?.summary || null;
  const parsed = parseRecordSummary(summary);
  return parsed;
}

function pickRankNumber(obj) {
  // ESPN rank lives in different places depending on feed
  // Try several:
  const a = obj?.curatedRank?.current;
  const b = obj?.rank?.current;
  const c = obj?.team?.rank?.current;
  const d = obj?.team?.curatedRank?.current;

  const cand = [a, b, c, d].find((x) => x != null);
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function logistic(z) {
  return 1 / (1 + Math.exp(-z));
}

function tierFromWinProb(p) {
  if (p >= 0.64) return "A";
  if (p >= 0.59) return "B";
  if (p >= 0.55) return "C";
  return "D";
}

function confidenceFromWinProb(p) {
  // Map 0.50..0.75 -> 0.50..0.95 (clamped)
  const x = (p - 0.5) / 0.25; // 0..1
  return clamp(0.5 + x * 0.45, 0.5, 0.95);
}

/**
 * Build a simple but stable ESPN-based prediction:
 * - Uses overall record win% (primary)
 * - Uses rank as a small bonus (secondary)
 * - Produces gameId that matches /api/games (ncaam-<eventId>)
 */
function makePick({ eventId, home, away, homeRec, awayRec, homeRank, awayRank }) {
  // If we can’t compute win pcts, no-pick
  if (!homeRec?.pct || !awayRec?.pct) return null;

  // Rank bonus: better (lower) rank => small + ; unranked => 0
  const rankBonus = (rank) => {
    if (!rank) return 0;
    // rank 1 -> ~0.035, rank 25 -> ~0.010
    return clamp((26 - Math.min(rank, 26)) / 25, 0, 1) * 0.035;
  };

  const homeStrength = homeRec.pct + rankBonus(homeRank);
  const awayStrength = awayRec.pct + rankBonus(awayRank);

  const diff = awayStrength - homeStrength;

  // Convert to winProb for the pick side
  // Keep it conservative to avoid wild 90% outputs.
  const awayWin = clamp(logistic(diff * 6), 0.52, 0.74);
  const homeWin = 1 - awayWin;

  const pickSide = diff >= 0 ? "away" : "home";
  const winProb = pickSide === "away" ? awayWin : homeWin;

  const tier = tierFromWinProb(winProb);
  const confidence = confidenceFromWinProb(winProb);
  const edge = winProb - 0.5;

  const matchup = `${away.abbr || away.name} @ ${home.abbr || home.name}`;

  const gameId = `ncaam-${eventId}`;

  return {
    gameId,
    matchup,
    pickSide,
    winProb: Number(winProb.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    tier,
    confidence: Number(confidence.toFixed(4)),
  };
}

async function getEspnSlate(dateYYYYMMDD) {
  const espnDate = ymdToEspnDate(dateYYYYMMDD);
  const sourceUrl = `${ESPN_NCAAM_SCOREBOARD}?dates=${encodeURIComponent(espnDate)}`;

  const json = await fetchJson(sourceUrl);
  const events = safeArr(json?.events);

  return { events, sourceUrl };
}

/**
 * ✅ /api/ncaam/predict (ESPN)
 * Returns:
 * { meta, games:[{gameId,matchup,pickSide,winProb,edge,tier,confidence,pick:{...}}] }
 */
router.get("/ncaam/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();

  try {
    const { events, sourceUrl } = await getEspnSlate(date);

    const out = [];
    let noPickCount = 0;

    for (const ev of events) {
      const comp = safeArr(ev?.competitions)[0] || null;
      const competitors = safeArr(comp?.competitors);

      const homeC = competitors.find((c) => c?.homeAway === "home") || null;
      const awayC = competitors.find((c) => c?.homeAway === "away") || null;

      const homeT = homeC?.team || {};
      const awayT = awayC?.team || {};

      const eventId = ev?.id ? String(ev.id) : null;
      if (!eventId) {
        noPickCount += 1;
        continue;
      }

      const home = {
        id: `ncaam-${String(homeT?.abbreviation || homeT?.id || "home").toLowerCase()}`,
        name: homeT?.displayName || homeT?.shortDisplayName || homeT?.abbreviation || "Home",
        abbr: homeT?.abbreviation || null,
        espnTeamId: homeT?.id || null,
      };

      const away = {
        id: `ncaam-${String(awayT?.abbreviation || awayT?.id || "away").toLowerCase()}`,
        name: awayT?.displayName || awayT?.shortDisplayName || awayT?.abbreviation || "Away",
        abbr: awayT?.abbreviation || null,
        espnTeamId: awayT?.id || null,
      };

      const homeRec = pickRecordObj(homeC);
      const awayRec = pickRecordObj(awayC);

      const homeRank = pickRankNumber(homeC) || pickRankNumber(homeT) || null;
      const awayRank = pickRankNumber(awayC) || pickRankNumber(awayT) || null;

      const pick = makePick({ eventId, home, away, homeRec, awayRec, homeRank, awayRank });

      if (!pick) {
        noPickCount += 1;
        out.push({
          gameId: `ncaam-${eventId}`,
          matchup: `${away.abbr || away.name} @ ${home.abbr || home.name}`,
          pickSide: null,
          winProb: null,
          edge: null,
          tier: null,
          confidence: null,
          pick: null,
        });
        continue;
      }

      out.push({
        ...pick,
        // Back-compat: also include nested pick for older UIs
        pick: { ...pick },
      });
    }

    return res.json({
      meta: {
        league: "ncaam",
        date,
        model: "NCAAM espn-record-rank-v1",
        source: "espn-scoreboard",
        sourceUrl,
        windowDays: null,
        noPickCount,
        note: "NCAAM predictions generated from ESPN scoreboard data (stable; no CBBD quota).",
        warnings: [],
      },
      games: out,
    });
  } catch (e) {
    return res.status(502).json({
      meta: {
        league: "ncaam",
        date,
        model: "NCAAM espn-record-rank-v1",
        source: "espn-scoreboard",
        sourceUrl: null,
        windowDays: null,
        noPickCount: null,
        note: "Failed to generate NCAAM predictions from ESPN.",
        warnings: [String(e?.message || e)],
      },
      games: [],
      error: String(e?.message || e),
    });
  }
});

export default router;
