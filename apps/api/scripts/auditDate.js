#!/usr/bin/env node
  /**
   * auditDate.js — per-pick scoring audit for a single date
   * Usage: node apps/api/scripts/auditDate.js 2026-03-31
   *        node apps/api/scripts/auditDate.js             (defaults to yesterday)
   */

  const API = process.env.API_BASE || "http://127.0.0.1:3001/api";
  const LEAGUES = ["nba", "nhl", "ncaam"];
  const STAKE = 100; // flat $100/bet for ROI calc

  function daysAgo(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function americanToDecimal(american) {
    const a = Number(american);
    if (!Number.isFinite(a) || a === 0) return null;
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }

  function roiStr(pnl, bets) {
    if (!bets) return "n/a";
    return ((pnl / (bets * STAKE)) * 100).toFixed(2) + "%";
  }

  function gradePick(game, pick) {
    const home = Number(game?.home?.score);
    const away = Number(game?.away?.score);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null; // not yet graded

    const diff = home - away;
    const total = home + away;
    const mt = String(pick?.marketType || "").toLowerCase();
    const side = String(pick?.pick || "").toLowerCase();

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
      if (side === "over") return total > line ? "W" : total < line ? "L" : "P";
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

  function colPad(s, n) {
    s = String(s ?? "");
    return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
  }

  function fmt(v, decimals = 2) {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    return Number(v).toFixed(decimals);
  }

  function fmtOdds(o) {
    if (o == null || !Number.isFinite(Number(o))) return "—";
    return Number(o) > 0 ? "+" + Number(o) : String(Number(o));
  }

  function fmtEdge(e) {
    if (e == null || !Number.isFinite(Number(e))) return "—";
    return (Number(e) * 100).toFixed(1) + "%";
  }

  async function fetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error("HTTP " + res.status + " — " + url);
    return res.json();
  }

  async function auditLeague(league, date) {
    const url = `${API}/predictions?league=${league}&date=${date}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      return { league, picks: [], error: e.message };
    }

    const games = Array.isArray(data?.games) ? data.games : [];
    const picks = [];

    for (const game of games) {
      const market = game?.market;
      const hasPick = market?.recommendedMarket && market?.pick;
      const matchup = `${game?.away?.abbr ?? "?"} @ ${game?.home?.abbr ?? "?"}`;
      const score = (Number.isFinite(Number(game?.home?.score)) && Number.isFinite(Number(game?.away?.score)))
        ? `${game.away.score}-${game.home.score}` : "—";
      const isCompleted = score !== "—";

      if (!hasPick) {
        picks.push({ matchup, score, hasPick: false, reason: market?.rejectionReason ?? "no_market" });
        continue;
      }

      const odds = market.marketOdds ?? market.odds;
      const grade = isCompleted ? gradePick(game, market) : null;
      const pnl = grade != null ? pnlForGrade(grade, odds) : null;

      picks.push({
        matchup,
        score,
        hasPick: true,
        marketType: market.recommendedMarket ?? market.marketType,
        pick: market.pick,
        odds,
        winProb: market.winProb,
        edge: market.edgeVsMarket ?? market.edge,
        ev: market.evForStake100 ?? market.ev,
        kelly: market.kellyHalf,
        tier: market.tier,
        premiumScore: market.premiumScore,
        grade,
        pnl,
        isCompleted,
        modelOnly: market.flags?.modelOnly ?? false,
      });
    }

    return { league, picks, vegasOk: data?.meta?.vegasOk, vegasEvents: data?.meta?.vegasEvents };
  }

  async function run() {
    const date = process.argv[2] || daysAgo(1);
    console.log("\n══════════════════════════════════════════════");
    console.log(" SCORING AUDIT —", date);
    console.log("══════════════════════════════════════════════\n");

    const results = await Promise.all(LEAGUES.map(lg => auditLeague(lg, date)));

    let totalPicks = 0;
    let totalGraded = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalPnl = 0;
    const leagueSummaries = [];

    for (const { league, picks, vegasOk, vegasEvents, error } of results) {
      if (error) {
        console.log(`[${league.toUpperCase()}] ERROR: ${error}\n`);
        continue;
      }

      const qualified = picks.filter(p => p.hasPick);
      const noMarket = picks.filter(p => !p.hasPick);
      const graded = qualified.filter(p => p.grade != null);
      const wins = graded.filter(p => p.grade === "W").length;
      const losses = graded.filter(p => p.grade === "L").length;
      const leaguePnl = graded.reduce((s, p) => s + (p.pnl ?? 0), 0);

      const header = `[${league.toUpperCase()}] Odds API: ${vegasOk ? "✓" : "✗"} (${vegasEvents ?? 0} events) | ${picks.length} games | ${qualified.length} picks | ${graded.length} graded`;
      console.log(header);
      console.log("─".repeat(header.length));

      if (qualified.length === 0) {
        if (noMarket.length > 0) {
          const reasons = {};
          noMarket.forEach(p => { reasons[p.reason] = (reasons[p.reason] || 0) + 1; });
          Object.entries(reasons).forEach(([r, n]) => console.log(`  No picks — reason: ${r} (${n} games)`));
        } else {
          console.log("  No games found for this date.");
        }
        console.log();
        continue;
      }

      // Header row
      console.log(
        colPad("Matchup", 20) +
        colPad("Pick", 12) +
        colPad("Odds", 7) +
        colPad("Prob%", 7) +
        colPad("Edge%", 7) +
        colPad("EV", 7) +
        colPad("Kelly", 7) +
        colPad("Score", 9) +
        colPad("Grade", 6) +
        colPad("P&L", 8) +
        "Tier/Score"
      );
      console.log("─".repeat(110));

      for (const p of qualified) {
        const probPct = p.winProb != null ? (Number(p.winProb) * 100).toFixed(1) + "%" : "—";
        const gradeStr = p.grade ?? (p.isCompleted ? "?" : "TBD");
        const pnlStr = p.pnl != null ? (p.pnl >= 0 ? "+" : "") + p.pnl.toFixed(2) : "—";
        const tierStr = p.tier ? `${p.tier} (${fmt(p.premiumScore, 1)})` : "—";

        console.log(
          colPad(p.matchup, 20) +
          colPad(`${p.marketType} ${p.pick}`, 12) +
          colPad(fmtOdds(p.odds), 7) +
          colPad(probPct, 7) +
          colPad(fmtEdge(p.edge), 7) +
          colPad(fmt(p.ev, 1), 7) +
          colPad(fmt(p.kelly, 3), 7) +
          colPad(p.score, 9) +
          colPad(gradeStr, 6) +
          colPad(pnlStr, 8) +
          tierStr +
          (p.modelOnly ? " [MODEL-ONLY]" : "")
        );
      }

      const roiLine = graded.length > 0
        ? `W:${wins} L:${losses} | ROI: ${roiStr(leaguePnl, graded.length)} | P&L: $${leaguePnl.toFixed(2)} on ${graded.length} graded bets`
        : `${qualified.length} picks — awaiting results`;
      console.log("─".repeat(110));
      console.log("  " + roiLine);
      console.log();

      totalPicks += qualified.length;
      totalGraded += graded.length;
      totalWins += wins;
      totalLosses += losses;
      totalPnl += leaguePnl;
      leagueSummaries.push({ league: league.toUpperCase(), picks: qualified.length, wins, losses, roi: roiStr(leaguePnl, graded.length) });
    }

    // Overall
    console.log("══════════════════════════════════════════════");
    console.log(` TOTAL — ${totalPicks} picks | ${totalGraded} graded | W:${totalWins} L:${totalLosses}`);
    if (totalGraded > 0) {
      console.log(` Overall ROI: ${roiStr(totalPnl, totalGraded)}`);
      console.log(` Total P&L:   $${totalPnl.toFixed(2)}`);
    }
    console.log("══════════════════════════════════════════════\n");

    // Flag model issues
    console.log("─── MODEL DIAGNOSTICS ───────────────────────");
    const allPicks = results.flatMap(r => r.picks?.filter(p => p.hasPick) ?? []);
    const highEdge = allPicks.filter(p => p.edge != null && Number(p.edge) > 0.12);
    const lowEV = allPicks.filter(p => p.ev != null && Number(p.ev) < 5);
    const mismatch = allPicks.filter(p => {
      const e = Number(p.edge); const ev = Number(p.ev);
      return Number.isFinite(e) && Number.isFinite(ev) && e > 0.08 && ev < 10;
    });

    if (highEdge.length) {
      console.log(`⚠  ${highEdge.length} pick(s) show edge >12% — may indicate double-anchoring overcorrection:`);
      highEdge.forEach(p => console.log(`   ${p.matchup}: edge=${fmtEdge(p.edge)} ev=${fmt(p.ev, 1)}`));
    }
    if (mismatch.length) {
      console.log(`⚠  ${mismatch.length} pick(s) with high edge but low EV — double-anchoring signature:`);
      mismatch.forEach(p => console.log(`   ${p.matchup}: edge=${fmtEdge(p.edge)} ev=${fmt(p.ev, 1)}`));
    }
    if (!highEdge.length && !mismatch.length) {
      console.log("  No obvious anchoring anomalies detected.");
    }
    console.log("──────────────────────────────────────────────\n");
  }

  run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
  