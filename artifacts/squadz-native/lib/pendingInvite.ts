import AsyncStorage from "@react-native-async-storage/async-storage";

// B6: persist the actual pending squad-invite code (not just a flag) so an
// invite deep-link survives the whole onboarding flow — including cold starts
// where router params are lost. Dedicated key, 24h expiry.
const PENDING_INVITE_KEY = "@squadz/pendingInviteCode";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

type Stored = { code: string; savedAt: number };
export type PendingInviteKind = "friend" | "squad" | "event";
export type PendingInvite = { kind: PendingInviteKind; code: string };

const PENDING_FRIEND_INVITE_KEY = "@squadz/pendingFriendInviteCode";

async function saveCode(key: string, code: string, normalize: (value: string) => string): Promise<boolean> {
  const normalized = normalize(code);
  if (!normalized) return false;
  try {
    const payload: Stored = { code: normalized, savedAt: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function readCode(key: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > EXPIRY_MS
    ) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

async function clearCode(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

export async function savePendingInviteCode(code: string): Promise<boolean> {
  return saveCode(PENDING_INVITE_KEY, code, (value) => value.trim().toUpperCase());
}

/** Returns the stored code if present and less than 24h old; expired or malformed entries are cleared. */
export async function readPendingInviteCode(): Promise<string | null> {
  return readCode(PENDING_INVITE_KEY);
}

export async function clearPendingInviteCode(): Promise<void> {
  await clearCode(PENDING_INVITE_KEY);
}

// Same persistence pattern for EVENT invite codes (joinsquadz.com/join/<code>).
// Without this, a cold start during signup/onboarding loses the router params
// and the invited friend lands on an empty home screen instead of the event.
const PENDING_EVENT_INVITE_KEY = "@squadz/pendingEventInviteCode";

export async function savePendingEventCode(code: string): Promise<boolean> {
  return saveCode(PENDING_EVENT_INVITE_KEY, code, (value) => value.trim());
}

/** Returns the stored event invite code if present and less than 24h old. */
export async function readPendingEventCode(): Promise<string | null> {
  return readCode(PENDING_EVENT_INVITE_KEY);
}

export async function clearPendingEventCode(): Promise<void> {
  await clearCode(PENDING_EVENT_INVITE_KEY);
}

/** Friend links use their own key so accepting one never consumes a squad/event invite. */
export async function savePendingFriendCode(code: string): Promise<boolean> {
  return saveCode(PENDING_FRIEND_INVITE_KEY, code, (value) => value.trim().toUpperCase());
}

export async function readPendingFriendCode(): Promise<string | null> {
  return readCode(PENDING_FRIEND_INVITE_KEY);
}

export async function clearPendingFriendCode(): Promise<void> {
  await clearCode(PENDING_FRIEND_INVITE_KEY);
}

/** Parse only canonical SquadZ HTTPS invite URLs copied by the fallback pages. */
export function parsePendingInviteUrl(value: string): PendingInvite | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "joinsquadz.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if ((parts[0] === "api" && parts[1] === "add" && parts[2] === "friend") ||
        (parts[0] === "add" && parts[1] === "friend")) {
      const code = parts[parts.length - 1]?.trim().toUpperCase();
      return code ? { kind: "friend", code } : null;
    }
    if (parts[0] === "squad" && parts[1] === "join") {
      const code = url.searchParams.get("code")?.trim().toUpperCase();
      return code ? { kind: "squad", code } : null;
    }
    if (parts[0] === "join" && parts.length === 2) {
      const code = parts[1]?.trim().toUpperCase();
      return code ? { kind: "event", code } : null;
    }
  } catch {
    // Clipboard contents are arbitrary text.
  }
  return null;
}

/** Persist a parsed clipboard/link invite. `true` means it is safe to clear its source. */
export async function savePendingInvite(invite: PendingInvite): Promise<boolean> {
  switch (invite.kind) {
    case "friend": return savePendingFriendCode(invite.code);
    case "squad": return savePendingInviteCode(invite.code);
    case "event": return savePendingEventCode(invite.code);
  }
}

/** Determines the route used by auth/onboarding resume without importing Expo Router. */
export function pendingInviteRoute(invite: PendingInvite): string {
  switch (invite.kind) {
    case "friend": return `/add/friend/${encodeURIComponent(invite.code)}?auto=1`;
    case "squad": return `/squad/join?code=${encodeURIComponent(invite.code)}&auto=1`;
    case "event": return `/join/${encodeURIComponent(invite.code)}`;
  }
}

export async function readPendingInvite(): Promise<PendingInvite | null> {
  const friend = await readPendingFriendCode();
  if (friend) return { kind: "friend", code: friend };
  const squad = await readPendingInviteCode();
  if (squad) return { kind: "squad", code: squad };
  const event = await readPendingEventCode();
  return event ? { kind: "event", code: event } : null;
}
