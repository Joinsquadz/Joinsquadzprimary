// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted state ─────────────────────────────────────────────────────────────
// The focus-effect callback and its returned cleanup are captured here so each
// test can manually trigger focus / blur at the right time.

const focusState = vi.hoisted(() => ({
  callback: null as null | (() => (() => void) | void),
  cleanup: null as null | (() => void),
}));

const appStateHandlers = vi.hoisted(
  () => new Set<(state: string) => void>()
);

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("expo-router", () => ({
  useFocusEffect: (cb: () => (() => void) | void) => {
    focusState.callback = cb;
  },
}));

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appStateHandlers.add(handler);
      return { remove: () => appStateHandlers.delete(handler) };
    },
  },
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "https://api.test",
  buildAuthHeaders: (token: string | null) =>
    token ? { Authorization: `Bearer ${token}` } : {},
}));

import { useSquadStream } from "../useSquadStream";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate the screen coming into focus (runs the focus-effect callback). */
async function simulateFocus(): Promise<void> {
  await act(async () => {
    const cleanup = focusState.callback?.();
    focusState.cleanup = cleanup ?? null;
  });
}

/** Simulate the screen losing focus (calls the cleanup returned by the focus effect). */
async function simulateBlur(): Promise<void> {
  await act(async () => {
    focusState.cleanup?.();
    focusState.cleanup = null;
  });
}

/**
 * Build a minimal SSE response whose body stream closes immediately (simulates
 * a clean server-side close / reconnect trigger after a successful connection).
 */
function makeStreamResponse(): { ok: boolean; body: ReadableStream<Uint8Array> } {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return { ok: true, body };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("useSquadStream — auto-reconnect with exponential backoff", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  const defaultOpts = {
    squadId: "squad-abc",
    authToken: "test-token",
    onUpdate: vi.fn(),
  };

  beforeEach(() => {
    focusState.callback = null;
    focusState.cleanup = null;
    appStateHandlers.clear();

    vi.useFakeTimers();
    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Helper: extract the delay values passed to setTimeout ──────────────────
  function scheduledDelays(): number[] {
    return setTimeoutSpy.mock.calls
      .map((c: unknown[]) => c[1])
      .filter((d: unknown): d is number => typeof d === "number");
  }

  // ── Backoff progression ───────────────────────────────────────────────────

  it("schedules a 1 s retry after the first network error (non-AbortError)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useSquadStream(defaultOpts));
    await simulateFocus();

    // The first fetch has already failed; a 1 s retry should be pending.
    expect(scheduledDelays()).toContain(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doubles the delay on each consecutive failure (1 s → 2 s → 4 s)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useSquadStream(defaultOpts));
    await simulateFocus();

    // Failure 1 → 1 s retry scheduled.
    expect(scheduledDelays()).toContain(1000);

    // Advance past the 1 s timer → triggers the second connect attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    // Failure 2 → 2 s retry scheduled.
    expect(scheduledDelays()).toContain(2000);

    // Advance past the 2 s timer → triggers the third connect attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    // Failure 3 → 4 s retry scheduled.
    expect(scheduledDelays()).toContain(4000);

    // Three separate fetch attempts should have been made.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resets the backoff delay to 1 s after a successful reconnect", async () => {
    // First two attempts fail, third succeeds (stream connects then closes cleanly
    // which triggers a new scheduleRetry with the now-reset 1 s delay).
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(makeStreamResponse());

    renderHook(() => useSquadStream(defaultOpts));
    await simulateFocus();

    // Failure 1 → 1 s.
    expect(scheduledDelays()).toContain(1000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    // Failure 2 → 2 s.
    expect(scheduledDelays()).toContain(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    // Third attempt succeeds; stream closes immediately, triggering another
    // scheduleRetry. Because retryDelayRef was reset on success, the new delay
    // must be 1 s again — NOT 4 s.
    const delays = scheduledDelays();
    const lastDelay = delays[delays.length - 1];
    expect(lastDelay).toBe(1000);
  });

  it("reports 'connected' status while the stream is alive", async () => {
    // Return a stream that stays open (never closes during this test).
    const openStreamController: ReadableStreamDefaultController<Uint8Array>[] = [];
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          openStreamController.push(controller);
        },
      }),
    });

    const { result } = renderHook(() => useSquadStream(defaultOpts));

    expect(result.current.status).toBe("reconnecting");

    await simulateFocus();

    expect(result.current.status).toBe("connected");
  });

  // ── Blur path ─────────────────────────────────────────────────────────────

  it("cancels a scheduled retry when the screen loses focus (blur)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useSquadStream(defaultOpts));
    await simulateFocus();

    // One 1 s retry should be pending.
    expect(scheduledDelays()).toContain(1000);
    const callsBeforeBlur = fetchMock.mock.calls.length;

    // Blur → the pending timer must be cancelled.
    await simulateBlur();

    // Advance well past the retry window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // No additional fetch calls should have occurred.
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeBlur);
  });

  it("does not schedule a retry when the screen is blurred before the fetch error resolves", async () => {
    // The fetch is pending (never resolves) — we blur before it completes.
    let rejectFetch!: (err: Error) => void;
    fetchMock.mockReturnValue(
      new Promise<never>((_, reject) => {
        rejectFetch = reject;
      })
    );

    renderHook(() => useSquadStream(defaultOpts));
    await simulateFocus();

    // Blur before the in-flight fetch finishes.
    await simulateBlur();

    // Now let the fetch fail.
    await act(async () => {
      rejectFetch(new TypeError("Failed to fetch"));
      await vi.runAllTicks();
    });

    // scheduleRetry checks controller.signal.aborted (set by blur's abort()) and
    // focusedRef.current (set to false by blur) before scheduling — no timer.
    expect(scheduledDelays()).toHaveLength(0);
  });
});
