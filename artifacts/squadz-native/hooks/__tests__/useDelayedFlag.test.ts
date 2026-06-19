// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDelayedFlag } from "../useDelayedFlag";

describe("useDelayedFlag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays false until the delay elapses, then turns true", () => {
    const { result } = renderHook(() => useDelayedFlag(true, 3000));
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it("never turns true if active flips false before the delay (no flash)", () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 3000), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it("resets to false immediately when active becomes false after being shown", () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 3000), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it("clears the pending timer on unmount (no late state update)", () => {
    const { unmount } = renderHook(() => useDelayedFlag(true, 3000));
    unmount();
    // Advancing past the delay must not throw (timer was cleared on unmount).
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    }).not.toThrow();
  });
});
