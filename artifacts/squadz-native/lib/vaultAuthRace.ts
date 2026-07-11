// Auth-race state machine for the photo vault.
//
// A vault fetch that 401s because the auth token hasn't finished restoring yet
// (cold start / deep-link entry / token-refresh race) must NOT collapse the
// screen to the "No photos rolled up yet" empty state — that falsely claims the
// vault is empty during a slow login. Instead the screen stays in a loading
// state and the fetch is retried on a short cadence until an authenticated
// fetch succeeds (or the retries are exhausted and a retryable error surfaces).
//
// The decision logic lives here as pure functions so it can be unit-tested in
// isolation and shared by the vault screen's fetch drivers, retry effects, and
// render branches (keeping them from drifting apart).

// Retry policy: when a vault fetch 401s, retry on this cadence up to this many
// times before surfacing a retryable error (instead of a false "empty vault").
export const AUTH_RETRY_DELAY_MS = 600;
export const MAX_AUTH_RETRIES = 8;

// The auth-race bookkeeping for a single vault dataset (personal or squad).
export type AuthRaceState = {
  // A fetch has 401'd and we're waiting for the token to restore. While true the
  // screen shows a spinner/skeleton, never the empty state.
  authPending: boolean;
  // Retries were exhausted — a genuine failure to load, distinct from empty.
  authError: boolean;
  // How many auth-race attempts have been made in the current loop.
  tick: number;
};

export const INITIAL_AUTH_RACE_STATE: AuthRaceState = {
  authPending: false,
  authError: false,
  tick: 0,
};

// The relevant outcome of a single vault fetch attempt.
export type VaultFetchOutcome =
  // HTTP 401 — token not restored yet; treat as "still loading" and retry.
  | { kind: "unauthorized" }
  // HTTP 200 — authenticated response arrived (may contain zero photos).
  | { kind: "ok" }
  // Non-401 !ok response OR a thrown network error.
  | { kind: "failure" };

// Reduce the auth-race state given a fetch outcome. This is the core guard: a
// 401 keeps us pending (loading), a success clears the race, and a transient
// failure only advances the retry counter while a race is already in flight
// (so a blip doesn't strand us on a permanent spinner) — never starting one.
export function applyVaultFetchOutcome(
  prev: AuthRaceState,
  outcome: VaultFetchOutcome,
): AuthRaceState {
  switch (outcome.kind) {
    case "unauthorized":
      return { authPending: true, authError: false, tick: prev.tick + 1 };
    case "ok":
      return { authPending: false, authError: false, tick: 0 };
    case "failure":
      return prev.authPending ? { ...prev, tick: prev.tick + 1 } : prev;
  }
}

// What the retry driver should do next given the current auth-race state.
export type RetryDecision =
  | { action: "retry"; delayMs: number }
  | { action: "give-up"; next: AuthRaceState }
  | { action: "idle" };

// Decide the next retry step. Only acts while a race is pending: schedules
// another attempt until the cap is hit, then gives up into a retryable error
// (which surfaces the retry UI instead of the false empty state).
export function nextRetryDecision(state: AuthRaceState): RetryDecision {
  if (!state.authPending) return { action: "idle" };
  if (state.tick >= MAX_AUTH_RETRIES) {
    return {
      action: "give-up",
      next: { authPending: false, authError: true, tick: state.tick },
    };
  }
  return { action: "retry", delayMs: AUTH_RETRY_DELAY_MS };
}

// Reset the auth-race state for a manual retry (clears the error and counter so
// a fresh fetch can re-arm the loop if it 401s again).
export function resetAuthRaceState(): AuthRaceState {
  return { ...INITIAL_AUTH_RACE_STATE };
}

// What the vault should render for a given dataset.
export type VaultRenderMode = "loading" | "error" | "empty" | "content";

// Decide the render mode from the current state. This is the single point that
// prevents a false-empty screen: while loading OR mid auth-race we return
// "loading", so the empty state is only ever reached for a genuine,
// authenticated, zero-photo response.
export function vaultRenderMode(args: {
  loading: boolean;
  authPending: boolean;
  authError: boolean;
  photoCount: number;
}): VaultRenderMode {
  if (args.loading || args.authPending) return "loading";
  if (args.authError) return "error";
  if (args.photoCount === 0) return "empty";
  return "content";
}
