import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { logger } from "./logger";
import { storage } from "../storage";

const expo = new Expo();

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type SendPushResult = {
  staleTokens: string[];
  /** Number of messages Expo accepted (tickets with status "ok"). */
  okCount: number;
  /**
   * True if any chunk failed to submit, or any ticket errored for a
   * non-stale reason. Callers needing fire-once semantics (e.g. the event
   * reminder scan) should treat this as "do not mark sent; retry later".
   */
  hadSendError: boolean;
};

export type SendPushOptions = {
  onStaleToken?: (token: string) => Promise<void>;
};

/**
 * In-memory map of pending ticket IDs → push token.
 * Populated by sendPushNotifications (ok tickets) and consumed by
 * checkPushReceipts. Also persisted to the `push_tickets` DB table so that
 * a server restart during the 15-minute window does not lose the ticket IDs.
 * Exposed for test resets only — do not mutate in production code outside
 * this module.
 */
export const _pendingTickets: Map<string, string> = new Map();

/**
 * Load persisted push ticket IDs from the database into the in-memory map.
 * Call once at server startup so that any tickets saved before a restart are
 * picked up by the next `checkPushReceipts` run.
 */
export async function initPushTickets(): Promise<void> {
  try {
    const rows = await storage.loadAllPushTickets();
    for (const [ticketId, pushToken] of rows) {
      _pendingTickets.set(ticketId, pushToken);
    }
    if (rows.size > 0) {
      logger.info(
        { count: rows.size },
        "Loaded pending push tickets from DB after startup",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to load pending push tickets from DB");
  }
}

/**
 * Send push notifications to a list of Expo push tokens.
 * Returns stale tokens (DeviceNotRegistered) so the caller can clean them up.
 * If `onStaleToken` is provided it is called immediately for each stale token.
 * Successful ticket IDs are stored in `_pendingTickets` for later receipt
 * checking via `checkPushReceipts`, and also persisted to the DB so they
 * survive server restarts.
 * Fire-and-forget style: never throws — all errors are logged.
 */
export async function sendPushNotifications(
  tokens: string[],
  payload: PushPayload,
  options?: SendPushOptions,
): Promise<SendPushResult> {
  const staleTokens: string[] = [];
  let okCount = 0;
  let hadSendError = false;
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (validTokens.length === 0) return { staleTokens, okCount, hadSendError };

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
              hadSendError = true;
              logger.warn({ details: ticket.details }, "Push ticket error");
            }
          } else if (ticket.status === "ok") {
            okCount++;
            _pendingTickets.set(ticket.id, token);
            storage.storePushTicket(ticket.id, token).catch((err) => {
              logger.error({ err, ticketId: ticket.id }, "Failed to persist push ticket to DB");
            });
          }
        }
        messageIndex += chunk.length;
      } catch (err) {
        hadSendError = true;
        logger.error({ err }, "Failed to send push notification chunk");
        messageIndex += chunk.length;
      }
    }
  } catch (err) {
    hadSendError = true;
    logger.error({ err }, "Failed to chunk push notifications");
  }

  return { staleTokens, okCount, hadSendError };
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
 * succeeded, errored, or were not found in the receipt response) and deleted
 * from the DB.
 */
/** Receipt checking only resolves stale tokens; it sends nothing, so it has no
 * send-side counters (okCount/hadSendError) like {@link SendPushResult}. */
export type ReceiptCheckResult = { staleTokens: string[] };

export async function checkPushReceipts(
  options?: SendPushOptions,
): Promise<ReceiptCheckResult> {
  const staleTokens: string[] = [];
  const ticketIds = [..._pendingTickets.keys()];
  if (ticketIds.length === 0) return { staleTokens };

  const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  const processedTicketIds: string[] = [];

  for (const chunk of chunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const receiptId of chunk) {
        const token = _pendingTickets.get(receiptId);
        _pendingTickets.delete(receiptId);
        processedTicketIds.push(receiptId);

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

  if (processedTicketIds.length > 0) {
    storage.deletePushTickets(processedTicketIds).catch((err) => {
      logger.error({ err }, "Failed to delete processed push tickets from DB");
    });
  }

  return { staleTokens };
}
