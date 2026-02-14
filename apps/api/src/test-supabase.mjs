import { supabaseAdmin } from "./lib/supabaseAdmin.js";

const { data, error } = await supabaseAdmin
  .from("performance_daily")
  .select("*")
  .limit(1);

if (error) {
  console.error("❌ Supabase error:", error.message);
} else {
  console.log("✅ Supabase connected successfully");
  console.log("Rows:", data);
}
