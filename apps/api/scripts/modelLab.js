import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const START = "2025-11-03";
const END = "2026-03-15";

function bucketOdds(o) {
  if (o === null || o === undefined) return "unknown";
  if (o <= -200) return "-200+";
  if (o <= -150) return "-150";
  if (o <= -110) return "-110";
  if (o <= -100) return "-100";
  if (o <= 100) return "+100";
  if (o <= 150) return "+150";
  return "+150+";
}

function bucketEdge(e) {
  if (e === null || e === undefined) return "unknown";
  if (e < 0.02) return "<2%";
  if (e < 0.05) return "2-5%";
  if (e < 0.10) return "5-10%";
  if (e < 0.20) return "10-20%";
  return "20%+";
}

function addStat(map, key, result) {
  if (!map[key]) map[key] = { picks: 0, wins: 0, losses: 0 };

  map[key].picks++;

  if (result === "win") map[key].wins++;
  if (result === "loss") map[key].losses++;
}

function finalize(map) {
  for (const k of Object.keys(map)) {
    const m = map[k];
    const scored = m.wins + m.losses;
    m.acc = scored ? (m.wins / scored).toFixed(3) : null;
  }
}

async function run() {
  const { data, error } = await supabase
    .from("picks_daily")
    .select(
      "league,market_type,result,market_odds,edge,meta"
    )
    .gte("date", START)
    .lte("date", END);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const league = {};
  const market = {};
  const odds = {};
  const edge = {};
  const tier = {};

  for (const r of data || []) {
    const result = (r.result || "").toLowerCase();

    if (result !== "win" && result !== "loss") continue;

    addStat(league, r.league, result);
    addStat(market, r.market_type, result);
    addStat(odds, bucketOdds(r.market_odds), result);
    addStat(edge, bucketEdge(r.edge), result);

    const t = r?.meta?.tier || "UNKNOWN";
    addStat(tier, t, result);
  }

  finalize(league);
  finalize(market);
  finalize(odds);
  finalize(edge);
  finalize(tier);

  console.log("\n===== PERFORMANCE BY LEAGUE =====");
  console.table(league);

  console.log("\n===== PERFORMANCE BY MARKET =====");
  console.table(market);

  console.log("\n===== PERFORMANCE BY ODDS =====");
  console.table(odds);

  console.log("\n===== PERFORMANCE BY EDGE =====");
  console.table(edge);

  console.log("\n===== PERFORMANCE BY TIER =====");
  console.table(tier);
}

run();
