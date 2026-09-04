// B6 — pending invite code survives cold-start onboarding.
//
// Deep links arrive before onboarding completes. The invite code is saved to
// AsyncStorage with a 24h TTL so a cold-start flow (where router params are
// lost) can still join the right squad once the user finishes registering.
import { describe, it, expect, vi, beforeEach } from "vitest";

const asyncStorageData = vi.hoisted(() => ({ store: {} as Record<string, string> }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStorageData.store[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStorageData.store[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete asyncStorageData.store[key];
      return Promise.resolve();
    }),
  },
}));

import {
  savePendingInviteCode,
  readPendingInviteCode,
  clearPendingInviteCode,
  clearPendingFriendCode,
  parsePendingInviteUrl,
  pendingInviteRoute,
  readPendingFriendCode,
  savePendingFriendCode,
  savePendingInvite,
} from "../pendingInvite";

const KEY = "@squadz/pendingInviteCode";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  asyncStorageData.store = {};
  vi.clearAllMocks();
});

describe("B6 — savePendingInviteCode", () => {
  it("stores the code normalized to uppercase with a savedAt timestamp", async () => {
    await savePendingInviteCode("abc123");
    const raw = asyncStorageData.store[KEY];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw) as { code: string; savedAt: number };
    expect(parsed.code).toBe("ABC123");
    expect(typeof parsed.savedAt).toBe("number");
    expect(parsed.savedAt).toBeLessThanOrEqual(Date.now());
  });

  it("is a no-op for an empty string (guards against saving an unusable code)", async () => {
    await savePendingInviteCode("");
    expect(asyncStorageData.store[KEY]).toBeUndefined();
  });

  it("trims whitespace before storing", async () => {
    await savePendingInviteCode("  TRIM  ");
    const raw = asyncStorageData.store[KEY];
    const parsed = JSON.parse(raw) as { code: string };
    expect(parsed.code).toBe("TRIM");
  });
});

describe("B6 — readPendingInviteCode", () => {
  it("returns the stored code when called within 24h", async () => {
    await savePendingInviteCode("INVITE01");
    const code = await readPendingInviteCode();
    expect(code).toBe("INVITE01");
  });

  it("returns null and clears storage when the saved code is older than 24h (expired)", async () => {
    const expired = JSON.stringify({
      code: "OLDCODE",
      savedAt: Date.now() - EXPIRY_MS - 1000,
    });
    asyncStorageData.store[KEY] = expired;

    const code = await readPendingInviteCode();

    expect(code).toBeNull();
    expect(asyncStorageData.store[KEY]).toBeUndefined();
  });

  it("returns null and does not throw on malformed JSON", async () => {
    asyncStorageData.store[KEY] = "not-valid-json{";
    const code = await readPendingInviteCode();
    expect(code).toBeNull();
  });

  it("returns null when the stored entry is missing the code field", async () => {
    asyncStorageData.store[KEY] = JSON.stringify({ savedAt: Date.now() });
    const code = await readPendingInviteCode();
    expect(code).toBeNull();
  });

  it("returns null when the stored entry is missing the savedAt field", async () => {
    asyncStorageData.store[KEY] = JSON.stringify({ code: "X" });
    const code = await readPendingInviteCode();
    expect(code).toBeNull();
  });

  it("returns null when nothing has been stored", async () => {
    const code = await readPendingInviteCode();
    expect(code).toBeNull();
  });
});

describe("B6 — clearPendingInviteCode", () => {
  it("removes the stored code so subsequent reads return null", async () => {
    await savePendingInviteCode("TOCLEAR");
    await clearPendingInviteCode();
    const code = await readPendingInviteCode();
    expect(code).toBeNull();
  });

  it("is a no-op when nothing is stored (does not throw)", async () => {
    await expect(clearPendingInviteCode()).resolves.toBeUndefined();
  });
});

describe("friend pending invite persistence", () => {
  it("keeps friend codes in an isolated, normalized storage key", async () => {
    await savePendingFriendCode(" friend9 ");
    expect(await readPendingFriendCode()).toBe("FRIEND9");
    await clearPendingFriendCode();
    expect(await readPendingFriendCode()).toBeNull();
  });

  it("reports whether a parsed invite was safely persisted", async () => {
    await expect(savePendingInvite({ kind: "friend", code: "abc" })).resolves.toBe(true);
    expect(await readPendingFriendCode()).toBe("ABC");
  });
});

describe("clipboard invite parser and resume routes", () => {
  it.each([
    ["https://joinsquadz.com/api/add/friend/friend7", { kind: "friend", code: "FRIEND7" }],
    ["https://joinsquadz.com/add/friend/friend7", { kind: "friend", code: "FRIEND7" }],
    ["https://joinsquadz.com/squad/join?code=squad7", { kind: "squad", code: "SQUAD7" }],
    ["https://joinsquadz.com/join/event7", { kind: "event", code: "EVENT7" }],
  ])("recognizes canonical %s URLs", (url, expected) => {
    expect(parsePendingInviteUrl(url)).toEqual(expected);
  });

  it("rejects unrelated hosts and incomplete invite paths", () => {
    expect(parsePendingInviteUrl("https://example.com/add/friend/ABC")).toBeNull();
    expect(parsePendingInviteUrl("https://joinsquadz.com/squad/join")).toBeNull();
  });

  it("routes resumed friend codes directly into automatic acceptance", () => {
    expect(pendingInviteRoute({ kind: "friend", code: "ABC 1" })).toBe("/add/friend/ABC%201?auto=1");
  });
});
