import AsyncStorage from "@react-native-async-storage/async-storage";

// Per-user "seen once" flags for one-time delight moments (streak milestones,
// first-RSVP, poll nudges, etc.). Keyed with a `_${userId}` suffix so they are
// scoped to the signed-in user and survive logout (they are intentionally NOT
// part of ALL_APP_STORAGE_KEYS, mirroring the tips tour convention).

function key(base: string, userId: string): string {
  return `${base}_${userId}`;
}

export async function hasSeen(base: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId || userId === "me") return true; // unknown user → don't replay
  try {
    return (await AsyncStorage.getItem(key(base, userId))) === "1";
  } catch {
    return true;
  }
}

export async function markSeen(base: string, userId: string | null | undefined): Promise<void> {
  if (!userId || userId === "me") return;
  try {
    await AsyncStorage.setItem(key(base, userId), "1");
  } catch {
    // best-effort
  }
}

/** Returns true exactly once per (base,userId); marks seen as a side effect. */
export async function claimOnce(base: string, userId: string | null | undefined): Promise<boolean> {
  if (await hasSeen(base, userId)) return false;
  await markSeen(base, userId);
  return true;
}
