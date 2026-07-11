import { describe, it, expect } from "vitest";
import {
  AUTH_RETRY_DELAY_MS,
  MAX_AUTH_RETRIES,
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  vaultRenderMode,
  type AuthRaceState,
  type VaultFetchOutcome,
} from "../vaultAuthRace";

// ---------------------------------------------------------------------------
// vaultRenderMode — the single guard that prevents a false-empty screen.
// ---------------------------------------------------------------------------

describe("vaultRenderMode", () => {
  it("is 'loading' on the very first fetch (loading, nothing else)", () => {
    expect(
      vaultRenderMode({ loading: true, authPending: false, authError: false, photoCount: 0 }),
    ).toBe("loading");
  });

  it("is 'loading' — NOT 'empty' — while an auth race is pending with zero photos", () => {
    // The regression: a pre-auth 401 must keep the screen loading, never flash
    // "No photos rolled up yet".
    expect(
      vaultRenderMode({ loading: false, authPending: true, authError: false, photoCount: 0 }),
    ).toBe("loading");
  });

  it("loading/authPending take precedence over authError and photoCount", () => {
    expect(
      vaultRenderMode({ loading: true, authPending: false, authError: true, photoCount: 5 }),
    ).toBe("loading");
    expect(
      vaultRenderMode({ loading: false, authPending: true, authError: true, photoCount: 5 }),
    ).toBe("loading");
  });

  it("is 'error' when retries are exhausted (authError) and not loading", () => {
    expect(
      vaultRenderMode({ loading: false, authPending: false, authError: true, photoCount: 0 }),
    ).toBe("error");
  });

  it("is 'empty' ONLY for a genuine authenticated zero-photo response", () => {
    expect(
      vaultRenderMode({ loading: false, authPending: false, authError: false, photoCount: 0 }),
    ).toBe("empty");
  });

  it("is 'content' once photos are present", () => {
    expect(
      vaultRenderMode({ loading: false, authPending: false, authError: false, photoCount: 3 }),
    ).toBe("content");
  });
});

// ---------------------------------------------------------------------------
// applyVaultFetchOutcome — fetch-outcome state machine.
// ---------------------------------------------------------------------------

describe("applyVaultFetchOutcome", () => {
  it("a 401 marks the race pending and advances the tick", () => {
    const next = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "unauthorized" });
    expect(next).toEqual({ authPending: true, authError: false, tick: 1 });
  });

  it("consecutive 401s keep advancing the tick while staying pending", () => {
    let s: AuthRaceState = INITIAL_AUTH_RACE_STATE;
    s = applyVaultFetchOutcome(s, { kind: "unauthorized" });
    s = applyVaultFetchOutcome(s, { kind: "unauthorized" });
    s = applyVaultFetchOutcome(s, { kind: "unauthorized" });
    expect(s).toEqual({ authPending: true, authError: false, tick: 3 });
  });

  it("an authenticated 200 clears the race entirely", () => {
    const pending: AuthRaceState = { authPending: true, authError: false, tick: 4 };
    expect(applyVaultFetchOutcome(pending, { kind: "ok" })).toEqual(INITIAL_AUTH_RACE_STATE);
  });

  it("a failure while pending advances the tick (keeps the bounded loop alive)", () => {
    const pending: AuthRaceState = { authPending: true, authError: false, tick: 2 };
    expect(applyVaultFetchOutcome(pending, { kind: "failure" })).toEqual({
      authPending: true,
      authError: false,
      tick: 3,
    });
  });

  it("a failure while NOT pending is a no-op (never starts a race on its own)", () => {
    const idle = INITIAL_AUTH_RACE_STATE;
    expect(applyVaultFetchOutcome(idle, { kind: "failure" })).toBe(idle);
  });
});

// ---------------------------------------------------------------------------
// nextRetryDecision — retry driver.
// ---------------------------------------------------------------------------

describe("nextRetryDecision", () => {
  it("is idle when no race is pending", () => {
    expect(nextRetryDecision(INITIAL_AUTH_RACE_STATE)).toEqual({ action: "idle" });
  });

  it("schedules a retry while pending and under the cap", () => {
    expect(nextRetryDecision({ authPending: true, authError: false, tick: 1 })).toEqual({
      action: "retry",
      delayMs: AUTH_RETRY_DELAY_MS,
    });
  });

  it("gives up into a retryable error once the cap is reached", () => {
    const decision = nextRetryDecision({ authPending: true, authError: false, tick: MAX_AUTH_RETRIES });
    expect(decision).toEqual({
      action: "give-up",
      next: { authPending: false, authError: true, tick: MAX_AUTH_RETRIES },
    });
  });
});

describe("resetAuthRaceState", () => {
  it("returns a fresh, cleared state (for a manual retry)", () => {
    expect(resetAuthRaceState()).toEqual(INITIAL_AUTH_RACE_STATE);
  });
});

// ---------------------------------------------------------------------------
// End-to-end sequences — the behavior the task asks us to lock in.
// ---------------------------------------------------------------------------

/**
 * Drive the full fetch/retry/render loop the way the vault screen does: apply a
 * fetch outcome, then let the retry driver decide what happens next (retrying
 * fires another fetch, giving up flips into the error state). Returns the render
 * mode the screen would show after each step so we can assert what the user sees.
 */
function runVaultSequence(steps: { outcome: VaultFetchOutcome; photoCount: number; loading?: boolean }[]) {
  let state: AuthRaceState = INITIAL_AUTH_RACE_STATE;
  const modes: string[] = [];
  for (const step of steps) {
    state = applyVaultFetchOutcome(state, step.outcome);
    // After a fetch resolves, the loading flag is cleared (finally block); the
    // retry driver then reacts to the new auth-race state.
    const decision = nextRetryDecision(state);
    if (decision.action === "give-up") state = decision.next;
    modes.push(
      vaultRenderMode({
        loading: step.loading ?? false,
        authPending: state.authPending,
        authError: state.authError,
        photoCount: step.photoCount,
      }),
    );
  }
  return modes;
}

describe("vault slow-login sequences", () => {
  it("401 (token not restored) then 200 with photos: loading → content, never empty", () => {
    const modes = runVaultSequence([
      { outcome: { kind: "unauthorized" }, photoCount: 0 },
      { outcome: { kind: "ok" }, photoCount: 3 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with photos still never flashes empty", () => {
    const modes = runVaultSequence([
      { outcome: { kind: "unauthorized" }, photoCount: 0 },
      { outcome: { kind: "unauthorized" }, photoCount: 0 },
      { outcome: { kind: "unauthorized" }, photoCount: 0 },
      { outcome: { kind: "ok" }, photoCount: 5 },
    ]);
    expect(modes).toEqual(["loading", "loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine-empty: a single authenticated 200 with zero photos DOES show empty", () => {
    const modes = runVaultSequence([{ outcome: { kind: "ok" }, photoCount: 0 }]);
    expect(modes).toEqual(["empty"]);
  });

  it("401 then a 200 with zero photos self-heals to the genuine empty state", () => {
    const modes = runVaultSequence([
      { outcome: { kind: "unauthorized" }, photoCount: 0 },
      { outcome: { kind: "ok" }, photoCount: 0 },
    ]);
    expect(modes).toEqual(["loading", "empty"]);
  });

  it("exhausting retries surfaces the retryable error, never the empty state", () => {
    // Simulate the token never arriving: keep 401-ing past the cap. The retry
    // driver flips to the error state once tick reaches MAX_AUTH_RETRIES.
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      photoCount: 0,
    }));
    const modes = runVaultSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});
