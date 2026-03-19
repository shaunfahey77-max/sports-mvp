import { supabase } from "../db/dailyLedger.js";

const APP_BASE = process.env.APP_BASE || "http://127.0.0.1:3001";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "localdev";
const END_DATE = process.argv[2] || "2026-03-18";

const WINDOWS = [
  { league: "nhl", start: "2025-10-07" },
  { league: "nba", start: "2025-10-21" },
  { league: "ncaam", start: "2025-11-03" },
];

async function getExistingDates(league, start, end) {
  const { data, error } = await supabase
    .from("picks_daily")
    .select("date")
    .eq("league", league)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed fetching existing dates for ${league}: ${error.message}`);
  }

  return [...new Set((data || []).map((r) => r.date).filter(Boolean))];
}

async function runOne(league, date) {
  const url = `${APP_BASE}/api/admin/performance/run?date=${encodeURIComponent(date)}&leagues=${encodeURIComponent(league)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-admin-token": ADMIN_TOKEN,
      "content-type": "application/json",
    },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for ${league} ${date}: ${text.slice(0, 300)}`);
  }

  if (!res.ok || !json?.ok) {
    throw new Error(`Backfill failed for ${league} ${date}: ${JSON.stringify(json)}`);
  }

  const row = Array.isArray(json.results) ? json.results[0] : null;

  return {
    league,
    date,
    roi: row?.roi ?? null,
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
    scored: row?.scored ?? 0,
    ledgerResultsUpdated: row?.ledgerResultsUpdated ?? 0,
  };
}

async function main() {
  console.log(JSON.stringify({
    ok: true,
    mode: "season-performance-backfill",
    endDate: END_DATE,
    windows: WINDOWS
  }, null, 2));

  for (const { league, start } of WINDOWS) {
    const dates = await getExistingDates(league, start, END_DATE);
    console.log(JSON.stringify({
      league,
      start,
      endDate: END_DATE,
      existingDates: dates.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null
    }));

    for (const date of dates) {
      const out = await runOne(league, date);
      console.log(JSON.stringify(out));
    }
  }

  console.log(JSON.stringify({ ok: true, done: true, endDate: END_DATE }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2));
  process.exit(1);
});
