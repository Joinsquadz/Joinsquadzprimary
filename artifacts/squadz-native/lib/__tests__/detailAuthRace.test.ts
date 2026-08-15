import { describe, it, expect } from "vitest";
import {
  MAX_AUTH_RETRIES,
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  vaultRenderMode,
  type AuthRaceState,
  type VaultFetchOutcome,
} from "../vaultAuthRace";

// ---------------------------------------------------------------------------
// The detail screens (conversation chat, squad, event, trip) reuse the SAME
// pure auth-race guard as the photo vault + list screens (lib/vaultAuthRace.ts).
// These tests lock in the regression across those screens: a pre-auth 401 on a
// cold start / deep-link / push-tap (token not yet restored) must keep the
// detail screen in a loading state, never flash a false empty / not-found /
// error state ("No messages yet" / "Squad not found" / "Event not found" /
// "This trip isn't available").
//
// `photoCount` in the shared helper is just "does the screen have its data" —
// here it stands in for messages.length (conversation) or 1-if-the-record-loaded
// / 0-if-not (squad / event / trip detail, which either have the object or not).
// ---------------------------------------------------------------------------

/**
 * Drive the full fetch/retry/render loop a detail screen runs: apply a fetch
 * outcome, let the retry driver react (give up into an error once the cap is
 * hit), then compute the render mode the user would see. Mirrors runListSequence
 * from listAuthRace.test.ts but named for a single record's presence.
 */
function runDetailSequence(
  steps: { outcome: VaultFetchOutcome; hasRecord: boolean; loading?: boolean }[],
) {
  let state: AuthRaceState = INITIAL_AUTH_RACE_STATE;
  const modes: string[] = [];
  for (const step of steps) {
    state = applyVaultFetchOutcome(state, step.outcome);
    const decision = nextRetryDecision(state);
    if (decision.action === "give-up") state = decision.next;
    modes.push(
      vaultRenderMode({
        loading: step.loading ?? false,
        authPending: state.authPending,
        authError: state.authError,
        photoCount: step.hasRecord ? 1 : 0,
      }),
    );
  }
  return modes;
}

describe("Conversation chat — slow-login auth race", () => {
  it("401 (token not restored) then 200 with messages: loading → content, never empty", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with messages still never flashes 'No messages yet'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine-empty: a single authenticated 200 with zero messages DOES show empty", () => {
    expect(runDetailSequence([{ outcome: { kind: "ok" }, hasRecord: false }])).toEqual(["empty"]);
  });

  it("401 then a 200 with zero messages self-heals to the genuine empty state", () => {
    expect(
      runDetailSequence([
        { outcome: { kind: "unauthorized" }, hasRecord: false },
        { outcome: { kind: "ok" }, hasRecord: false },
      ]),
    ).toEqual(["loading", "empty"]);
  });

  it("exhausting retries surfaces the retryable error, never the empty state", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      hasRecord: false,
    }));
    const modes = runDetailSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

describe("Squad detail — slow-login auth race", () => {
  it("401 (token not restored) then 200 with the squad: loading → content, never 'Squad not found'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with the squad never flashes 'Squad not found'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine not-found: a single authenticated 200 that lacks the squad DOES show empty", () => {
    expect(runDetailSequence([{ outcome: { kind: "ok" }, hasRecord: false }])).toEqual(["empty"]);
  });

  it("exhausting retries surfaces the retryable error, never a false 'Squad not found'", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      hasRecord: false,
    }));
    const modes = runDetailSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

describe("Event detail — slow-login auth race", () => {
  it("401 (token not restored) then 200 with the event: loading → content, never 'Event not found'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with the event never flashes 'Event not found'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine not-found: a single authenticated 200 that lacks the event DOES show empty", () => {
    expect(runDetailSequence([{ outcome: { kind: "ok" }, hasRecord: false }])).toEqual(["empty"]);
  });

  it("exhausting retries surfaces the retryable error, never a false 'Event not found'", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      hasRecord: false,
    }));
    const modes = runDetailSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

describe("Trip detail (fallback fetch) — slow-login auth race", () => {
  it("401 (token not restored) then 200 with the trip: loading → content, never 'not available'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with the trip never flashes 'This trip isn't available'", () => {
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("a non-401 failure while a race is pending keeps retrying, not a false empty", () => {
    // A transient 500 mid-race must not strand the user on the not-available
    // screen — it only advances the retry counter while pending.
    const modes = runDetailSequence([
      { outcome: { kind: "unauthorized" }, hasRecord: false },
      { outcome: { kind: "failure" }, hasRecord: false },
      { outcome: { kind: "ok" }, hasRecord: true },
    ]);
    expect(modes).toEqual(["loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine not-found: a single authenticated 200 that lacks the trip DOES show empty", () => {
    expect(runDetailSequence([{ outcome: { kind: "ok" }, hasRecord: false }])).toEqual(["empty"]);
  });

  it("exhausting retries surfaces the retryable error, never a false 'not available'", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      hasRecord: false,
    }));
    const modes = runDetailSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

// ---------------------------------------------------------------------------
// Denied (403/404) — an AUTHENTICATED "you can't see this". Unlike a 401 this
// can never resolve by retrying, so it must surface immediately.
//
// Regression: a user tapping an event-invite push before accepting the invite
// has no plan access yet, so /api/events/:id answers 403. `failure` is a no-op
// outside a pending race, so the screen sat on a spinner forever ("blank page
// with a loading circle that never loads").
// ---------------------------------------------------------------------------
describe("Plan detail — denied (403/404) response", () => {
  it("a 403 on the very first fetch resolves to the error state, never a permanent spinner", () => {
    const state = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "denied" });
    expect(state.authPending).toBe(false);
    expect(state.authError).toBe(true);
    expect(
      vaultRenderMode({
        loading: false,
        authPending: state.authPending,
        authError: state.authError,
        photoCount: 0,
      }),
    ).toBe("error");
  });

  it("a denied response stops the retry loop instead of scheduling more attempts", () => {
    const state = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "denied" });
    expect(nextRetryDecision(state).action).toBe("idle");
  });

  it("a 403 arriving mid auth-race also ends the race in the error state", () => {
    let state = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "unauthorized" });
    expect(state.authPending).toBe(true);
    state = applyVaultFetchOutcome(state, { kind: "denied" });
    expect(state.authPending).toBe(false);
    expect(state.authError).toBe(true);
  });

  it("distinguishes denied from a transient failure: only denied resolves immediately", () => {
    // A transient network failure outside a race stays a no-op (the screen keeps
    // whatever it has); a denied answer is terminal.
    const afterFailure = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "failure" });
    expect(afterFailure).toEqual(INITIAL_AUTH_RACE_STATE);
    const afterDenied = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "denied" });
    expect(afterDenied.authError).toBe(true);
  });

  it("a manual retry after a denied response can still recover (invite since accepted)", () => {
    const denied = applyVaultFetchOutcome(INITIAL_AUTH_RACE_STATE, { kind: "denied" });
    const recovered = applyVaultFetchOutcome(denied, { kind: "ok" });
    expect(recovered).toEqual({ authPending: false, authError: false, tick: 0 });
  });
});
