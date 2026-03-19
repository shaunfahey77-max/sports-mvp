import { supabaseAdmin } from "../supabaseClient.js";

export async function insertRecommendedPick(row) {
  const { data, error } = await supabaseAdmin
    .from("recommended_picks")
    .insert([row])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getRecommendedPicks(date, league) {
  const { data, error } = await supabaseAdmin
    .from("recommended_picks")
    .select("*")
    .eq("game_date", date)
    .eq("league", league);

  if (error) throw error;
  return data;
}
