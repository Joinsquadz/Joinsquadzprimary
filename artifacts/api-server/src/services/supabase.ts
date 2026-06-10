import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";

function jwtRoleClaim(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return typeof payload.role === "string" ? payload.role : "<no-role-claim>";
  } catch {
    return "<not-a-jwt>";
  }
}

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function init(): { admin: SupabaseClient; auth: SupabaseClient } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Safe diagnostic (no secret logged): confirm the loaded key is genuinely the
  // service_role key. A non-service_role key (e.g. anon) cannot bypass Storage RLS,
  // which surfaces as "new row violates row-level security policy" on bucket/object writes.
  const role = jwtRoleClaim(key);
  if (role !== "service_role") {
    logger.error(
      { role, keyLength: key.length },
      "[supabase] SUPABASE_SERVICE_ROLE_KEY is NOT a service_role key — Storage writes will be RLS-denied",
    );
  } else {
    logger.info({ role, keyLength: key.length }, "[supabase] admin client initialized with service_role key");
  }
  // Two SEPARATE client instances on purpose. supabase-js keeps a signed-in
  // user's session IN MEMORY on the client (even with persistSession:false),
  // and the Storage sub-client then sends THAT user's JWT instead of the
  // service_role key — so service operations get RLS-denied. By isolating the
  // user-auth flows (signInWithPassword / refreshSession) on `supabaseAuth`,
  // the `supabaseAdmin` client stays pristine and always acts as service_role.
  return { admin: newClient(url, key), auth: newClient(url, key) };
}

const clients = init();

/**
 * Supabase admin client — service_role for Storage and admin.* operations.
 * MUST stay pristine: never call session-setting auth methods
 * (signInWithPassword, refreshSession, setSession) on it, or it will start
 * sending a user JWT and Storage writes will be RLS-denied. Use `supabaseAuth`
 * for those. Available only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 * set; callers must null-check before use.
 */
export const supabaseAdmin: SupabaseClient | null = clients?.admin ?? null;

/**
 * Dedicated client for user-auth flows that mutate the in-memory session
 * (signInWithPassword, refreshSession). Kept separate from `supabaseAdmin` so
 * those sessions never contaminate Storage/admin requests.
 */
export const supabaseAuth: SupabaseClient | null = clients?.auth ?? null;

export const supabaseConfigured = supabaseAdmin !== null;
