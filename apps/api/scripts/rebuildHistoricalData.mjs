import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";

const execFileAsync = promisify(execFile);

function ymd(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymd(dt);
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const [k, v] = x.split("=");
      return [k.replace(/^--/, ""), v ?? "true"];
    })
  );

  const today = ymd(new Date());
  const startDefault = addDays(today, -364);

  return {
    start: args.start || startDefault,
    end: args.end || today,
    adminToken: process.env.ADMIN_TOKEN || "localdev",
    leagues: args.leagues || "nba,nhl,ncaam",
    dryRun: args["dry-run"] === "true",
  };
}

function dateRange(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

async function runSnapshot(date, leagues) {
  const { stdout, stderr } = await execFileAsync(
    "node",
    ["--env-file=.env", "src/jobs/captureMarketSnapshots.js", `--date=${date}`, `--leagues=${leagues}`],
    { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }
  );

  const text = `${stdout || ""}${stderr || ""}`.trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`Snapshot output was not JSON for ${date}: ${text}`);
  }

  const parsed = JSON.parse(text.slice(jsonStart));
  if (!parsed?.ok) {
    throw new Error(`Snapshot failed for ${date}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function runScoring(date, leagues, adminToken) {
  const url = `http://127.0.0.1:3001/api/admin/performance/run?date=${date}&leagues=${encodeURIComponent(leagues)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-admin-token": adminToken },
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Scoring returned non-JSON for ${date}: ${text}`);
  }

  if (!res.ok || !parsed?.ok) {
    throw new Error(`Scoring failed for ${date}: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function dbCheck(date) {
  const [{ count: picksCount, error: picksErr }, { count: snapCount, error: snapErr }, { count: perfCount, error: perfErr }] =
    await Promise.all([
      supabaseAdmin.from("picks_daily").select("*", { count: "exact", head: true }).eq("date", date),
      supabaseAdmin.from("market_snapshots").select("*", { count: "exact", head: true }).eq("snapshot_date", date),
      supabaseAdmin.from("performance_daily").select("*", { count: "exact", head: true }).eq("date", date),
    ]);

  if (picksErr) throw new Error(`picks_daily check failed for ${date}: ${picksErr.message}`);
  if (snapErr) throw new Error(`market_snapshots check failed for ${date}: ${snapErr.message}`);
  if (perfErr) throw new Error(`performance_daily check failed for ${date}: ${perfErr.message}`);

  return {
    picks_daily_rows: picksCount ?? 0,
    market_snapshot_rows: snapCount ?? 0,
    performance_daily_rows: perfCount ?? 0,
  };
}

async function main() {
  const cfg = parseArgs();
  const dates = dateRange(cfg.start, cfg.end);

  console.log(JSON.stringify({
    ok: true,
    phase: "start",
    start: cfg.start,
    end: cfg.end,
    days: dates.length,
    leagues: cfg.leagues,
    dryRun: cfg.dryRun,
  }, null, 2));

  for (const date of dates) {
    console.log(`\n==================================================`);
    console.log(`DATABASE UPDATE ${date}`);
    console.log(`==================================================`);

    if (cfg.dryRun) {
      console.log(JSON.stringify({ ok: true, date, skipped: true }, null, 2));
      continue;
    }

    const snapshot = await runSnapshot(date, cfg.leagues);
    console.log(JSON.stringify({ step: "snapshot", date, results: snapshot.results }, null, 2));

    const scoring = await runScoring(date, cfg.leagues, cfg.adminToken);
    console.log(JSON.stringify({ step: "scoring", date, results: scoring.results }, null, 2));

    const check = await dbCheck(date);
    console.log(JSON.stringify({ step: "db_check", date, ...check }, null, 2));
  }

  console.log(`\n==================================================`);
  console.log(`DATABASE UPDATE COMPLETE`);
  console.log(`==================================================`);
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(err?.message || err),
  }, null, 2));
  process.exit(1);
});
