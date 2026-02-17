// apps/api/src/lib/odds.js

const ODDS = new Map();

export function americanToImpliedProb(ml) {
  const x = Number(ml);
  if (!Number.isFinite(x) || x === 0) return null;
  if (x < 0) return Math.abs(x) / (Math.abs(x) + 100);
  return 100 / (x + 100);
}

export function getOdds({ date, gameId }) {
  return ODDS.get(`${date}:${gameId}`) || null;
}

export function upsertOdds({ date, gameId, homeML, awayML, book = "manual" }) {
  const row = {
    date,
    gameId,
    homeML: Number(homeML),
    awayML: Number(awayML),
    book: String(book || "manual"),
    updatedAt: new Date().toISOString(),
  };
  ODDS.set(`${date}:${gameId}`, row);
  return row;
}

export function listOddsByDate(date) {
  const out = [];
  for (const v of ODDS.values()) {
    if (v.date === date) out.push(v);
  }
  return out;
}
