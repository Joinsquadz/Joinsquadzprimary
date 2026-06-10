import { describe, it, expect } from "vitest";
import { supabaseAdmin, supabaseAuth } from "../services/supabase";

/**
 * Regression guard for the profile-picture upload bug.
 *
 * supabase-js keeps a signed-in user's session in memory (even with
 * persistSession:false), so the Storage sub-client would send that user's JWT
 * instead of the service_role key after any auth sign-in — causing Storage RLS
 * denials. The fix is to keep the storage/admin client (`supabaseAdmin`) on a
 * SEPARATE instance from the one used for session-setting auth flows
 * (`supabaseAuth`). If these ever collapse back into a single shared instance,
 * a login on the server can silently contaminate avatar uploads again.
 */
describe("supabase client separation", () => {
  it("exposes admin and auth as distinct client instances when configured", () => {
    // Both are gated on the same env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
    // so they are either both present or both null.
    expect(supabaseAdmin === null).toBe(supabaseAuth === null);
    if (supabaseAdmin && supabaseAuth) {
      expect(supabaseAdmin).not.toBe(supabaseAuth);
    }
  });
});
