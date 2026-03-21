/* EXTENDED: settlement + CLV */

const SCOREBOARD_CONFIG = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nhl: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  ncaam: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
};

function ymdToEspnDate(date) {
  return String(date || "").replaceAll("-", "");
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractEventId(gameKey) {
  const m = String(gameKey || "").match(/(\d+)(?!.*\d)/);
  return m ? m[1] : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  return res.json();
}

export async function fetchFinalsForLeague(date, league) {
  const url = `${SCOREBOARD_CONFIG[league]}?dates=${ymdToEspnDate(date)}`;
  const json = await fetchJson(url);

  const map = new Map();

  for (const e of json?.events || []) {
    const comp = e?.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === "home");
    const away = comp?.competitors?.find(c => c.homeAway === "away");

    if (!home || !away) continue;

    const status = String(comp?.status?.type?.name || "").toLowerCase();
    if (!status.includes("final")) continue;

    map.set(String(e.id), {
      homeScore: toNum(home.score),
      awayScore: toNum(away.score)
    });
  }

  return map;
}

/* --- CLV CALCULATION --- */

function calcClvLine(publish, close, market, pick) {
  if (!Number.isFinite(publish) || !Number.isFinite(close)) return null;

  if (market === "spread" || market === "total") {
    if (pick === "over" || pick === "away" || pick === "home") {
      return close - publish;
    }
    if (pick === "under") {
      return publish - close;
    }
  }

  return null;
}

function calcClvOdds(publishOdds, closeOdds) {
  if (!publishOdds || !closeOdds) return null;
  return closeOdds - publishOdds;
}

/* --- GRADING --- */

function grade(row, home, away) {
  const market = row.market;
  const pick = row.pick.toLowerCase();
  const line = toNum(row.market_line ?? row.publish_line);

  if (market === "moneyline") {
    if (home === away) return "push";
    if (pick === "home") return home > away ? "win" : "loss";
    if (pick === "away") return away > home ? "win" : "loss";
  }

  if (market === "spread") {
    const diff = home - away;
    const val = pick === "home" ? diff + line : -diff + line;
    if (val > 0) return "win";
    if (val < 0) return "loss";
    return "push";
  }

  if (market === "total") {
    const total = home + away;
    if (pick === "over") {
      if (total > line) return "win";
      if (total < line) return "loss";
      return "push";
    }
    if (pick === "under") {
      if (total < line) return "win";
      if (total > line) return "loss";
      return "push";
    }
  }

  return null;
}

/* --- MAIN --- */

export function settleRows(rows, finalsMap) {
  const updates = [];

  for (const row of rows) {
    if (row.pick === "PASS") continue;

    const id = extractEventId(row.game_key);
    const final = finalsMap.get(id);
    if (!final) continue;

    const result = grade(row, final.homeScore, final.awayScore);
    if (!result) continue;

    const clv_line = calcClvLine(
      toNum(row.publish_line),
      toNum(row.close_line),
      row.market,
      row.pick
    );

    const clv_odds = calcClvOdds(
      toNum(row.publish_odds),
      toNum(row.close_odds)
    );

    updates.push({
      ...row,
      result,
      clv_line_delta: clv_line,
      clv_implied_delta: clv_odds,
      graded_at: new Date().toISOString()
    });
  }

  return updates;
}
