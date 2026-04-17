/**
 * Phase 0.75C tuning-pass impact script.
 *
 * Re-evaluates EXISTING scored_picks rows from the post-fix window through
 * the current applyRiskControls + assignTier config, and prints a
 * before/after delta of tier counts and PASS reasons per league_market.
 *
 * Read-only: never writes back to the DB. Existing rows are not mutated.
 * The intent is to show how the new tuning would have classified the same
 * candidates, so we can sanity-check the change before letting it apply
 * to fresh picks.
 */

import { db, scoredPicksTable } from "@workspace/db";
import { and, gte } from "drizzle-orm";
import { assignTier } from "../../artifacts/api-server/src/scoring/assignTiers";
import type { League, MarketType } from "../../artifacts/api-server/src/config/scoringModelConfig";
import { ODDS_RANGE_GUARDRAIL_LEAGUES } from "../../artifacts/api-server/src/config/scoringModelConfig";

// The POST cohort in kpiReport.ts uses 2026-04-16 (conservative). For the
// before/after surfaced-pick comparison, we use the wider line-shopping-fix
// cutoff (2026-04-12) so the resolved sample is large enough for the Tier A
// realized-win-rate breakdown to be meaningful.
const POST_FIX_CUTOFF = "2026-04-12";

function fmtPct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

interface Row {
  league: string;
  market: string;
  oldTier: string;
  newTier: string;
  newReason: string | null;
  result: string;
}

