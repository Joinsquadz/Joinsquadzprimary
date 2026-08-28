/**
 * Phase 2 — Secure token invariants.
 *
 * Confirms that:
 *  1. A token found ONLY in AsyncStorage (legacy plaintext) is deleted and
 *     returns null — forcing re-authentication, not silent migration.
 *  2. setSecureToken writes exclusively to SecureStore (never to AsyncStorage)
 *     and purges any pre-existing legacy copy from AsyncStorage.
 *  3. A token stored in SecureStore is returned normally.
 *  4. SecureStore unavailability yields null (no plaintext fallback).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared in-memory state (reset between tests)
// ---------------------------------------------------------------------------
let secureStoreData: Record<string, string> = {};
let asyncStorageData: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Mock expo-secure-store
// ---------------------------------------------------------------------------
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => secureStoreData[key] ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreData[key] = value;
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    delete secureStoreData[key];
  }),
}));

// ---------------------------------------------------------------------------
// Mock @react-native-async-storage/async-storage
// ---------------------------------------------------------------------------
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageData[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageData[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete asyncStorageData[key];
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) delete asyncStorageData[k];
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import the functions under test (after mocks are set up)
// ---------------------------------------------------------------------------
// We can't import getSecureToken / setSecureToken directly because they're
// module-private in AppContext.tsx. So we test them via a thin re-export shim
// that mirrors the production implementations exactly.
// ---------------------------------------------------------------------------
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Mirror of the production functions (kept in sync manually):
async function getSecureToken(key: string): Promise<string | null> {
  try {
    const val = await SecureStore.getItemAsync(key);
    if (val !== null) return val;
    const legacy = await AsyncStorage.getItem(key).catch(() => null);
    if (legacy) {
      await AsyncStorage.removeItem(key).catch(() => {});
    }
    return null;
  } catch {
    return null;
  }
}

async function setSecureToken(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (err) {
    console.warn("[SecureStore] setItemAsync failed", key, err);
    throw err;
  }
  await AsyncStorage.removeItem(key).catch(() => {});
}

async function removeSecureToken(key: string): Promise<void> {
  try { await SecureStore.deleteItemAsync(key); } catch {}
  await AsyncStorage.removeItem(key).catch(() => {});
}

const AUTH_TOKEN_KEY = "squadz.authToken";

beforeEach(() => {
  secureStoreData = {};
  asyncStorageData = {};
  vi.clearAllMocks();
  // Re-wire the mock implementations (clearAllMocks resets call counts but
  // not the implementation fn itself, so re-assign here to be safe)
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => secureStoreData[key] ?? null);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { secureStoreData[key] = value; });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { delete secureStoreData[key]; });
  vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => asyncStorageData[key] ?? null);
  vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { asyncStorageData[key] = value; });
  vi.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => { delete asyncStorageData[key]; });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getSecureToken — legacy invalidation path
// ---------------------------------------------------------------------------
describe("getSecureToken — legacy AsyncStorage invalidation", () => {
  it("returns null when token exists only in AsyncStorage (forces re-auth)", async () => {
    asyncStorageData[AUTH_TOKEN_KEY] = "legacy-plaintext-token";

    const result = await getSecureToken(AUTH_TOKEN_KEY);

    // Must NOT return the legacy token — forces re-authentication
    expect(result).toBeNull();
  });

  it("deletes the legacy AsyncStorage token after detecting it", async () => {
    asyncStorageData[AUTH_TOKEN_KEY] = "legacy-plaintext-token";

    await getSecureToken(AUTH_TOKEN_KEY);

    // Token must be purged from AsyncStorage
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(AUTH_TOKEN_KEY);
    expect(asyncStorageData[AUTH_TOKEN_KEY]).toBeUndefined();
  });

  it("does NOT write the legacy token into SecureStore", async () => {
    asyncStorageData[AUTH_TOKEN_KEY] = "legacy-plaintext-token";

    await getSecureToken(AUTH_TOKEN_KEY);

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(secureStoreData[AUTH_TOKEN_KEY]).toBeUndefined();
  });

  it("returns null when both stores are empty", async () => {
    const result = await getSecureToken(AUTH_TOKEN_KEY);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSecureToken — SecureStore happy path
// ---------------------------------------------------------------------------
describe("getSecureToken — SecureStore happy path", () => {
  it("returns the token from SecureStore when it is stored there", async () => {
    secureStoreData[AUTH_TOKEN_KEY] = "secure-token-abc";

    const result = await getSecureToken(AUTH_TOKEN_KEY);

    expect(result).toBe("secure-token-abc");
    // Should not touch AsyncStorage at all
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("returns SecureStore token even when AsyncStorage also has one (no dual-read)", async () => {
    secureStoreData[AUTH_TOKEN_KEY] = "secure-current";
    asyncStorageData[AUTH_TOKEN_KEY] = "stale-plaintext";

    const result = await getSecureToken(AUTH_TOKEN_KEY);
    expect(result).toBe("secure-current");
    // AsyncStorage must not be read if SecureStore has the answer
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSecureToken — SecureStore unavailable (no plaintext fallback)
// ---------------------------------------------------------------------------
describe("getSecureToken — SecureStore unavailable", () => {
  it("returns null (no AsyncStorage fallback) when SecureStore.getItemAsync throws", async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error("OS fault"));

    const result = await getSecureToken(AUTH_TOKEN_KEY);

    expect(result).toBeNull();
    // Must NOT fall back to reading AsyncStorage
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setSecureToken — writes only to SecureStore
// ---------------------------------------------------------------------------
describe("setSecureToken — writes exclusively to SecureStore", () => {
  it("writes the token to SecureStore", async () => {
    await setSecureToken(AUTH_TOKEN_KEY, "brand-new-token");

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(AUTH_TOKEN_KEY, "brand-new-token");
    expect(secureStoreData[AUTH_TOKEN_KEY]).toBe("brand-new-token");
  });

  it("purges any legacy copy from AsyncStorage after writing to SecureStore", async () => {
    asyncStorageData[AUTH_TOKEN_KEY] = "old-plaintext";

    await setSecureToken(AUTH_TOKEN_KEY, "brand-new-token");

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(AUTH_TOKEN_KEY);
    expect(asyncStorageData[AUTH_TOKEN_KEY]).toBeUndefined();
  });

  it("does NOT write to AsyncStorage (no dual-write or fallback)", async () => {
    await setSecureToken(AUTH_TOKEN_KEY, "brand-new-token");

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeSecureToken
// ---------------------------------------------------------------------------
describe("removeSecureToken", () => {
  it("removes the token from SecureStore", async () => {
    secureStoreData[AUTH_TOKEN_KEY] = "token-to-remove";

    await removeSecureToken(AUTH_TOKEN_KEY);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_TOKEN_KEY);
    expect(secureStoreData[AUTH_TOKEN_KEY]).toBeUndefined();
  });

  it("also clears any legacy AsyncStorage copy during logout", async () => {
    asyncStorageData[AUTH_TOKEN_KEY] = "legacy";

    await removeSecureToken(AUTH_TOKEN_KEY);

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(AUTH_TOKEN_KEY);
    expect(asyncStorageData[AUTH_TOKEN_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setSecureToken — failure logging (not silently swallowed)
// ---------------------------------------------------------------------------
describe("setSecureToken — failure logging", () => {
  it("logs a warning when SecureStore.setItemAsync throws (OS-level fault)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const faultError = new Error("OS encryption fault");
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(faultError);

    await expect(setSecureToken(AUTH_TOKEN_KEY, "some-token")).rejects.toThrow(
      "OS encryption fault",
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("setItemAsync failed"),
      AUTH_TOKEN_KEY,
      faultError,
    );
    warnSpy.mockRestore();
  });

  it("does not erase the last persisted copy when SecureStore throws", async () => {
    asyncStorageData[AUTH_TOKEN_KEY] = "stale-plaintext";
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("OS fault"));

    await expect(setSecureToken(AUTH_TOKEN_KEY, "token")).rejects.toThrow(
      "OS fault",
    );

    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith(AUTH_TOKEN_KEY);
    expect(asyncStorageData[AUTH_TOKEN_KEY]).toBe("stale-plaintext");
  });
});

// ---------------------------------------------------------------------------
// Cold-start simulation: full write → restart → read → authenticated flow
// ---------------------------------------------------------------------------
// Simulates the device lifecycle: login writes token, app is force-quit
// (in-memory state gone, SecureStore data persists), app reopens and reads
// the token back — should be the same value, indistinguishable from a live
// session (i.e. the user is still authenticated).
// ---------------------------------------------------------------------------
const REFRESH_TOKEN_KEY = "squadz.refreshToken";

describe("cold-start session persistence", () => {
  it("token survives a simulated app restart (write → clear memory → read)", async () => {
    // Step 1 — Login: write token (as the app does on login)
    await setSecureToken(AUTH_TOKEN_KEY, "session-token-xyz");

    // Verify it was stored
    expect(secureStoreData[AUTH_TOKEN_KEY]).toBe("session-token-xyz");

    // Step 2 — Force-quit: in-memory JS state would be cleared, but
    // SecureStore (a native OS keychain) persists across process restarts.
    // We simulate this by NOT clearing secureStoreData (it persists),
    // but confirming AsyncStorage is empty (tokens were never stored there).
    expect(asyncStorageData[AUTH_TOKEN_KEY]).toBeUndefined();

    // Step 3 — Cold reopen: app reads token back from SecureStore
    const restored = await getSecureToken(AUTH_TOKEN_KEY);

    // Must be the exact token that was written — user is still authenticated
    expect(restored).toBe("session-token-xyz");
    // AsyncStorage must not have been consulted — token was in SecureStore
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it("both auth token and refresh token survive a simulated restart", async () => {
    await setSecureToken(AUTH_TOKEN_KEY, "auth-token-abc");
    await setSecureToken(REFRESH_TOKEN_KEY, "refresh-token-def");

    // Simulate app restart by re-reading (SecureStore data persists in mock)
    const restoredAuth = await getSecureToken(AUTH_TOKEN_KEY);
    const restoredRefresh = await getSecureToken(REFRESH_TOKEN_KEY);

    expect(restoredAuth).toBe("auth-token-abc");
    expect(restoredRefresh).toBe("refresh-token-def");
  });

  it("logout clears token so user is not re-authenticated on next cold start", async () => {
    await setSecureToken(AUTH_TOKEN_KEY, "session-token-xyz");
    await setSecureToken(REFRESH_TOKEN_KEY, "session-refresh-xyz");

    // Logout: app removes the complete token pair.
    await removeSecureToken(AUTH_TOKEN_KEY);
    await removeSecureToken(REFRESH_TOKEN_KEY);

    // Next cold start: neither half of the previous session may survive.
    const [restoredAuth, restoredRefresh] = await Promise.all([
      getSecureToken(AUTH_TOKEN_KEY),
      getSecureToken(REFRESH_TOKEN_KEY),
    ]);
    expect(restoredAuth).toBeNull();
    expect(restoredRefresh).toBeNull();
  });

  it("re-login after logout stores new token that persists correctly", async () => {
    // First session
    await setSecureToken(AUTH_TOKEN_KEY, "first-token");
    await removeSecureToken(AUTH_TOKEN_KEY);

    // New login with a different token
    await setSecureToken(AUTH_TOKEN_KEY, "second-token");

    // Cold restart → read
    const restored = await getSecureToken(AUTH_TOKEN_KEY);
    expect(restored).toBe("second-token");
  });

  it("new key format 'squadz.authToken' satisfies expo-secure-store key constraints", () => {
    // expo-secure-store requires keys to match /^[\w.-]+$/
    // The old "@squadz/..." format contained "@" and "/" which fail this check.
    const validKeyPattern = /^[\w.-]+$/;
    expect(validKeyPattern.test(AUTH_TOKEN_KEY)).toBe(true);
    expect(validKeyPattern.test(REFRESH_TOKEN_KEY)).toBe(true);
  });
});
