import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { useAuth } from "@/context/AppContext";
import { useActivity } from "@/context/ActivityContext";
import { useToastBanner } from "@/context/ToastBannerContext";
import { useUserCache } from "@/context/UserCacheContext";
import { useNewVaultPhotosBanner } from "@/hooks/useNewVaultPhotosBanner";

type ActivityMeta = {
  subjectName?: string;
  subjectEmoji?: string;
  squadId?: string;
} | null;

type ActivityItem = {
  id: string;
  type: string;
  subjectId: string | null;
  actorIds: string[];
  actorCount: number;
  createdAt: string;
  meta: ActivityMeta;
};

const RSVP_BATCH_MS = 10000;

type PendingRsvp = {
  eventId: string;
  name: string;
  emoji?: string;
  actorIds: Set<string>;
};

/**
 * Foreground-only surfacer for two delight banners that ride on the activity
 * stream:
 *   B2 — RSVP momentum: when people RSVP "going" to an event you host, show a
 *        single batched banner (10s window) so a burst reads as one celebration.
 *   B3 — Friend joined your squad: the squad creator gets a banner when someone
 *        joins.
 * It never re-announces history: the first poll after mount just establishes a
 * baseline, and only genuinely new actors trigger banners afterwards.
 */
export function ActivityBannerSurfacer() {
  const router = useRouter();
  const { authToken, isLoggedIn } = useAuth();
  const { subscribe } = useActivity();
  const { showBanner } = useToastBanner();
  const { resolveUser, prefetchUsers } = useUserCache();

  // B9: batched "new vault photos" heads-up (foreground, 6h throttle).
  useNewVaultPhotosBanner();

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = authToken;

  // Per-item set of actor ids we have already accounted for.
  const seenRef = useRef<Map<string, Set<string>>>(new Map());
  const initializedRef = useRef(false);

  const pendingRef = useRef<Map<string, PendingRsvp>>(new Map());
  const rsvpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRsvps = useCallback(() => {
    rsvpTimerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = new Map();
    for (const p of pending.values()) {
      const actorIds = [...p.actorIds];
      if (actorIds.length === 0) continue;
      prefetchUsers(actorIds);
      const first = resolveUser(actorIds[0]);
      const others = actorIds.length - 1;
      const who =
        others > 0
          ? `${first.name} +${others} ${others === 1 ? "other" : "others"}`
          : first.name;
      const title =
        actorIds.length > 1
          ? `${who} are going! 🎉`
          : `${who} is going! 🎉`;
      showBanner({
        title,
        subtitle: p.name ? `${p.emoji ? `${p.emoji} ` : ""}${p.name}` : undefined,
        avatarUrl: actorIds.length === 1 ? first.profileImageUrl : null,
        emoji: actorIds.length > 1 ? "🔥" : undefined,
        initials: first.initials,
        color: first.color,
        onPress: () => router.push(`/event/${p.eventId}`),
      });
    }
  }, [prefetchUsers, resolveUser, router, showBanner]);

  const process = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    let items: ActivityItem[] = [];
    try {
      const res = await fetch(`${API_BASE}/api/activity?page=0&limit=20`, {
        headers: buildAuthHeaders(token),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { items: ActivityItem[] };
      items = data.items ?? [];
    } catch {
      return;
    }

    const baseline = !initializedRef.current;
    let hasNewRsvp = false;

    for (const item of items) {
      if (item.type !== "rsvp" && item.type !== "squad_join") continue;
      const prev = seenRef.current.get(item.id) ?? new Set<string>();
      const newActors = item.actorIds.filter((a) => !prev.has(a));
      // Always update the seen set to the latest actor list.
      seenRef.current.set(item.id, new Set(item.actorIds));
      if (baseline || newActors.length === 0) continue;

      if (item.type === "rsvp" && item.subjectId) {
        const eventId = item.subjectId;
        const entry =
          pendingRef.current.get(eventId) ??
          ({
            eventId,
            name: item.meta?.subjectName ?? "your event",
            emoji: item.meta?.subjectEmoji,
            actorIds: new Set<string>(),
          } satisfies PendingRsvp);
        newActors.forEach((a) => entry.actorIds.add(a));
        pendingRef.current.set(eventId, entry);
        hasNewRsvp = true;
      } else if (item.type === "squad_join") {
        const actorId = newActors[0];
        prefetchUsers([actorId]);
        const actor = resolveUser(actorId);
        const squadName = item.meta?.subjectName ?? "your squad";
        const squadId = item.meta?.squadId ?? item.subjectId ?? undefined;
        showBanner({
          title: `${actor.name} joined ${squadName} 👋`,
          subtitle: "Your crew is growing",
          avatarUrl: actor.profileImageUrl,
          initials: actor.initials,
          color: actor.color,
          onPress: squadId ? () => router.push(`/squad/${squadId}`) : undefined,
        });
      }
    }

    if (baseline) {
      initializedRef.current = true;
      return;
    }
    if (hasNewRsvp && !rsvpTimerRef.current) {
      rsvpTimerRef.current = setTimeout(flushRsvps, RSVP_BATCH_MS);
    }
  }, [flushRsvps, prefetchUsers, resolveUser, router, showBanner]);

  // Reset baseline whenever auth changes so a fresh login re-establishes it.
  useEffect(() => {
    if (!isLoggedIn || !authToken) {
      initializedRef.current = false;
      seenRef.current.clear();
      pendingRef.current.clear();
      if (rsvpTimerRef.current) {
        clearTimeout(rsvpTimerRef.current);
        rsvpTimerRef.current = null;
      }
      return;
    }
    void process();
    const unsub = subscribe(() => void process());
    return () => {
      unsub();
      if (rsvpTimerRef.current) {
        clearTimeout(rsvpTimerRef.current);
        rsvpTimerRef.current = null;
      }
    };
  }, [isLoggedIn, authToken, subscribe, process]);

  return null;
}
