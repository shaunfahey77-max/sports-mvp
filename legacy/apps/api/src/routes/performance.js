// apps/api/src/routes/performance.js
import express from "express";
import { supabase } from "../lib/supabase.js";

const router = express.Router();

const ALLOWED_LEAGUES = new Set(["nba", "nhl", "ncaam"]);

function utcYYYYMMDD(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return dt.toISOString().slice(0, 10);
}

function lastNDatesUTC(days) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(utcYYYYMMDD(d));
  }
  return out.reverse(); // oldest -> newest
}

router.get("/performance", async (req, res) => {
  const t0 = Date.now();

  const leaguesRaw = String(req.query.leagues || "nba,nhl,ncaam");
  const leagues = leaguesRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((l) => ALLOWED_LEAGUES.has(l));

  const days = Math.max(1, Math.min(60, Number(req.query.days || 30)));
  const dates = lastNDatesUTC(days);
  const dateMin = dates[0];
  const dateMax = dates[dates.length - 1];

  const rowsByLeague = {};
  let missingCount = 0;

  for (const league of leagues) {
    const { data, error } = await supabase
      .from("performance_daily")
      .select(
        "date,league,games,picks,completed,wins,losses,pushes,pass,win_rate,roi,by_conf,by_edge,by_market,updated_at,notes"
      )
      .eq("league", league)
      .gte("date", dateMin)
      .lte("date", dateMax)
      .order("date", { ascending: true });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: `supabase_error: ${error.message}`,
      });
    }

    const map = new Map((data || []).map((r) => [String(r.date), r]));

    rowsByLeague[league] = dates.map((d) => {
      const r = map.get(d);
      if (!r) {
        missingCount++;
        return {
          date: d,
          league,
          games: 0,
          picks: 0,
          completed: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          pass: 0,
          win_rate: null,
          roi: null,
          by_conf: {},
          by_edge: {},
          by_market: {},
          error: "missing_db_row",
          updated_at: null,
          notes: null,
        };
      }
      return { ...r, error: null };
    });
  }

  res.json({
    ok: true,
    meta: {
      source: "supabase:performance_daily",
      elapsedMs: Date.now() - t0,
      requestedDays: days,
      effectiveDays: dates.length,
      missingCount,
      partial: missingCount > 0,
      dateMin,
      dateMax,
      leagues,
    },
    rows: rowsByLeague,
  });
});

export default router;
