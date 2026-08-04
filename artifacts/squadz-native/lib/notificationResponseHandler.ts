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
    const data = response.notification.request.content.data as
      | Record<string, string>
      | undefined;
    route(data);
  };
}
