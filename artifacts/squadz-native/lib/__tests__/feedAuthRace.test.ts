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
// The Vibe feed (app/(tabs)/feed.tsx) fetches on mount, so a pre-auth 401 on a
// slow login / cold start would briefly flash the "No vibes yet" empty state
// before the token restores. It now reuses the SAME pure auth-race guard as the
// photo vault + list screens (lib/vaultAuthRace.ts). These tests lock in the
// regression with the same 401 -> 200 sequence pattern as listAuthRace.test.ts.
//
// `photoCount` in the shared helper is just "how many items the screen has" —
// here it stands in for the number of feed posts.
// ---------------------------------------------------------------------------

function runFeedSequence(
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

describe("Vibe feed — slow-login auth race", () => {
  it("401 (token not restored) then 200 with posts: loading → content, never empty", () => {
    const modes = runFeedSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 4 },
    ]);
    expect(modes).toEqual(["loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("several 401s then a 200 with posts still never flashes 'No vibes yet'", () => {
    const modes = runFeedSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 2 },
    ]);
    expect(modes).toEqual(["loading", "loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("genuine-empty: a single authenticated 200 with zero posts DOES show empty", () => {
    expect(runFeedSequence([{ outcome: { kind: "ok" }, itemCount: 0 }])).toEqual(["empty"]);
  });

  it("401 then a 200 with zero posts self-heals to the genuine empty state", () => {
    expect(
      runFeedSequence([
        { outcome: { kind: "unauthorized" }, itemCount: 0 },
        { outcome: { kind: "ok" }, itemCount: 0 },
      ]),
    ).toEqual(["loading", "empty"]);
  });

  it("a transient non-401 blip mid auth-race keeps loading, never a false empty", () => {
    const modes = runFeedSequence([
      { outcome: { kind: "unauthorized" }, itemCount: 0 },
      { outcome: { kind: "failure" }, itemCount: 0 },
      { outcome: { kind: "ok" }, itemCount: 3 },
    ]);
    expect(modes).toEqual(["loading", "loading", "content"]);
    expect(modes).not.toContain("empty");
  });

  it("exhausting retries surfaces the retryable error, never the empty state", () => {
    const steps = Array.from({ length: MAX_AUTH_RETRIES }, () => ({
      outcome: { kind: "unauthorized" } as const,
      itemCount: 0,
    }));
    const modes = runFeedSequence(steps);
    expect(modes[modes.length - 1]).toBe("error");
    expect(modes).not.toContain("empty");
  });
});
