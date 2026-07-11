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
// The Events, SquadZ, and Messages list screens reuse the SAME pure auth-race
// guard as the photo vault (lib/vaultAuthRace.ts). These tests lock in the same
// regression across those screens: a pre-auth 401 on cold start / slow login
// must keep the list in a loading state, never flash a false empty screen
// ("No squads yet" / "No events yet" / "No messages yet").
//
// `photoCount` in the shared helper is just "how many items the screen has" —
// here it stands in for squads / events / conversations.
// ---------------------------------------------------------------------------

/**
 * Drive the full fetch/retry/render loop a single-source list screen (Events,
 * SquadZ) runs: apply a fetch outcome, let the retry driver react, then compute
 * the render mode the user would see. Mirrors runVaultSequence from
 * vaultAuthRace.test.ts but named for item counts instead of photos.
 */
function runListSequence(
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

describe("Events list — slow-login auth race", () => {
  it("401 (token not restored) then 200 with events: loading → content, never empty", () => {
    const modes = runListSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 4 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with events still never flashes 'No events yet'", () => {
    const modes = runListSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 2 },
    ]);
    expect(modes).toEqual(["loading", "loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine-empty: a single authenticated 200 with zero events DOES show empty", () => {
    expect(runListSequence([{ outcome: { kind: "ok" }, itemCount: 0 }])).toEqual(["empty"]);
  });

  it("401 then a 200 with zero events self-heals to the genuine empty state", () => {
    expect(
      runListSequence([
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
    const modes = runListSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

describe("SquadZ list — slow-login auth race", () => {
  it("401 (token not restored) then 200 with squads: loading → content, never empty", () => {
    const modes = runListSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 3 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with squads still never flashes 'No squads yet'", () => {
    const modes = runListSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 5 },
    ]);
    expect(modes).toEqual(["loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine-empty: a single authenticated 200 with zero squads DOES show empty", () => {
    expect(runListSequence([{ outcome: { kind: "ok" }, itemCount: 0 }])).toEqual(["empty"]);
  });

  it("401 then a 200 with zero squads self-heals to the genuine empty state", () => {
    expect(
      runListSequence([
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
    const modes = runListSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});

// ---------------------------------------------------------------------------
// Messages inbox — combined guard across TWO sources.
//
// The inbox unions conversations + event/trip chats. It treats the screen as
// pending/errored only while the combined list is still empty; once EITHER
// source returns rows they are shown. This mirrors messages.tsx:
//   authPending: (eventsAuthPending || conversationsAuthPending) && itemCount === 0
//   authError:   (eventsAuthError   || conversationsAuthError)   && itemCount === 0
// ---------------------------------------------------------------------------

type SourceState = { authPending: boolean; authError: boolean };

function inboxRenderMode(args: {
  loading: boolean;
  events: SourceState;
  conversations: SourceState;
  itemCount: number;
}) {
  const anyPending = args.events.authPending || args.conversations.authPending;
  const anyError = args.events.authError || args.conversations.authError;
  return vaultRenderMode({
    loading: args.loading,
    authPending: anyPending && args.itemCount === 0,
    authError: anyError && args.itemCount === 0,
    photoCount: args.itemCount,
  });
}

/**
 * Drive both inbox sources through the fetch/retry loop in lock-step and record
 * the combined render mode after each step.
 */
function runInboxSequence(
  steps: {
    events: VaultFetchOutcome;
    conversations: VaultFetchOutcome;
    itemCount: number;
    loading?: boolean;
  }[],
) {
  let ev: AuthRaceState = INITIAL_AUTH_RACE_STATE;
  let cv: AuthRaceState = INITIAL_AUTH_RACE_STATE;
  const modes: string[] = [];
  for (const step of steps) {
    ev = applyVaultFetchOutcome(ev, step.events);
    const evDecision = nextRetryDecision(ev);
    if (evDecision.action === "give-up") ev = evDecision.next;

    cv = applyVaultFetchOutcome(cv, step.conversations);
    const cvDecision = nextRetryDecision(cv);
    if (cvDecision.action === "give-up") cv = cvDecision.next;

    modes.push(
      inboxRenderMode({
        loading: step.loading ?? false,
        events: ev,
        conversations: cv,
        itemCount: step.itemCount,
      }),
    );
  }
  return modes;
}

describe("Messages inbox — slow-login auth race", () => {
  it("both sources 401 then 200 with messages: loading → content, never empty", () => {
    const modes = runInboxSequence([
      { events: { kind: "unauthorized" }, conversations: { kind: "unauthorized" }, itemCount: 0 },
      { events: { kind: "ok" }, conversations: { kind: "ok" }, itemCount: 6 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("one source pending while the other returns rows shows content, not loading", () => {
    // Conversations 401 (still racing) but events already returned rows — the
    // user should see the messages that exist, not a spinner or empty screen.
    const modes = runInboxSequence([
      { events: { kind: "ok" }, conversations: { kind: "unauthorized" }, itemCount: 2 },
    ]);
    expect(modes).toEqual(["content"]);
  });

  it("both sources authenticate with zero items DOES show the genuine empty state", () => {
    const modes = runInboxSequence([
      { events: { kind: "ok" }, conversations: { kind: "ok" }, itemCount: 0 },
    ]);
    expect(modes).toEqual(["empty"]);
  });

  it("401 on both then 200 with zero items self-heals to empty", () => {
    const modes = runInboxSequence([
      { events: { kind: "unauthorized" }, conversations: { kind: "unauthorized" }, itemCount: 0 },
      { events: { kind: "ok" }, conversations: { kind: "ok" }, itemCount: 0 },
    ]);
    expect(modes).toEqual(["loading", "empty"]);
  });

  it("both sources exhaust retries with nothing to show surfaces the error state", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      events: { kind: "unauthorized" } as const,
      conversations: { kind: "unauthorized" } as const,
      itemCount: 0,
    }));
    const modes = runInboxSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});
