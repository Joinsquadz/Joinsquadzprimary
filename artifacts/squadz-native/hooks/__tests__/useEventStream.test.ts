// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted state ─────────────────────────────────────────────────────────────

const focusState = vi.hoisted(() => ({
  callback: null as null | (() => (() => void) | void),
  cleanup: null as null | (() => void),
}));

const appStateHandlers = vi.hoisted(
  () => new Set<(state: string) => void>()
);

const expoFetchState = vi.hoisted(
  () => ({ fn: null as null | ((...args: unknown[]) => unknown) })
);

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => expoFetchState.fn!(...args),
}));

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

import { useEventStream } from "../useEventStream";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function simulateFocus(): Promise<void> {
  await act(async () => {
    const cleanup = focusState.callback?.();
    focusState.cleanup = cleanup ?? null;
  });
}

async function simulateBlur(): Promise<void> {
  await act(async () => {
    focusState.cleanup?.();
    focusState.cleanup = null;
  });
}

function makeStreamResponse(): { ok: boolean; body: ReadableStream<Uint8Array> } {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return { ok: true, body };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("useEventStream — auto-reconnect with exponential backoff", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  const defaultOpts = {
    eventId: "event-abc",
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
    expoFetchState.fn = fetchMock as unknown as (...args: unknown[]) => unknown;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function scheduledDelays(): number[] {
    return setTimeoutSpy.mock.calls
      .map((c: unknown[]) => c[1])
      .filter((d: unknown): d is number => typeof d === "number");
  }

  it("schedules a 1 s retry after the first network error (non-AbortError)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    expect(scheduledDelays()).toContain(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doubles the delay on each consecutive failure (1 s → 2 s → 4 s)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    expect(scheduledDelays()).toContain(1000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(scheduledDelays()).toContain(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    expect(scheduledDelays()).toContain(4000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resets the backoff delay to 1 s after a successful reconnect", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(makeStreamResponse());

    renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    expect(scheduledDelays()).toContain(1000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(scheduledDelays()).toContain(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
    });
    // Stream connected then closed cleanly — backoff resets to 1 s.
    const delays = scheduledDelays();
    const lastDelay = delays[delays.length - 1];
    expect(lastDelay).toBe(1000);
  });

  it("reports 'connected' status while the stream is alive", async () => {
    const openStreamController: ReadableStreamDefaultController<Uint8Array>[] = [];
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          openStreamController.push(controller);
        },
      }),
    });

    const { result } = renderHook(() => useEventStream(defaultOpts));

    expect(result.current.status).toBe("reconnecting");

    await simulateFocus();

    expect(result.current.status).toBe("connected");
  });

  it("cancels a scheduled retry when the screen loses focus (blur)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    expect(scheduledDelays()).toContain(1000);
    const callsBeforeBlur = fetchMock.mock.calls.length;

    await simulateBlur();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeBlur);
  });

  it("does not schedule a retry when the screen is blurred before the fetch error resolves", async () => {
    let rejectFetch!: (err: Error) => void;
    fetchMock.mockReturnValue(
      new Promise<never>((_, reject) => {
        rejectFetch = reject;
      })
    );

    renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    await simulateBlur();

    await act(async () => {
      rejectFetch(new TypeError("Failed to fetch"));
      await vi.runAllTicks();
    });

    expect(scheduledDelays()).toHaveLength(0);
  });

  it("calls the correct event stream URL", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/events/event-abc/stream",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "text/event-stream" }) }),
    );
  });

  it("treats an initial access denial as terminal instead of scheduling retries", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    const { result } = renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();

    expect(result.current.status).toBe("revoked");
    expect(scheduledDelays()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("notifies the detail screen when an update frame uses CRLF line endings", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const onUpdate = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
        },
      }),
    });

    renderHook(() => useEventStream({ ...defaultOpts, onUpdate }));
    await simulateFocus();

    await act(async () => {
      controller.enqueue(new TextEncoder().encode("event: update\r\ndata: {\"eventId\":\"event-abc\"}\r\n\r\n"));
      await Promise.resolve();
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("stops reconnecting when an open stream reports authorization_revoked", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
        },
      }),
    });

    const { result } = renderHook(() => useEventStream(defaultOpts));
    await simulateFocus();
    await act(async () => {
      controller.enqueue(
        new TextEncoder().encode(
          'event: authorization_revoked\ndata: {"code":"AUTHORIZATION_REVOKED"}\n\n',
        ),
      );
      await Promise.resolve();
    });

    expect(result.current.status).toBe("revoked");
    expect(scheduledDelays()).toHaveLength(0);
  });
});