async function main() {
  const rows = await db
    .select({
      league: scoredPicksTable.league,
      market: scoredPicksTable.market,
      tier: scoredPicksTable.tier,
      edge: scoredPicksTable.edge,
      ev: scoredPicksTable.ev,
      rankScore: scoredPicksTable.rankScore,
      publishOdds: scoredPicksTable.publishOdds,
      publishLine: scoredPicksTable.publishLine,
      result: scoredPicksTable.result,
      meta: scoredPicksTable.meta,
    })
    .from(scoredPicksTable)
    .where(and(gte(scoredPicksTable.date, POST_FIX_CUTOFF)));

  const guardrail: readonly League[] = ODDS_RANGE_GUARDRAIL_LEAGUES;

  const evaluated: Row[] = rows.map((r) => {
    // marketQuality is not stored on scored_picks; the picks already passed
    // the original mq>=0.3 gate at insertion time, so for re-evaluation we
    // pass a value safely above the floor. assignTier still re-checks mq>=0.3,
    // but no row in scored_picks should fail that historical bar.
    const meta = (r.meta ?? {}) as { marketQuality?: number };
    const mq = meta.marketQuality ?? 0.9;
    const { tier, selectionReason } = assignTier({
      rankScore: Number(r.rankScore),
      edge: Number(r.edge),
      ev: Number(r.ev),
      marketQuality: mq,
      league: r.league as League,
      marketType: r.market as MarketType,
      publishOdds: Number(r.publishOdds),
      publishLine: r.publishLine == null ? null : Number(r.publishLine),
      enableOddsRangeGuardrail: guardrail.includes(r.league as League),
    });
    return {
      league: r.league,
      market: r.market,
      oldTier: r.tier,
      newTier: tier,
      newReason: selectionReason,
      result: r.result,
    };
  });

  // ===== Before/after surfaced (= non-PASS) per league_market =====
  const groups = new Map<string, Row[]>();
  for (const r of evaluated) {
    const k = `${r.league}_${r.market}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  console.log("=".repeat(96));
  console.log("Phase 0.75C tuning-pass impact (post-fix scored_picks, date >= " + POST_FIX_CUTOFF + ")");
  console.log("=".repeat(96));
  console.log();

  console.log(
    "league_market".padEnd(20),
    "n".padStart(5),
    "OLD A".padStart(7),
    "OLD B".padStart(7),
    "OLD C".padStart(7),
    "OLD PASS".padStart(9),
    "→",
    "NEW A".padStart(7),
    "NEW B".padStart(7),
    "NEW C".padStart(7),
    "NEW PASS".padStart(9),
    "  Δ surfaced"
  );
  console.log("-".repeat(120));

  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, rs] of sorted) {
    const oldA = rs.filter((r) => r.oldTier === "A").length;
    const oldB = rs.filter((r) => r.oldTier === "B").length;
    const oldC = rs.filter((r) => r.oldTier === "C").length;
    const oldP = rs.filter((r) => r.oldTier === "PASS").length;
    const newA = rs.filter((r) => r.newTier === "A").length;
    const newB = rs.filter((r) => r.newTier === "B").length;
    const newC = rs.filter((r) => r.newTier === "C").length;
    const newP = rs.filter((r) => r.newTier === "PASS").length;
    const oldSurf = oldA + oldB + oldC;
    const newSurf = newA + newB + newC;
    const delta = newSurf - oldSurf;
    console.log(
      k.padEnd(20),
      String(rs.length).padStart(5),
      String(oldA).padStart(7),
      String(oldB).padStart(7),
      String(oldC).padStart(7),
      String(oldP).padStart(9),
      "→",
      String(newA).padStart(7),
      String(newB).padStart(7),
      String(newC).padStart(7),
      String(newP).padStart(9),
      `  ${delta >= 0 ? "+" : ""}${delta} (${fmtPct(newSurf, oldSurf || 1)})`
    );
  }

  // ===== New PASS reasons (where the change kicked in) =====
  console.log();
  console.log("New PASS reasons on previously-surfaced picks:");
  console.log("-".repeat(96));
  const newlyPassed = evaluated.filter((r) => r.oldTier !== "PASS" && r.newTier === "PASS");
  const reasonByMarket = new Map<string, Map<string, number>>();
  for (const r of newlyPassed) {
    const k = `${r.league}_${r.market}`;
    if (!reasonByMarket.has(k)) reasonByMarket.set(k, new Map());
    const m = reasonByMarket.get(k)!;
    const reason = r.newReason ?? "unknown";
    m.set(reason, (m.get(reason) ?? 0) + 1);
  }
  if (reasonByMarket.size === 0) {
    console.log("  (none — no previously surfaced picks would now PASS)");
  } else {
    for (const [k, m] of reasonByMarket) {
      const parts = [...m.entries()].map(([r, c]) => `${r}=${c}`).join("  ");
      console.log(`  ${k.padEnd(18)} ${parts}`);
    }
  }

  // ===== Tier A demotions (A → B/C) =====
  console.log();
  console.log("Tier A demotions (still surfaced, but downgraded):");
  console.log("-".repeat(96));
  const demoted = evaluated.filter(
    (r) => r.oldTier === "A" && r.newTier !== "A" && r.newTier !== "PASS"
  );
  const demoByMarket = new Map<string, Map<string, number>>();
  for (const r of demoted) {
    const k = `${r.league}_${r.market}`;
    if (!demoByMarket.has(k)) demoByMarket.set(k, new Map());
    const m = demoByMarket.get(k)!;
    m.set(r.newTier, (m.get(r.newTier) ?? 0) + 1);
  }
  if (demoByMarket.size === 0) {
    console.log("  (none)");
  } else {
    for (const [k, m] of demoByMarket) {
      const parts = [...m.entries()].map(([t, c]) => `→${t}=${c}`).join("  ");
      console.log(`  ${k.padEnd(18)} ${parts}`);
    }
  }

  // ===== Resolved-only realized win rate, OLD-A vs NEW-A =====
  console.log();
  console.log("Resolved win rate: OLD Tier A vs NEW Tier A (post-fix sample, per league_market):");
  console.log("-".repeat(96));
  for (const [k, rs] of sorted) {
    const oldA = rs.filter((r) => r.oldTier === "A" && (r.result === "win" || r.result === "loss"));
    const newA = rs.filter((r) => r.newTier === "A" && (r.result === "win" || r.result === "loss"));
    const oldW = oldA.filter((r) => r.result === "win").length;
    const newW = newA.filter((r) => r.result === "win").length;
    if (oldA.length === 0 && newA.length === 0) continue;
    console.log(
      `  ${k.padEnd(18)} OLD A: ${oldW}/${oldA.length} (${fmtPct(oldW, oldA.length)})  ` +
        `→  NEW A: ${newW}/${newA.length} (${fmtPct(newW, newA.length)})`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
