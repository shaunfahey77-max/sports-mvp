// apps/api/src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || "").trim();

const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !key) {
  // Don't throw at import-time; routes can decide how to behave.
  console.warn(
    "[supabase] Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (preferred) / SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(SUPABASE_URL, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
