import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function init(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Supabase admin client — available only when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set. Callers must null-check before use.
 */
export const supabaseAdmin: SupabaseClient | null = init();
export const supabaseConfigured = supabaseAdmin !== null;
