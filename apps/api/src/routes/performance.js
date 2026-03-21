import express from "express";
import { supabase } from "../db/dailyLedger.js";

const router = express.Router();

router.get("/performance", async (req, res) => {
  try {
    const leagues = String(req.query.leagues || "nba,nhl,ncaam")
      .split(",")
      .map(l => l.trim());

    const days = Number(req.query.days || 7);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("performance_daily")
      .select("*")
      .in("league", leagues)
      .gte("date", sinceStr)
      .order("date", { ascending: true });

    if (error) throw error;

    return res.json({
      ok: true,
      source: "performance_daily_only",
      rows: data
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
