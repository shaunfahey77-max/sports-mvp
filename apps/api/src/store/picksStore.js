// apps/api/src/store/picksStore.js
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "picks.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) fs.writeFileSync(FILE_PATH, JSON.stringify({ picks: [] }, null, 2));
}

function readAll() {
  ensure();
  const raw = fs.readFileSync(FILE_PATH, "utf-8");
  const parsed = JSON.parse(raw || "{}");
  return Array.isArray(parsed.picks) ? parsed.picks : [];
}

function writeAll(picks) {
  ensure();
  // Atomic-ish write to reduce corruption risk
  const tmp = FILE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ picks }, null, 2));
  fs.renameSync(tmp, FILE_PATH);
}

export function listPicks({ league, date, days } = {}) {
  let picks = readAll();

  if (league) picks = picks.filter((p) => String(p.league).toLowerCase() === String(league).toLowerCase());
  if (date) picks = picks.filter((p) => p.date === date);

  if (Number.isFinite(days) && days > 0) {
    // Keep last N days by date string (YYYY-MM-DD)
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    picks = picks.filter((p) => {
      const d = new Date(p.date + "T00:00:00Z");
      return d >= cutoff;
    });
  }

  // newest first
  picks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return picks;
}

export function upsertPicks(newPicks) {
  const picks = readAll();
  const byKey = new Map(picks.map((p) => [`${p.league}:${p.gameId}:${p.date}`, p]));

  for (const p of newPicks) {
    const key = `${p.league}:${p.gameId}:${p.date}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, ...p, updatedAt: new Date().toISOString() });
    } else {
      byKey.set(key, { ...p, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
  }

  const merged = Array.from(byKey.values());
  writeAll(merged);
  return merged;
}

export function updatePick(league, gameId, date, patch) {
  const picks = readAll();
  const idx = picks.findIndex((p) => p.league === league && p.gameId === gameId && p.date === date);
  if (idx === -1) return null;
  picks[idx] = { ...picks[idx], ...patch, updatedAt: new Date().toISOString() };
  writeAll(picks);
  return picks[idx];
}

export function clearPicks() {
  writeAll([]);
  return true;
}
