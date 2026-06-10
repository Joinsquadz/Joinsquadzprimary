import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AppContext";

export type ResolvedUser = {
  id: string;
  name: string;
  initials: string;
  color: string;
  profileImageUrl: string | null;
  isPro: boolean;
};

const USER_COLORS = [
  "#FF5C3A", "#A855F7", "#2ECC8A", "#FFB547", "#4A9EFF",
  "#E91E8C", "#00BCD4", "#FF9800", "#8BC34A", "#9C27B0",
];

function colorFromId(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function makePlaceholder(id: string): ResolvedUser {
  return { id, name: "...", initials: "??", color: colorFromId(id), profileImageUrl: null, isPro: false };
}

type ApiUserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  isPro?: boolean;
};

function apiRowToResolved(row: ApiUserRow): ResolvedUser {
  const firstName = row.firstName ?? "";
  const lastName = row.lastName ?? "";
  const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
  const initials =
    firstName && lastName
      ? `${firstName[0]}${lastName[0]}`.toUpperCase()
      : firstName
      ? firstName.slice(0, 2).toUpperCase()
      : "U?";
  return {
    id: row.id,
    name,
    initials,
    color: colorFromId(row.id),
    profileImageUrl: row.profileImageUrl ?? null,
    isPro: row.isPro ?? false,
  };
}

type UserCacheCtx = {
  resolveUser: (id: string) => ResolvedUser;
  prefetchUsers: (ids: string[]) => void;
  seedUser: (user: ResolvedUser) => void;
};

const UserCacheContext = createContext<UserCacheCtx>({
  resolveUser: makePlaceholder,
  prefetchUsers: () => {},
  seedUser: () => {},
});

export function useUserCache(): UserCacheCtx {
  return useContext(UserCacheContext);
}

export function UserCacheProvider({ children }: { children: React.ReactNode }) {
  const { authToken } = useAuth();
  const [cache, setCache] = useState<Map<string, ResolvedUser>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authTokenRef = useRef<string | null>(null);

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  const flushFetch = useCallback(async () => {
    const token = authTokenRef.current;
    if (!token) return;
    const toFetch = Array.from(pendingRef.current).filter(
      (id) => !fetchingRef.current.has(id),
    );
    if (toFetch.length === 0) return;
    pendingRef.current.clear();
    toFetch.forEach((id) => fetchingRef.current.add(id));
    try {
      const res = await fetch(
        `${API_BASE}/api/users?ids=${encodeURIComponent(toFetch.join(","))}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as ApiUserRow[];
      setCache((prev) => {
        const next = new Map(prev);
        rows.forEach((row) => next.set(row.id, apiRowToResolved(row)));
        return next;
      });
    } catch {
      // Network unavailable — leave placeholders in place
    } finally {
      toFetch.forEach((id) => fetchingRef.current.delete(id));
    }
  }, []);

  const scheduleFetch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushFetch();
    }, 50);
  }, [flushFetch]);

  const resolveUser = useCallback(
    (id: string): ResolvedUser => {
      return cache.get(id) ?? makePlaceholder(id);
    },
    [cache],
  );

  const prefetchUsers = useCallback(
    (ids: string[]) => {
      let hasNew = false;
      for (const id of ids) {
        if (!cache.has(id) && !fetchingRef.current.has(id)) {
          pendingRef.current.add(id);
          hasNew = true;
        }
      }
      if (hasNew) scheduleFetch();
    },
    [cache, scheduleFetch],
  );

  const seedUser = useCallback((user: ResolvedUser) => {
    setCache((prev) => {
      const existing = prev.get(user.id);
      if (existing === user) return prev;
      const next = new Map(prev);
      next.set(user.id, user);
      return next;
    });
  }, []);

  useEffect(() => {
    setCache(new Map());
    fetchingRef.current.clear();
    pendingRef.current.clear();
  }, [authToken]);

  return (
    <UserCacheContext.Provider value={{ resolveUser, prefetchUsers, seedUser }}>
      {children}
    </UserCacheContext.Provider>
  );
}
