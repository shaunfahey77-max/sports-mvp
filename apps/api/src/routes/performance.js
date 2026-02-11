// apps/api/src/routes/performance.js
import express from "express";

const router = express.Router();

/**
 * Very small in-memory cache to prevent re-hitting upstreams
 * (especially during dev + HMR refreshes).
 */
const CACHE = new Map();
// key -> { exp:number, val:any }
const CACHE_TTL_MS = 1000 * 60 * 3; // 3 minutes

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    CACHE.delete(key);
    return null;
  }
  return hit.val;
}

function cacheSet(key, val, ttlMs = CACHE_TTL_MS) {
  CACHE.set(key, { exp: Date.now() + ttlMs, val });
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function parseYMD(s) {
  // Expect YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function summarizeGames(games) {
  const out = {
    games: Array.isArray(games) ? games.length : 0,
    picks: 0,
    pass: 0,
    completed: 0,
    wins: 0,
    losses: 0,
    scored: 0,
    acc: null,
  };

  for (const g of games || []) {
    const pick = g?.market?.pick;
    if (pick) out.picks++;
    else out.pass++;

    const status = String(g?.status || "").toLowerCase();
    const isFinal = status === "final" || status === "post" || status === "completed";
    if (!isFinal) continue;

    out.completed++;

    const predictedId = g?.market?.recommendedTeamId || null;
    const winnerId = g?.result?.winnerTeamId || null;
    if (predictedId && winnerId) {
      if (predictedId === winnerId) out.wins++;
      else out.losses++;
    }
  }

  out.scored = out.wins + out.losses;
  out.acc = out.scored ? out.wins / out.scored : null;
  return out;
}

/**
 * GET /api/performance?start=YYYY-MM-DD&end=YYYY-MM-DD&leagues=nba,nhl,ncaam
 *
 * Returns: { ok, start, end, leagues, rows: { nba:[...], nhl:[...], ncaam:[...] } }
 * where each row = { date, scored, acc, wins, losses, picks, completed, games }
 *
 * Implementation note:
 * We call your existing /api/predictions endpoint internally so you don't have to
 * refactor the prediction engine right now. This still collapses the frontend into
 * ONE request and lets us cache server-side.
 */
router.get("/performance", async (req, res) => {
  const startS = req.query.start;
  const endS = req.query.end;

  const startD = parseYMD(startS);
  const endD = parseYMD(endS);

  if (!startD || !endD) {
    return res.status(400).json({ ok: false, error: "start/end must be YYYY-MM-DD" });
  }
  if (endD < startD) {
    return res.status(400).json({ ok: false, error: "end must be >= start" });
  }

  const rawLeagues = String(req.query.leagues || "nba,nhl,ncaam");
  const leagues = rawLeagues
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // safety: max 14 days
  const days = [];
  {
    const cur = new Date(startD);
    while (cur <= endD) {
      days.push(ymd(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
      if (days.length > 14) break;
    }
  }

  const port = process.env.PORT || 3001;
  const base = `http://127.0.0.1:${port}`;

  async function getPredictionsCached(league, date) {
    const key = `pred:${league}:${date}`;
    const hit = cacheGet(key);
    if (hit) return hit;

    const url = `${base}/api/predictions?league=${encodeURIComponent(league)}&date=${encodeURIComponent(date)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`predictions ${league} ${date} failed (${r.status}) ${txt}`.trim());
    }
    const j = await r.json();
    cacheSet(key, j);
    return j;
  }

  try {
    const rows = {};
    for (const lg of leagues) rows[lg] = [];

    // Concurrency limit so we don't blast upstreams
    const CONCURRENCY = 4;
    const queue = [];

    async function runOne(lg, date) {
      const key = `perf:${lg}:${date}`;
      const hit = cacheGet(key);
      if (hit) return hit;

      const j = await getPredictionsCached(lg, date);
      const summary = summarizeGames(j?.games || []);
      const row = { date, ...summary };
      cacheSet(key, row);
      return row;
    }

    for (const lg of leagues) {
      for (const date of days) {
        queue.push({ lg, date });
      }
    }

    let idx = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (idx < queue.length) {
        const mine = queue[idx++];
        const row = await runOne(mine.lg, mine.date);
        rows[mine.lg].push(row);
      }
    });

    await Promise.all(workers);

    // Ensure rows per league are sorted by date
    for (const lg of leagues) {
      rows[lg].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }

    return res.json({
      ok: true,
      start: ymd(startD),
      end: ymd(endD),
      leagues,
      rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
