import "dotenv/config";

const APP_BASE = process.env.APP_BASE || "http://127.0.0.1:3001";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

if (!ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN in apps/api/.env");
  process.exit(1);
}

function parseArgs() {
  const raw = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const cleaned = arg.replace(/^--/, "");
      const idx = cleaned.indexOf("=");
      if (idx === -1) return [cleaned, true];
      return [cleaned.slice(0, idx), cleaned.slice(idx + 1)];
    })
  );

  return {
    start: String(raw.start || "").trim(),
    end: String(raw.end || "").trim(),
    leagues: String(raw.leagues || "nba,nhl,ncaam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    dryRun: String(raw["dry-run"] || "false").toLowerCase() === "true",
    pauseMs: Number(raw.pauseMs || 1200),
  };
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function* dateRange(start, end) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));

  while (cur <= last) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${text.slice(0, 500)}`);
  }
  return data;
}

async function runPredict(league, date, dryRun) {
  const qs = new URLSearchParams({
    league,
    date,
  });

  if (dryRun) qs.set("dryRun", "true");

  const url = `${APP_BASE}/api/predict?${qs.toString()}`;
  const data = await fetchJson(url);

  const meta = data?.meta || {};
  const games = Array.isArray(data?.games) ? data.games.length : 0;

  return {
    ok: true,
    league,
    date,
    games,
    vegasOk: meta?.vegasOk ?? null,
    vegasReason: meta?.vegasReason ?? null,
    shape: meta?.odds?.shape ?? meta?.shape ?? null,
    events: meta?.vegasEvents ?? meta?.odds?.events ?? null,
  };
}

async function runScore(date, leagues, dryRun) {
  if (dryRun) {
    return { ok: true, skipped: true, reason: "dry-run" };
  }

  const qs = new URLSearchParams({
    date,
    leagues: leagues.join(","),
  });

  const url = `${APP_BASE}/api/admin/performance/run?${qs.toString()}`;
  return await fetchJson(url, {
    method: "POST",
    headers: {
      "x-admin-token": ADMIN_TOKEN,
    },
  });
}

async function main() {
  const args = parseArgs();

  if (!isYmd(args.start) || !isYmd(args.end)) {
    console.error("Usage: node src/scripts/backfillHistorical.js --start=2026-03-01 --end=2026-03-03 --leagues=nba --dry-run=true");
    process.exit(1);
  }

  const summary = [];
  let predictCalls = 0;

  for (const date of dateRange(args.start, args.end)) {
    console.log(`\n=== ${date} ===`);

    for (const league of args.leagues) {
      const out = await runPredict(league, date, args.dryRun);
      predictCalls += 1;
      summary.push({ type: "predict", ...out });
      console.log(JSON.stringify(out, null, 2));
      await sleep(args.pauseMs);
    }

    const score = await runScore(date, args.leagues, args.dryRun);
    summary.push({ type: "score", date, score });
    console.log(JSON.stringify({ type: "score", date, score }, null, 2));
    await sleep(args.pauseMs);
  }

  console.log("\n=== summary ===");
  console.log(JSON.stringify({
    ok: true,
    predictCalls,
    estimatedHistoricalCreditsH2H: predictCalls * 10,
    summary,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
