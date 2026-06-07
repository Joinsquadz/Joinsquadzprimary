import { useState, useEffect } from "react";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

const USER_COLORS = [
  "#FF5C3A", "#A855F7", "#2ECC8A", "#FFB547", "#4A9EFF",
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

/**
 * Fetches real user profiles for a set of IDs from the API.
 * Returns a Map<userId, UserProfile> that grows as data arrives.
 * Falls back gracefully — callers should handle IDs not present in the map.
 */
export function useUserProfiles(
  ids: string[],
  authToken: string | null,
): Map<string, UserProfile> {
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const key = Array.from(new Set(ids)).sort().join(",");

  useEffect(() => {
    if (!key || !authToken) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/users/batch?ids=${encodeURIComponent(key)}`, {
      headers: buildAuthHeaders(authToken),
    })
      .then((r) => (r.ok ? (r.json() as Promise<ApiUserRow[]>) : Promise.resolve([])))
      .then((data) => {
        if (cancelled) return;
        const map = new Map<string, UserProfile>();
        for (const u of data) map.set(u.id, rowToProfile(u));
        setProfiles(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [key, authToken]);

  return profiles;
}
