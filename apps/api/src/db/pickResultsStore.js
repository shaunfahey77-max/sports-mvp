import { supabaseAdmin } from "../supabaseClient.js";

export async function insertPickResult(row) {
  const { error } = await supabaseAdmin
    .from("pick_results")
    .insert([row]);

  if (error) throw error;
}

export async function getPickResults(date, league) {
  const { data, error } = await supabaseAdmin
    .from("pick_results")
    .select("*")
    .eq("game_date", date)
    .eq("league", league);

  if (error) throw error;
  return data;
}
