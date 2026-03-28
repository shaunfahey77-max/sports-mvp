import express from "express";
  import { supabase } from "../db/dailyLedger.js";

  const router = express.Router();

  function toNum(v) {
    if (v == null) return null;          // null/undefined → null, not 0
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function ymdUTC(d = new Date()) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }

  function startDateFromDays(days) {
    const n = Math.max(1, Number(days) || 14);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (n - 1));
    return ymdUTC(d);
  }

  function parseLeagues(raw) {
    return String(raw || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  async function loadPerformanceRows({ leagues, days }) {
    const start = startDateFromDays(days);
    const end = ymdUTC(new Date());

    const { data, error } = await supabase
      .from("performance_daily")
      .select("id,league,date,games,picks,pass,completed,wins,losses,scored,acc,created_at,updated_at,error,by_conf,by_edge,by_market,notes,pushes,win_rate,roi,model_version,vegas_ok,by_tier")
      .gte("date", start)
      .lte("date", end)
      .in("league", leagues)
      .order("date", { ascending: false })
      .order("league", { ascending: true });

    if (error) throw error;

    return {
      start,
      end,
      rows: Array.isArray(data) ? data : [],
    };
  }

  // Fetches CLV deltas AND odds+result for ROI computation
  async function loadPickRows({ leagues, days }) {
    const start = startDateFromDays(days);
    const end = ymdUTC(new Date());

    const { data, error } = await supabase
      .from("picks_daily")
      .select("date,league,pick,result,odds,market_odds,clv_line_delta,clv_implied_delta")
      .gte("date", start)
      .lte("date", end)
      .in("league", leagues)
      .neq("pick", "PASS");

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function buildClvMap(pickRows) {
    const out = new Map();

    for (const row of pickRows) {
      const league = String(row?.league || "").toLowerCase();
      const date = String(row?.date || "");
      if (!league || !date) continue;

      const key = `${league}__${date}`;
      if (!out.has(key)) {
        out.set(key, { clvCount: 0, impClvCount: 0, clvSum: 0, impClvSum: 0 });
      }

      const bucket = out.get(key);

      const clv = toNum(row?.clv_line_delta);
      if (clv != null) { bucket.clvCount += 1; bucket.clvSum += clv; }

      const imp = toNum(row?.clv_implied_delta);
      if (imp != null) { bucket.impClvCount += 1; bucket.impClvSum += imp; }
    }

    return out;
  }

  function mergePerformanceWithClv(perfRows, clvMap) {
    return perfRows.map((row) => {
      const key = `${String(row?.league || "").toLowerCase()}__${String(row?.date || "")}`;
      const clv = clvMap.get(key);

      return {
        ...row,
        scored_picks: toNum(row?.scored) ?? toNum(row?.picks) ?? 0,
        avg_clv_line:
          clv && clv.clvCount > 0 ? clv.clvSum / clv.clvCount : null,
        avg_clv_implied:
          clv && clv.impClvCount > 0 ? clv.impClvSum / clv.impClvCount : null,
        clv_count: clv?.clvCount ?? 0,
        imp_clv_count: clv?.impClvCount ?? 0,
      };
    });
  }

  function latestByLeague(rows) {
    const out = new Map();
    for (const row of rows) {
      const lg = String(row?.league || "").toLowerCase();
      if (!lg) continue;
      const prev = out.get(lg);
      if (!prev || String(row?.date || "") > String(prev?.date || "")) {
        out.set(lg, row);
      }
    }
    return [...out.values()].sort((a, b) => String(a.league).localeCompare(String(b.league)));
  }

  // ROI helper: American odds → profit on 1-unit bet
  function unitProfit(odds) {
    const o = Number(odds);
    if (!Number.isFinite(o) || o === 0) return null;
    return o > 0 ? o / 100 : 100 / Math.abs(o);
  }

  function aggregateRows(rows, pickRows = []) {
    let wins = 0;
    let losses = 0;
    let passes = 0;
    let picks = 0;
    let scoredPicks = 0;

    const clvVals = [];
    const impVals = [];
    let clvCoveredRows = 0;
    let impClvCoveredRows = 0;

    for (const row of rows) {
      wins += toNum(row?.wins) || 0;
      losses += toNum(row?.losses) || 0;
      passes += toNum(row?.pass) || 0;
      picks += toNum(row?.picks) || 0;
      scoredPicks += toNum(row?.scored_picks) || 0;

      const clv = toNum(row?.avg_clv_line);
      if (clv != null) { clvVals.push(clv); clvCoveredRows += 1; }

      const imp = toNum(row?.avg_clv_implied);
      if (imp != null) { impVals.push(imp); impClvCoveredRows += 1; }
    }

    const avgClv = clvVals.length ? clvVals.reduce((a, b) => a + b, 0) / clvVals.length : null;
    const avgImpClv = impVals.length ? impVals.reduce((a, b) => a + b, 0) / impVals.length : null;

    const eligible = latestByLeague(rows).filter((r) => (toNum(r?.scored_picks) || 0) > 0);
    const bestLeagueRow = eligible
      .sort((a, b) =>
        (toNum(b?.acc) ?? -999) - (toNum(a?.acc) ?? -999) ||
        (toNum(b?.roi) ?? -999) - (toNum(a?.roi) ?? -999)
      )[0] || null;

    const totalRows = rows.length || 0;
    const clvCoverage = totalRows ? clvCoveredRows / totalRows : null;
    const impliedClvCoverage = totalRows ? impClvCoveredRows / totalRows : null;
    const acc = scoredPicks > 0 ? wins / scoredPicks : null;

    // ROI — computed directly from raw picks (odds + result)
    let roiUnits = 0;
    let roiStake = 0;
    let roiWins = 0;
    let roiLosses = 0;

    // Per-league ROI
    const leagueRoi = {};

    for (const r of pickRows) {
      const res = String(r?.result || "").toUpperCase();
      if (res !== "WIN" && res !== "LOSS" && res !== "PUSH") continue;

      const odds = toNum(r?.odds) ?? toNum(r?.market_odds);
      if (odds == null) continue;

      const profit = unitProfit(odds);
      if (profit == null) continue;

      const lg = String(r?.league || "").toLowerCase();
      if (!leagueRoi[lg]) leagueRoi[lg] = { units: 0, stake: 0, wins: 0, losses: 0, odds: [] };

      roiStake += 1;
      leagueRoi[lg].stake += 1;
      leagueRoi[lg].odds.push(odds);

      if (res === "WIN") {
        roiUnits += profit;
        roiWins += 1;
        leagueRoi[lg].units += profit;
        leagueRoi[lg].wins += 1;
      } else if (res === "LOSS") {
        roiUnits -= 1;
        roiLosses += 1;
        leagueRoi[lg].units -= 1;
        leagueRoi[lg].losses += 1;
      }
      // PUSH: stake counted, no units change
    }

    const roi = roiStake > 0 ? roiUnits / roiStake : null;

    // Average odds across all settled picks
    const allOdds = pickRows
      .filter(r => toNum(r?.odds) != null || toNum(r?.market_odds) != null)
      .map(r => toNum(r?.odds) ?? toNum(r?.market_odds));
    const avgOdds = allOdds.length ? allOdds.reduce((a, b) => a + b, 0) / allOdds.length : null;

    // Finalize per-league ROI
    const byLeagueRoi = {};
    for (const [lg, d] of Object.entries(leagueRoi)) {
      const lgOddsArr = d.odds;
      byLeagueRoi[lg] = {
        stake: d.stake,
        wins: d.wins,
        losses: d.losses,
        units: Number(d.units.toFixed(3)),
        roi: d.stake > 0 ? Number((d.units / d.stake).toFixed(4)) : null,
        avg_odds: lgOddsArr.length ? Math.round(lgOddsArr.reduce((a, b) => a + b, 0) / lgOddsArr.length) : null,
      };
    }

    return {
      picks,
      pass: passes,
      wins,
      losses,
      acc,
      accuracy: acc,
      scored: scoredPicks,
      scoredPicks,
      scored_picks: scoredPicks,
      avg_clv_line: avgClv,
      avgClv,
      avg_clv: avgClv,
      avg_clv_implied: avgImpClv,
      avgImpClv,
      avg_imp_clv: avgImpClv,
      clv_coverage: clvCoverage,
      clvCoverage,
      implied_clv_coverage: impliedClvCoverage,
      impliedClvCoverage,
      bestLeague: bestLeagueRow?.league || null,
      best_league: bestLeagueRow?.league || null,
      // ROI fields
      roi,
      roi_units: Number(roiUnits.toFixed(3)),
      roi_stake: roiStake,
      avg_odds: avgOdds != null ? Math.round(avgOdds) : null,
      by_league_roi: byLeagueRoi,
    };
  }

  async function loadMerged({ leagues, days }) {
    const [perf, pickRows] = await Promise.all([
      loadPerformanceRows({ leagues, days }),
      loadPickRows({ leagues, days }),
    ]);

    const clvMap = buildClvMap(pickRows);
    const rows = mergePerformanceWithClv(perf.rows, clvMap);

    return {
      start: perf.start,
      end: perf.end,
      rows,
      pickRows,
    };
  }

  router.get("/performance", async (req, res) => {
    try {
      const leagues = parseLeagues(req.query.leagues);
      const days = Number(req.query.days) || 14;
      const { start, end, rows } = await loadMerged({ leagues, days });

      return res.json({
        ok: true,
        source: "performance_daily_only",
        start,
        end,
        leagues,
        rows,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get("/performance/kpis", async (req, res) => {
    try {
      const leagues = parseLeagues(req.query.leagues);
      const days = Number(req.query.days) || 14;
      const { start, end, rows, pickRows } = await loadMerged({ leagues, days });
      const kpis = aggregateRows(rows, pickRows);

      return res.json({
        ok: true,
        source: "performance_daily_only",
        start,
        end,
        leagues,
        ...kpis,
        kpis,
        data: kpis,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get("/performance/league", async (req, res) => {
    try {
      const leagues = parseLeagues(req.query.leagues);
      const days = Number(req.query.days) || 14;
      const { start, end, rows } = await loadMerged({ leagues, days });
      const leagueRows = latestByLeague(rows);

      return res.json({
        ok: true,
        source: "performance_daily_only",
        start,
        end,
        leagues,
        rows: leagueRows,
        leaguesData: leagueRows,
        leagues_data: leagueRows,
        data: leagueRows,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get("/performance/recent", async (req, res) => {
    try {
      const leagues = parseLeagues(req.query.leagues);
      const days = Number(req.query.days) || 14;
      const limit = Math.max(1, Math.min(60, Number(req.query.limit) || 21));
      const { start, end, rows } = await loadMerged({ leagues, days });

      return res.json({
        ok: true,
        source: "performance_daily_only",
        start,
        end,
        leagues,
        rows: rows.slice(0, limit),
        recent: rows.slice(0, limit),
        data: rows.slice(0, limit),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  /* =========================================================
     MODEL SUMMARY (used by Predict.jsx)
     ========================================================= */

  router.get("/performance/model-summary", async (req, res) => {
    try {
      const days = Number(req.query.days || 30);
      const leagues = String(req.query.leagues || "nba,nhl,ncaam")
        .split(",")
        .map((s) => s.trim().toLowerCase());

      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - (days - 1));

      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("picks_daily")
        .select("result, odds, clv_line_delta, clv_implied_delta")
        .in("league", leagues)
        .gte("date", startStr)
        .lte("date", endStr);

      if (error) throw error;

      const rows = data || [];

      const settled = rows.filter((r) => {
        const res = String(r.result || "").toUpperCase();
        return res === "WIN" || res === "LOSS" || res === "PUSH";
      });

      let units = 0;
      let stake = 0;

      function profit(odds) {
        const o = Number(odds);
        if (!Number.isFinite(o)) return 0;
        return o > 0 ? o / 100 : 100 / Math.abs(o);
      }

      for (const r of settled) {
        const res = String(r.result || "").toUpperCase();
        const p = profit(r.odds);
        if (res === "WIN") { stake += 1; units += p; }
        else if (res === "LOSS") { stake += 1; units -= 1; }
        else if (res === "PUSH") { stake += 1; }
      }

      const clv = rows
        .map((r) => Number(r.clv_line_delta))
        .filter((n) => Number.isFinite(n));

      const imp = rows
        .map((r) => Number(r.clv_implied_delta))
        .filter((n) => Number.isFinite(n));

      const avgClv = clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : null;
      const avgImpClv = imp.length ? imp.reduce((a, b) => a + b, 0) / imp.length : null;

      return res.json({
        ok: true,
        data: {
          bets: settled.length,
          units,
          stake,
          roi: stake ? units / stake : null,
          avgClv,
          avgImpClv,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  export default router;
  