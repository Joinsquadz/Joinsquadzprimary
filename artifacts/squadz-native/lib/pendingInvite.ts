import AsyncStorage from "@react-native-async-storage/async-storage";

// B6: persist the actual pending squad-invite code (not just a flag) so an
// invite deep-link survives the whole onboarding flow — including cold starts
// where router params are lost. Dedicated key, 24h expiry.
const PENDING_INVITE_KEY = "@squadz/pendingInviteCode";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

type Stored = { code: string; savedAt: number };

export async function savePendingInviteCode(code: string): Promise<void> {
  if (!code) return;
  try {
    const payload: Stored = { code: code.trim().toUpperCase(), savedAt: Date.now() };
    await AsyncStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort — the param-based flow still covers the warm path.
  }
}

/** Returns the stored code if present and less than 24h old; expired or malformed entries are cleared. */
export async function readPendingInviteCode(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > EXPIRY_MS
    ) {
      await AsyncStorage.removeItem(PENDING_INVITE_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

export async function clearPendingInviteCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Ignore.
  }
}
