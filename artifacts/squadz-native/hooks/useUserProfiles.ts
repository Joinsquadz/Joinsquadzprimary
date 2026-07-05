import { useState, useEffect } from "react";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

const USER_COLORS = [
  "#FF6B2C", "#A855F7", "#2ECC8A", "#FFB23E", "#4A9EFF",
  "#E91E8C", "#00BCD4", "#FF9800", "#8BC34A", "#9C27B0",
];

export function colorFromId(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

export function initialsFromName(firstName: string | null, lastName: string | null): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  return "??";
}

export function nameFromParts(firstName: string | null, lastName: string | null, fallback: string): string {
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  return fallback;
}

export type UserProfile = {
  id: string;
  name: string;
  initials: string;
  color: string;
  profileImageUrl: string | null;
};

type ApiUserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
};

function rowToProfile(u: ApiUserRow): UserProfile {
  return {
    id: u.id,
    name: nameFromParts(u.firstName, u.lastName, u.id.slice(0, 6)),
    initials: initialsFromName(u.firstName, u.lastName),
    color: colorFromId(u.id),
    profileImageUrl: u.profileImageUrl,
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
  profiles: Map<string, UserProfile>;
  expiresAt: number;
};

const profileCache = new Map<string, CacheEntry>();

/** Clears all cached profile data. Call on logout to prevent data leaking between accounts. */
export function clearProfileCache(): void {
  profileCache.clear();
}

/**
 * Fetches real user profiles for a set of IDs from the API.
 * Returns a Map<userId, UserProfile> that grows as data arrives.
 * Results are cached in memory for 5 minutes to avoid redundant fetches
 * when navigating back to a squad or event screen.
 * Falls back gracefully — callers should handle IDs not present in the map.
 */
export function useUserProfiles(
  ids: string[],
  authToken: string | null,
): Map<string, UserProfile> {
  const key = Array.from(new Set(ids)).sort().join(",");

  const cached = key ? profileCache.get(key) : undefined;
  const isFresh = cached !== undefined && cached.expiresAt > Date.now();

  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(
    isFresh ? cached.profiles : new Map(),
  );

  useEffect(() => {
    if (!key || !authToken) return;

    const entry = profileCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      setProfiles(entry.profiles);
      return;
    }

    let cancelled = false;
    fetch(`${API_BASE}/api/users/batch?ids=${encodeURIComponent(key)}`, {
      headers: buildAuthHeaders(authToken),
    })
      .then((r) => (r.ok ? (r.json() as Promise<ApiUserRow[]>) : Promise.resolve([])))
      .then((data) => {
        if (cancelled) return;
        const map = new Map<string, UserProfile>();
        for (const u of data) map.set(u.id, rowToProfile(u));
        profileCache.set(key, { profiles: map, expiresAt: Date.now() + CACHE_TTL_MS });
        setProfiles(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [key, authToken]);

  return profiles;
}
