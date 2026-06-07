import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { logger } from "./logger";

const expo = new Expo();

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Send push notifications to a list of Expo push tokens.
 * Silently swaps out invalid tokens (caller is responsible for removing them
 * from the DB if needed). Fire-and-forget: never throws — all errors are logged.
 */
export async function sendPushNotifications(
  tokens: string[],
  payload: PushPayload,
): Promise<void> {
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return;

  const messages: ExpoPushMessage[] = validTokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: "default",
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === "error") {
            logger.warn({ details: ticket.details }, "Push ticket error");
          }
        }
      } catch (err) {
        logger.error({ err }, "Failed to send push notification chunk");
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to chunk push notifications");
  }
}
