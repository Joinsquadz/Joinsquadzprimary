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
 * In-memory map of pending ticket IDs → push token.
 * Populated by sendPushNotifications (ok tickets) and consumed by
 * checkPushReceipts. Exposed for test resets only — do not mutate in
 * production code outside this module.
 */
export const _pendingTickets: Map<string, string> = new Map();

/**
 * Send push notifications to a list of Expo push tokens.
 * Returns stale tokens (DeviceNotRegistered) so the caller can clean them up.
 * If `onStaleToken` is provided it is called immediately for each stale token.
 * Successful ticket IDs are stored in `_pendingTickets` for later receipt
 * checking via `checkPushReceipts`.
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
          } else if (ticket.status === "ok") {
            _pendingTickets.set(ticket.id, token);
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

/**
 * Fetch Expo push receipts for all pending ticket IDs and clean up any tokens
 * that APNs/FCM has since rejected (DeviceNotRegistered).
 *
 * Call this on a periodic schedule (e.g. every 15 minutes) — Expo recommends
 * checking receipts at least 15 minutes after the original send so APNs/FCM
 * has had time to deliver and report back.
 *
 * Processed ticket IDs are always removed from the pending set (whether they
 * succeeded, errored, or were not found in the receipt response).
 */
export async function checkPushReceipts(
  options?: SendPushOptions,
): Promise<SendPushResult> {
  const staleTokens: string[] = [];
  const ticketIds = [..._pendingTickets.keys()];
  if (ticketIds.length === 0) return { staleTokens };

  const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);

  for (const chunk of chunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const receiptId of chunk) {
        const token = _pendingTickets.get(receiptId);
        _pendingTickets.delete(receiptId);

        const receipt = receipts[receiptId];
        if (!receipt || !token) continue;

        if (
          receipt.status === "error" &&
          receipt.details?.error === "DeviceNotRegistered"
        ) {
          staleTokens.push(token);
          if (options?.onStaleToken) {
            try {
              await options.onStaleToken(token);
            } catch (err) {
              logger.error(
                { err, token },
                "Failed to clear stale push token from receipt check",
              );
            }
          }
        } else if (receipt.status === "error") {
          logger.warn(
            { receiptId, details: receipt.details },
            "Push receipt error (non-stale)",
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to fetch push receipts chunk");
    }
  }

  return { staleTokens };
}
