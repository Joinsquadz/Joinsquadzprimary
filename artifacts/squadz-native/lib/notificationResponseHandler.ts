/**
 * Factory that creates a stateful notification-response handler with built-in
 * identifier-based deduplication.
 *
 * Extracted from PushNotificationHandler (_layout.tsx) so the dedup logic can
 * be unit-tested independently of the React component and expo-notifications
 * import.
 *
 * @param handledIds  A Set<string> kept by the caller (e.g. a useRef). The
 *                    factory mutates it to track seen identifiers.
 * @param route       Called with the notification's data payload when the
 *                    response passes the dedup gate (e.g. routeFromNotificationData).
 */
export function createNotificationResponseHandler(
  handledIds: Set<string>,
  route: (data: Record<string, string> | undefined) => void,
): (response: {
  notification: { request: { identifier?: string; content: { data?: unknown } } };
}) => void {
  return (response) => {
    const id = response?.notification?.request?.identifier;
    if (id) {
      if (handledIds.has(id)) return;
      handledIds.add(id);
    }
    const rawData = response?.notification?.request?.content?.data;
    // Expo notification payloads are external input. Only forward a plain
    // string-valued record to routing so malformed payloads cannot make a
    // cold-start notification tap crash or create an invalid route.
    if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
      route(undefined);
      return;
    }
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawData as Record<string, unknown>)) {
      if (typeof value === "string") data[key] = value;
    }
    route(Object.keys(data).length > 0 ? data : undefined);
  };
}
