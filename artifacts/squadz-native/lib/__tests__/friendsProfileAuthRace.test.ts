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
// The Friends screen and the Profile ("You") screen fetch on mount, so a
// pre-auth 401 on a slow login / cold start would briefly flash an empty state
// ("No friends yet" / a misleading 0 events) before the token restores.
//
// Both now reuse the SAME pure auth-race guard as the photo vault + list
// screens (lib/vaultAuthRace.ts). These tests lock in the regression with the
// same 401 -> 200 sequence pattern as listAuthRace.test.ts.
//
// `photoCount` in the shared helper is just "how many items the screen has" —
// here it stands in for the friends count (Friends screen) or the event count
// (Profile screen).
// ---------------------------------------------------------------------------

function runSequence(
  steps: { outcome: VaultFetchOutcome; itemCount: number; loading?: boolean }[],
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
        photoCount: step.itemCount,
      }),
    );
  }
  return modes;
}

describe("Friends screen — slow-login auth race", () => {
  it("401 (token not restored) then 200 with friends: loading → content, never empty", () => {
    const modes = runSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 5 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with friends still never flashes 'No friends yet'", () => {
    const modes = runSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 2 },
    ]);
    expect(modes).toEqual(["loading", "loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine-empty: a single authenticated 200 with zero friends DOES show empty", () => {
    expect(runSequence([{ outcome: { kind: "ok" }, itemCount: 0 }])).toEqual(["empty"]);
  });

  it("401 then a 200 with zero friends self-heals to the genuine empty state", () => {
    expect(
      runSequence([
        { outcome: { kind: "unauthorized" }, itemCount: 0 },
        { outcome: { kind: "ok" }, itemCount: 0 },
      ]),
    ).toEqual(["loading", "empty"]);
  });

  it("exhausting retries surfaces the retryable error, never the empty state", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      itemCount: 0,
    }));
    const modes = runSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

describe("Profile screen — event-count slow-login auth race", () => {
  // The profile derives its Events / Status stats from `countReady`, i.e. the
  // count is only authoritative once vaultRenderMode is "content" or "empty".
  // While loading or mid auth-race it stays neutral (not ready) instead of
  // flashing a misleading "0" / "New".
  const ready = (mode: string) => mode === "content" || mode === "empty";

  it("401 then 200 with events: stat stays not-ready then becomes ready, never a false-0", () => {
    const modes = runSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 4 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes.map(ready)).toEqual([false, true]);
  });

  it("several 401s then a 200 keeps the stat not-ready during the whole race", () => {
    const modes = runSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 1 },
    ]);
    expect(modes.map(ready)).toEqual([false, false, true]);
  });

  it("a genuine authenticated 0-event response IS ready (shows the real zero)", () => {
    const modes = runSequence([{ outcome: { kind: "ok" }, itemCount: 0 }]);
    expect(modes).toEqual(["empty"]);
    expect(ready(modes[0])).toBe(true);
  });

  it("exhausting retries surfaces the error and never becomes falsely ready", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      itemCount: 0,
    }));
    const modes = runSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes.some(ready)).toBe(false);
  });
});
