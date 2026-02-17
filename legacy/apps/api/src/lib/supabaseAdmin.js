import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Missing SUPABASE_URL in apps/api/.env");
if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in apps/api/.env");

// Service-role client (server-side only). Do NOT expose this key to the browser.
export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false },
});
