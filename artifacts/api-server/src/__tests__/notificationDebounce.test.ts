import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { shouldSendNotification } from "../lib/notificationDebounce";

// The debounce module keeps state in module-level variables, so we re-import
// (by resetting module registry) between describe blocks that need a clean slate.
// Within a single describe we use fake timers to advance time instead.

describe("shouldSendNotification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clear the module cache so the in-memory map is fresh for the next block.
    vi.resetModules();
  });

  it("returns true the first time for a given (actor, recipient, type) triple", async () => {
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    expect(fn("alice", "bob", "vault_comment", 2 * 60 * 1000)).toBe(true);
  });

  it("returns false when called again within the cooldown window", async () => {
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    fn("alice", "bob", "vault_comment", 2 * 60 * 1000); // first call → true
    expect(fn("alice", "bob", "vault_comment", 2 * 60 * 1000)).toBe(false);
  });

  it("returns true again after the cooldown window elapses", async () => {
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    fn("alice", "bob", "vault_comment", 2 * 60 * 1000);
    vi.advanceTimersByTime(2 * 60 * 1000 + 1); // just past the 2-min window
    expect(fn("alice", "bob", "vault_comment", 2 * 60 * 1000)).toBe(true);
  });

  it("is independent per notification type", async () => {
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    fn("alice", "bob", "vault_comment", 2 * 60 * 1000);
    // Different type — should fire even within the vault_comment window.
    expect(fn("alice", "bob", "feed_comment", 2 * 60 * 1000)).toBe(true);
  });

  it("is independent per actor", async () => {
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    fn("alice", "bob", "vault_comment", 2 * 60 * 1000);
    // Different actor on same recipient → should fire.
    expect(fn("carol", "bob", "vault_comment", 2 * 60 * 1000)).toBe(true);
  });

  it("is independent per recipient", async () => {
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    fn("alice", "bob", "vault_comment", 2 * 60 * 1000);
    // Different recipient from same actor → should fire.
    expect(fn("alice", "dave", "vault_comment", 2 * 60 * 1000)).toBe(true);
  });

  it("poll-update cooldown: suppresses repeated rapid pushes (15-min window)", async () => {
    const WINDOW = 15 * 60 * 1000;
    const { shouldSendNotification: fn } = await import("../lib/notificationDebounce");
    expect(fn("organizer", "member-A", "poll_update", WINDOW)).toBe(true);
    // 14 minutes later — still within the 15-min window.
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(fn("organizer", "member-A", "poll_update", WINDOW)).toBe(false);
    // One more minute passes — now outside the window.
    vi.advanceTimersByTime(61 * 1000);
    expect(fn("organizer", "member-A", "poll_update", WINDOW)).toBe(true);
  });
});
