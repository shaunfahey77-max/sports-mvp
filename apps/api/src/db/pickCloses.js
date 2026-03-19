import { supabase } from "./dailyLedger.js";

function chunkArray(items, size = 200) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function upsertPickClosesBatch(rows, { chunkSize = 200 } = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!safeRows.length) return { ok: true, written: 0 };

  let written = 0;

  for (const chunk of chunkArray(safeRows, chunkSize)) {
    const nowIso = new Date().toISOString();
    const payload = chunk.map((row) => ({
      ...row,
      updated_at: nowIso,
    }));

    const { error } = await supabase
      .from("pick_closes")
      .upsert(payload, {
        onConflict: "date,league,game_key,market,pick",
      });

    if (error) {
      throw new Error(`pick_closes upsert failed: ${error.message}`);
    }

    written += payload.length;
  }

  return { ok: true, written };
}

export async function getPickClosesForDate(date, league) {
  let query = supabase
    .from("pick_closes")
    .select("*")
    .eq("date", date);

  if (league) {
    query = query.eq("league", league);
  }

  const { data, error } = await query.order("league", { ascending: true });

  if (error) {
    throw new Error(`pick_closes fetch failed: ${error.message}`);
  }

  return data || [];
}
