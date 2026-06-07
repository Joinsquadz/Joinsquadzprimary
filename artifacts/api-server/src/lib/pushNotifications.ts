import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { logger } from "./logger";

const expo = new Expo();

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type SendPushResult = {
  staleTokens: string[];
};

export type SendPushOptions = {
  onStaleToken?: (token: string) => Promise<void>;
};

/**
 * Send push notifications to a list of Expo push tokens.
 * Returns stale tokens (DeviceNotRegistered) so the caller can clean them up.
 * If `onStaleToken` is provided it is called immediately for each stale token.
 * Fire-and-forget style: never throws — all errors are logged.
 */
export async function sendPushNotifications(
  tokens: string[],
  payload: PushPayload,
  options?: SendPushOptions,
): Promise<SendPushResult> {
  const staleTokens: string[] = [];
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return { staleTokens };

  const messages: ExpoPushMessage[] = validTokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: "default",
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    let messageIndex = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const token = validTokens[messageIndex + i];
          if (ticket.status === "error") {
            if (ticket.details?.error === "DeviceNotRegistered") {
              staleTokens.push(token);
              if (options?.onStaleToken) {
                try {
                  await options.onStaleToken(token);
                } catch (err) {
                  logger.error({ err, token }, "Failed to clear stale push token");
                }
              }
            } else {
              logger.warn({ details: ticket.details }, "Push ticket error");
            }
          }
        }
        messageIndex += chunk.length;
      } catch (err) {
        logger.error({ err }, "Failed to send push notification chunk");
        messageIndex += chunk.length;
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to chunk push notifications");
  }

  return { staleTokens };
}
