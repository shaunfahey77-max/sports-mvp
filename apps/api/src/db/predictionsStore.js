import { supabaseAdmin } from "../supabaseClient.js";

export async function insertPrediction(row) {
  const { data, error } = await supabaseAdmin
    .from("predictions")
    .insert([row])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPredictionsByDate(league, date) {
  const { data, error } = await supabaseAdmin
    .from("predictions")
    .select("*")
    .eq("league", league)
    .eq("game_date", date);

  if (error) throw error;
  return data;
}
