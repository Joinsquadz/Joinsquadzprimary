import { router } from "expo-router";

/**
 * Routes the app to the correct screen based on push notification data.
 * Used by both the live notification response listener and the cold-start
 * getLastNotificationResponseAsync path (deduped by notification identifier).
 *
 * Extracted as a standalone function so it can be unit-tested independently
 * of the PushNotificationHandler component.
 */
export function routeFromNotificationData(data?: Record<string, string>): void {
  if (!data?.screen) return;

  switch (data.screen) {
    case "availability":
      if (data.squadId) {
        router.push({ pathname: "/availability", params: { squadId: data.squadId } } as never);
      } else if (data.eventId) {
        router.push({ pathname: "/availability", params: { eventId: data.eventId } } as never);
      }
      break;
    case "conversation":
      if (data.conversationId) {
        router.push({ pathname: "/conversation/[id]", params: { id: data.conversationId } } as never);
      }
      break;
    case "event":
      if (data.eventId) {
        router.push({
          pathname: "/event/[id]",
          params: { id: data.eventId, ...(data.tab ? { tab: data.tab } : {}) },
        } as never);
      }
      break;
    case "trip":
      // Idea digests/nudges land on the Ideas tab; confirmations land on the
      // itinerary. The trip screen validates the tab param and falls back to
      // itinerary for anything unknown.
      if (data.eventId) {
        router.push({
          pathname: "/trip/[id]",
          params: { id: data.eventId, ...(data.tab ? { tab: data.tab } : {}) },
        } as never);
      }
      break;
    case "squad":
      if (data.squadId) {
        router.push({ pathname: "/squad/[id]", params: { id: data.squadId } } as never);
      }
      break;
    case "vault":
      // Vault comment notifications carry a photoId so the tap opens the
      // specific photo (VaultMediaDetail) rather than the generic vault.
      if (data.photoId) {
        router.push({
          pathname: "/vault",
          params: {
            ...(data.squadId ? { squadId: data.squadId } : {}),
            ...(data.eventId ? { eventId: data.eventId } : {}),
            photoId: data.photoId,
          },
        } as never);
      } else if (data.squadId) {
        router.push({ pathname: "/vault", params: { squadId: data.squadId } } as never);
      }
      break;
    case "friends":
      router.push("/friends" as never);
      break;
    case "feed":
      router.navigate("/(tabs)/feed" as never);
      break;
    case "activity":
      router.push("/activity" as never);
      break;
  }
}
