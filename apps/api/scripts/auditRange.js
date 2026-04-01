#!/usr/bin/env node
  /**
   * auditRange.js — 180-day model backtest (no DB backfill required)
   *
   * Calls the live /api/predictions endpoint for each past date, grades
   * picks against actual scores, and aggregates across leagues / months / tiers.
   *
   * Usage:
   *   node apps/api/scripts/auditRange.js                  # last 180 days
   *   node apps/api/scripts/auditRange.js 90               # last 90 days
   *   node apps/api/scripts/auditRange.js 2025-10-01 2026-03-31   # explicit range
   *
   * Options (env vars):
   *   API_BASE=http://127.0.0.1:3001/api   (default)
   *   CONCURRENCY=2                         parallel API calls per batch (default 2; use 1 for NBA-only)
   *   LEAGUES=nba,nhl,ncaam                 (default all three)
   *   QUIET=1                               suppress per-pick detail
   */

  const API        = process.env.API_BASE    || "http://127.0.0.1:3001/api";
  const CONCURRENCY = Number(process.env.CONCURRENCY) || 2;
  const LEAGUES    = (process.env.LEAGUES || "nba,nhl,ncaam").split(",").map(l => l.trim().toLowerCase());
  const STAKE      = 100;
  const QUIET      = process.env.QUIET === "1";

  // ─── Date helpers ─────────────────────────────────────────────────────────────

  function dateRange(startYMD, endYMD) {
    const dates = [];
    const cur = new Date(startYMD + "T00:00:00Z");
    const end = new Date(endYMD   + "T00:00:00Z");
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function monthKey(ymd) { return ymd.slice(0, 7); }       // "2026-03"
  function yyyymmdd()    { return new Date().toISOString().slice(0, 10); }

  // ─── Odds / grading ───────────────────────────────────────────────────────────

  function americanToDecimal(american) {
    const a = Number(american);
    if (!Number.isFinite(a) || a === 0) return null;
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }

  function gradePick(game, pick) {
    const home  = Number(game?.home?.score);
    const away  = Number(game?.away?.score);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    const diff  = home - away;
    const total = home + away;
    const mt    = String(pick?.marketType || "").toLowerCase();
    const side  = String(pick?.pick       || "").toLowerCase();

    if (mt === "moneyline") {
      if (side === "home") return diff > 0 ? "W" : diff < 0 ? "L" : "P";
      if (side === "away") return diff < 0 ? "W" : diff > 0 ? "L" : "P";
    }
    if (mt === "spread") {
      const line = Number(pick?.marketLine);
      if (!Number.isFinite(line)) return null;
      if (side === "home") return (diff + line) > 0 ? "W" : (diff + line) < 0 ? "L" : "P";
      if (side === "away") return (-diff + line) > 0 ? "W" : (-diff + line) < 0 ? "L" : "P";
    }
    if (mt === "total") {
      const line = Number(pick?.marketLine);
      if (!Number.isFinite(line)) return null;
      if (side === "over")  return total > line ? "W" : total < line ? "L" : "P";
      if (side === "under") return total < line ? "W" : total > line ? "L" : "P";
    }
    return null;
  }

  function pnlForGrade(grade, odds) {
    const dec = americanToDecimal(odds);
    if (!dec || !grade) return null;
    if (grade === "W") return +(STAKE * (dec - 1)).toFixed(2);
    if (grade === "L") return -STAKE;
    if (grade === "P") return 0;
    return null;
  }

  // ─── Fetch helpers ────────────────────────────────────────────────────────────

  async function fetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + url);
    return res.json();
  }

  async function auditDay(date, league) {
    const url = `${API}/predictions?league=${league}&date=${date}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      return { date, league, picks: [], error: e.message };
    }

    const games = Array.isArray(data?.games) ? data.games : [];
    const picks = [];

    for (const game of games) {
      const market     = game?.market;
      const hasPick    = market?.recommendedMarket && market?.pick;
      const homeScore  = Number(game?.home?.score);
      const awayScore  = Number(game?.away?.score);
      const isGraded   = Number.isFinite(homeScore) && Number.isFinite(awayScore);
      const matchup    = `${game?.away?.abbr ?? "?"} @ ${game?.home?.abbr ?? "?"}`;

      if (!hasPick) continue;   // only care about games where model made a pick

      const odds  = market.marketOdds ?? market.odds;
      const grade = isGraded ? gradePick(game, market) : null;
      const pnl   = grade != null ? pnlForGrade(grade, odds) : null;

      picks.push({
        date,
        league,
        matchup,
        marketType : market.recommendedMarket ?? market.marketType,
        pick       : market.pick,
        odds,
        winProb    : market.winProb,
        edge       : market.edgeVsMarket ?? market.edge,
        ev         : market.evForStake100 ?? market.ev,
        kelly      : market.kellyHalf,
        tier       : market.tier ?? "—",
        premiumScore: market.premiumScore,
        grade,
        pnl,
        isGraded,
        modelOnly  : market.flags?.modelOnly ?? false,
      });
    }

    return { date, league, picks };
  }

  // ─── Concurrency pool ─────────────────────────────────────────────────────────

  async function pool(tasks, concurrency) {
    const results = new Array(tasks.length);
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        results[i] = await tasks[i]();
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
    return results;
  }

  // ─── Aggregation helpers ──────────────────────────────────────────────────────

  function emptyBucket() {
    return { picks: 0, graded: 0, wins: 0, losses: 0, pushes: 0, pnl: 0, evSum: 0, edgeSum: 0 };
  }

  function addToBucket(b, p) {
    b.picks++;
    if (p.isGraded && p.grade != null) {
      b.graded++;
      if (p.grade === "W") b.wins++;
      if (p.grade === "L") b.losses++;
      if (p.grade === "P") b.pushes++;
      b.pnl += p.pnl ?? 0;
    }
    if (Number.isFinite(Number(p.ev)))   b.evSum   += Number(p.ev);
    if (Number.isFinite(Number(p.edge))) b.edgeSum += Number(p.edge);
  }

  function roiStr(pnl, bets) {
    if (!bets) return "n/a";
    return ((pnl / (bets * STAKE)) * 100).toFixed(1) + "%";
  }

  function fmt(v, d = 2) {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    return Number(v).toFixed(d);
  }

  function fmtOdds(o) {
    if (o == null || !Number.isFinite(Number(o))) return "—";
    return Number(o) > 0 ? "+" + Number(o) : String(Number(o));
  }

  function colPad(s, n) {
    s = String(s ?? "");
    return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
  }

  // ─── EV bucket analysis ───────────────────────────────────────────────────────

  function evBuckets(allPicks) {
    const buckets = [
      { label: "EV 5–10",  min: 5,  max: 10  },
      { label: "EV 10–15", min: 10, max: 15  },
      { label: "EV 15–20", min: 15, max: 20  },
      { label: "EV 20+",   min: 20, max: 999 },
    ];
    const rows = buckets.map(b => ({ ...b, ...emptyBucket() }));
    for (const p of allPicks) {
      const ev = Number(p.ev);
      if (!Number.isFinite(ev)) continue;
      const row = rows.find(r => ev >= r.min && ev < r.max);
      if (row) addToBucket(row, p);
    }
    return rows;
  }

  // ─── Main ─────────────────────────────────────────────────────────────────────

  async function run() {
    // Parse args
    let startDate, endDate;
    const args = process.argv.slice(2);
    if (args.length === 0) {
      startDate = daysAgo(180);
      endDate   = daysAgo(1);
    } else if (args.length === 1 && /^\d+$/.test(args[0])) {
      startDate = daysAgo(Number(args[0]));
      endDate   = daysAgo(1);
    } else if (args.length === 2) {
      startDate = args[0];
      endDate   = args[1];
    } else {
      console.error("Usage: node auditRange.js [days | startDate endDate]");
      process.exit(1);
    }

    const dates = dateRange(startDate, endDate).filter(d => d < yyyymmdd()); // skip today
    const totalDays = dates.length;

    console.log("\n" + "═".repeat(64));
    console.log(` MODEL BACKTEST  ${startDate} → ${endDate}  (${totalDays} days)`);
    console.log(` Leagues: ${LEAGUES.join(", ")} | Concurrency: ${CONCURRENCY} | Stake: $${STAKE}/bet`);
    console.log("═".repeat(64) + "\n");

    // Build task list: one per (date, league)
    const tasks = [];
    for (const date of dates) {
      for (const league of LEAGUES) {
        tasks.push(() => auditDay(date, league));
      }
    }

    let done = 0;
    const totalTasks = tasks.length;
    const wrappedTasks = tasks.map(t => async () => {
      const result = await t();
      done++;
      if (!QUIET && done % 20 === 0) {
        process.stdout.write(`  … ${done}/${totalTasks} fetched\r`);
      }
      return result;
    });

    const dayResults = await pool(wrappedTasks, CONCURRENCY);
    process.stdout.write(" ".repeat(40) + "\r"); // clear progress line

    // Aggregate results
    const allPicks = dayResults.flatMap(r => r.picks ?? []);
    const errCount = dayResults.filter(r => r.error).length;

    // By league
    const byLeague = {};
    for (const lg of LEAGUES) byLeague[lg] = emptyBucket();

    // By month
    const byMonth = {};

    // By tier
    const byTier = { ELITE: emptyBucket(), STRONG: emptyBucket(), EDGE: emptyBucket(), "—": emptyBucket() };

    // By market type
    const byMarket = {};

    for (const p of allPicks) {
      addToBucket(byLeague[p.league] ?? (byLeague[p.league] = emptyBucket()), p);
      const mk = monthKey(p.date);
      addToBucket(byMonth[mk] ?? (byMonth[mk] = emptyBucket()), p);
      const tier = p.tier ?? "—";
      addToBucket(byTier[tier] ?? (byTier[tier] = emptyBucket()), p);
      const mt = `${p.league.toUpperCase()} ${p.marketType ?? "?"}`;
      addToBucket(byMarket[mt] ?? (byMarket[mt] = emptyBucket()), p);
    }

    const total = emptyBucket();
    for (const p of allPicks) addToBucket(total, p);

    // ── Per-pick detail (unless QUIET) ──────────────────────────────────────────
    if (!QUIET && allPicks.length <= 300) {
      console.log("─── ALL PICKS (" + allPicks.length + ") ──────────────────────────────────────────────────");
      console.log(
        colPad("Date",    12) +
        colPad("League",  7) +
        colPad("Matchup", 20) +
        colPad("Pick",    12) +
        colPad("Odds",    7) +
        colPad("EV",      7) +
        colPad("Edge%",   7) +
        colPad("Tier",    8) +
        colPad("Sc",      8) +
        "Grade / P&L"
      );
      console.log("─".repeat(105));
      for (const p of allPicks) {
        const gradeStr = p.grade ?? (p.isGraded ? "?" : "TBD");
        const pnlStr   = p.pnl != null ? (p.pnl >= 0 ? "+" : "") + p.pnl.toFixed(0) : "—";
        const edgePct  = Number.isFinite(Number(p.edge)) ? (Number(p.edge) * 100).toFixed(1) + "%" : "—";
        console.log(
          colPad(p.date,   12) +
          colPad(p.league.toUpperCase(), 7) +
          colPad(p.matchup, 20) +
          colPad(`${p.marketType} ${p.pick}`, 12) +
          colPad(fmtOdds(p.odds), 7) +
          colPad(fmt(p.ev, 1), 7) +
          colPad(edgePct, 7) +
          colPad(p.tier, 8) +
          colPad(fmt(p.premiumScore, 1), 8) +
          `${gradeStr}  ${pnlStr}` +
          (p.modelOnly ? " [model-only]" : "")
        );
      }
      console.log();
    } else if (!QUIET && allPicks.length > 300) {
      console.log(`(Detail suppressed — ${allPicks.length} picks; re-run with a shorter window or set QUIET=1)\n`);
    }

    // ── By League ────────────────────────────────────────────────────────────────
    console.log("─── BY LEAGUE ─────────────────────────────────────────────────");
    console.log(colPad("League", 10) + colPad("Picks", 7) + colPad("Graded", 8) + colPad("W", 5) + colPad("L", 5) + colPad("ROI", 10) + colPad("P&L", 12) + "Avg EV");
    console.log("─".repeat(72));
    for (const [lg, b] of Object.entries(byLeague)) {
      const winRate = b.graded ? (b.wins / b.graded * 100).toFixed(1) + "%" : "—";
      const avgEv   = b.picks ? (b.evSum / b.picks).toFixed(1) : "—";
      console.log(
        colPad(lg.toUpperCase(), 10) +
        colPad(b.picks,  7) +
        colPad(b.graded, 8) +
        colPad(b.wins,   5) +
        colPad(b.losses, 5) +
        colPad(roiStr(b.pnl, b.graded), 10) +
        colPad("$" + b.pnl.toFixed(0), 12) +
        avgEv
      );
    }
    console.log();

    // ── By Market Type ────────────────────────────────────────────────────────────
    console.log("─── BY MARKET TYPE ──────────────────────────────────────────────");
    console.log(colPad("Market", 22) + colPad("Picks", 7) + colPad("Graded", 8) + colPad("W", 5) + colPad("L", 5) + colPad("ROI", 10) + "P&L");
    console.log("─".repeat(72));
    for (const [mt, b] of Object.entries(byMarket).sort((a, b) => b[1].picks - a[1].picks)) {
      console.log(
        colPad(mt, 22) +
        colPad(b.picks,  7) +
        colPad(b.graded, 8) +
        colPad(b.wins,   5) +
        colPad(b.losses, 5) +
        colPad(roiStr(b.pnl, b.graded), 10) +
        "$" + b.pnl.toFixed(0)
      );
    }
    console.log();

    // ── By Tier ──────────────────────────────────────────────────────────────────
    console.log("─── BY TIER ────────────────────────────────────────────────────");
    console.log(colPad("Tier", 10) + colPad("Picks", 7) + colPad("Graded", 8) + colPad("W", 5) + colPad("L", 5) + colPad("ROI", 10) + colPad("P&L", 12) + "Avg Score");
    console.log("─".repeat(72));
    const tierOrder = ["ELITE", "STRONG", "EDGE", "—"];
    for (const tier of tierOrder) {
      const b = byTier[tier];
      if (!b || b.picks === 0) continue;
      const avgScore = b.picks ? (allPicks.filter(p => (p.tier ?? "—") === tier).reduce((s, p) => s + (Number(p.premiumScore) || 0), 0) / b.picks).toFixed(1) : "—";
      console.log(
        colPad(tier, 10) +
        colPad(b.picks,  7) +
        colPad(b.graded, 8) +
        colPad(b.wins,   5) +
        colPad(b.losses, 5) +
        colPad(roiStr(b.pnl, b.graded), 10) +
        colPad("$" + b.pnl.toFixed(0), 12) +
        avgScore
      );
    }
    console.log();

    // ── EV Calibration ───────────────────────────────────────────────────────────
    console.log("─── EV CALIBRATION (do higher-EV picks actually win more?) ─────");
    console.log(colPad("EV Bucket", 12) + colPad("Picks", 7) + colPad("Graded", 8) + colPad("Win%", 8) + colPad("ROI", 10) + "Avg Odds");
    console.log("─".repeat(60));
    for (const b of evBuckets(allPicks)) {
      if (b.picks === 0) continue;
      const winRate  = b.graded ? (b.wins / b.graded * 100).toFixed(1) + "%" : "—";
      const avgOdds  = allPicks
        .filter(p => { const ev = Number(p.ev); return Number.isFinite(ev) && ev >= b.min && ev < b.max && Number.isFinite(americanToDecimal(p.odds)); })
        .reduce((s, p, _, a) => s + americanToDecimal(p.odds) / a.length, 0);
      const avgOddsStr = avgOdds ? (avgOdds > 2 ? "+" + Math.round((avgOdds - 1) * 100) : "-" + Math.round(100 / (avgOdds - 1))) : "—";
      console.log(
        colPad(b.label, 12) +
        colPad(b.picks,   7) +
        colPad(b.graded,  8) +
        colPad(winRate,   8) +
        colPad(roiStr(b.pnl, b.graded), 10) +
        avgOddsStr
      );
    }
    console.log();

    // ── Monthly breakdown ─────────────────────────────────────────────────────────
    console.log("─── BY MONTH ───────────────────────────────────────────────────");
    console.log(colPad("Month", 10) + colPad("Picks", 7) + colPad("Graded", 8) + colPad("W", 5) + colPad("L", 5) + colPad("Win%", 7) + colPad("ROI", 10) + "P&L");
    console.log("─".repeat(68));
    for (const [mo, b] of Object.entries(byMonth).sort()) {
      const winRate = b.graded ? (b.wins / b.graded * 100).toFixed(1) + "%" : "—";
      console.log(
        colPad(mo, 10) +
        colPad(b.picks,  7) +
        colPad(b.graded, 8) +
        colPad(b.wins,   5) +
        colPad(b.losses, 5) +
        colPad(winRate,  7) +
        colPad(roiStr(b.pnl, b.graded), 10) +
        "$" + b.pnl.toFixed(0)
      );
    }
    console.log();

    // ── Overall Summary ────────────────────────────────────────────────────────────
    const winPct = total.graded ? (total.wins / total.graded * 100).toFixed(1) + "%" : "—";
    console.log("═".repeat(64));
    console.log(` OVERALL SUMMARY  ${startDate} → ${endDate}`);
    console.log("─".repeat(64));
    console.log(` Total picks:     ${total.picks}`);
    console.log(` Graded picks:    ${total.graded}  (pending: ${total.picks - total.graded})`);
    console.log(` W / L / Push:    ${total.wins} / ${total.losses} / ${total.pushes}`);
    console.log(` Win rate:        ${winPct}`);
    console.log(` Overall ROI:     ${roiStr(total.pnl, total.graded)}`);
    console.log(` Total P&L:       $${total.pnl.toFixed(2)} on ${total.graded} x $${STAKE} flat bets`);
    console.log(` API errors:      ${errCount} / ${totalTasks} requests`);
    if (errCount > 0) {
      const errored = dayResults.filter(r => r.error).slice(0, 5);
      errored.forEach(r => console.log(`   ${r.date} ${r.league}: ${r.error}`));
      if (errCount > 5) console.log(`   … and ${errCount - 5} more`);
    }
    console.log("═".repeat(64) + "\n");

    // ── Model diagnostics ──────────────────────────────────────────────────────────
    console.log("─── MODEL DIAGNOSTICS ────────────────────────────────────────────");
    const ungraded = allPicks.filter(p => !p.isGraded).length;
    const modelOnly = allPicks.filter(p => p.modelOnly).length;
    const highEdge  = allPicks.filter(p => Number.isFinite(Number(p.edge)) && Number(p.edge) > 0.15);
    const negEV     = allPicks.filter(p => Number.isFinite(Number(p.ev)) && Number(p.ev) < 0);

    console.log(`  Graded: ${total.graded} | Ungraded: ${ungraded} | Model-only: ${modelOnly}`);
    if (negEV.length)    console.log(`  ⚠  ${negEV.length} picks had negative EV at time of pick (model bug indicator)`);
    if (highEdge.length) console.log(`  ℹ  ${highEdge.length} picks showed edge >15% (verify no double-anchor residue)`);

    // Win rate vs implied probability test
    const impliedWins = allPicks.filter(p => p.isGraded && p.grade === "W" && Number.isFinite(Number(p.winProb)));
    const impliedAvg  = impliedWins.length
      ? impliedWins.reduce((s, p) => s + Number(p.winProb), 0) / impliedWins.length
      : null;
    if (impliedAvg) {
      console.log(`  Model avg win-prob for winning picks: ${(impliedAvg * 100).toFixed(1)}%`);
      console.log(`  (should be above 50% — lower means wins came from lucky long shots)`);
    }
    console.log("──────────────────────────────────────────────────────────────────\n");
  }

  run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
  