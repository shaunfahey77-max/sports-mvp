// legacy/apps/api/src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

/**
 * Premium-safe Supabase helper
 * - NEVER crash the API if env is missing
 * - Prefer SERVICE ROLE for server writes
 * - Fall back to ANON for read-only operations if you want
 */

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
).trim();

const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
).trim();

export const hasSupabaseUrl = Boolean(SUPABASE_URL);
export const hasServiceRole = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
export const hasAnon = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Return a Supabase client, or null if not configured.
 * Never throws.
 */
export function getSupabase({ preferServiceRole = true } = {}) {
  try {
    if (!SUPABASE_URL) return null;

    const key = preferServiceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;

    // if preferServiceRole is true but missing, fall back to anon if present
    const finalKey = key || SUPABASE_ANON_KEY;
    if (!finalKey) return null;

    return createClient(SUPABASE_URL, finalKey, {
      auth: { persistSession: false },
    });
  } catch (e) {
    // Never crash app
    console.warn("[supabase] disabled:", String(e?.message || e));
    return null;
  }
}

/**
 * Convenience singleton (safe).
 * - May be null if env missing.
 */
export const supabase = getSupabase({ preferServiceRole: true });
