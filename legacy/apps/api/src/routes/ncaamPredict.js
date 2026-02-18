// legacy/apps/api/src/routes/ncaamPredict.js
import express from "express";

const router = express.Router();

const ESPN_NCAAM_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

function normalizeDateParam(dateLike) {
  const s = String(dateLike || "").trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
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
  const recs = safeArr(competitor?.records);
  const best =
    recs.find((r) => String(r?.type || "").toLowerCase() === "total") ||
    recs.find((r) => String(r?.name || "").toLowerCase() === "overall") ||
    recs[0] ||
    null;

  const summary =
    best?.summary ||
    competitor?.record?.summary ||
    competitor?.team?.record?.summary ||
    null;

  return parseRecordSummary(summary);
}

function pickRankNumber(obj) {
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
  const x = (p - 0.5) / 0.25;
  return clamp(0.5 + x * 0.45, 0.5, 0.95);
}

function makePick({ eventId, home, away, homeRec, awayRec, homeRank, awayRank }) {
  if (!homeRec?.pct || !awayRec?.pct) return null;

  const rankBonus = (rank) => {
    if (!rank) return 0;
    return clamp((26 - Math.min(rank, 26)) / 25, 0, 1) * 0.035;
  };

  const homeStrength = homeRec.pct + rankBonus(homeRank);
  const awayStrength = awayRec.pct + rankBonus(awayRank);
  const diff = awayStrength - homeStrength;

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
    signals: {
      homeRecord: homeRec,
      awayRecord: awayRec,
      homeRank,
      awayRank,
      homeStrength: Number(homeStrength.toFixed(4)),
      awayStrength: Number(awayStrength.toFixed(4)),
    },
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
 * ✅ Exported builder (used by /api/predictions + /api/upsets)
 */
export async function buildNcaamEspnPredictions(dateYYYYMMDD) {
  const date = normalizeDateParam(dateYYYYMMDD) || todayUTCYYYYMMDD();
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
        signals: { homeRecord: homeRec, awayRecord: awayRec, homeRank, awayRank },
        pick: null,
      });
      continue;
    }

    out.push({ ...pick, pick: { ...pick } });
  }

  return {
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
  };
}

/**
 * ✅ /api/ncaam/predict
 */
router.get("/ncaam/predict", async (req, res) => {
  const date = normalizeDateParam(req.query.date || req.query["dates[]"]) || todayUTCYYYYMMDD();

  try {
    const payload = await buildNcaamEspnPredictions(date);
    return res.json(payload);
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
