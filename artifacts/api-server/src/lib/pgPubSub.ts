import pg from "pg";
import { EventEmitter } from "events";
import { resolveDbConfig } from "@workspace/db";
import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Postgres LISTEN/NOTIFY pub/sub bridge.
 *
 * Problem: the existing event emitters (`squadEvents.ts`, `activityEvents.ts`,
 * etc.) use in-process Maps/EventEmitters. In a single-instance deployment
 * this is fine. Under Replit autoscale, a mutation handled by instance A only
 * notifies SSE clients connected to instance A — instance B clients wait up to
 * 20 s for their poll fallback.
 *
 * Solution: every `emitX()` call fires `pg_notify(channel, payload)`. A
 * single dedicated pg.Client per instance issues `LISTEN channel` for each
 * channel type. When any instance publishes, Postgres fans the notification to
 * ALL listening instances simultaneously. Each instance's LISTEN client
 * receives the notification and fires the local EventEmitter, waking every SSE
 * client on that instance.
 *
 * Channels (one per logical event type, payload = entity id):
 *   squadz_squad      – squad mutations
 *   squadz_activity   – activity feed updates (per userId)
 *   squadz_feed       – vibe feed updates (per userId)
 *   squadz_conv       – conversation messages (per conversationId)
 *   squadz_poll       – availability poll updates (per pollId)
 *   squadz_event      – event mutations (per eventId)
 *   squadz_vault      – vault photo interactions (per photoId)
 */

// ---------------------------------------------------------------------------
// Local fan-out emitter (same-instance delivery, keyed as "channel:payload")
// ---------------------------------------------------------------------------
const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(0);

// ---------------------------------------------------------------------------
// LISTEN client – one dedicated connection per process
// ---------------------------------------------------------------------------
const CHANNELS = [
  "squadz_squad",
  "squadz_activity",
  "squadz_feed",
  "squadz_conv",
  "squadz_poll",
  "squadz_event",
  "squadz_vault",
] as const;

export type PgChannel = (typeof CHANNELS)[number];

let listenClient: pg.Client | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function connect(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const cfg = resolveDbConfig();
  // LISTEN connections must be direct (not pooled) because the listener state
  // is tied to the connection lifetime. Strip the pool-specific fields.
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port as number | undefined,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl as pg.ConnectionConfig["ssl"],
    connectionTimeoutMillis: Number(
      process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? "5000",
    ),
  });

  client.on("notification", (msg) => {
    if (!msg.channel || msg.payload === undefined) return;
    // Wake every SSE subscriber on this instance for this entity.
    localEmitter.emit(`${msg.channel}:${msg.payload}`);
  });

  client.on("error", (err) => {
    logger.error("[pgPubSub] LISTEN client error — scheduling reconnect", {
      message: (err as Error).message,
    });
    void scheduleReconnect();
  });

  client.on("end", () => {
    logger.warn("[pgPubSub] LISTEN client disconnected — scheduling reconnect");
    void scheduleReconnect();
  });

  await client.connect();

  // Subscribe to all channels atomically.
  for (const ch of CHANNELS) {
    await client.query(`LISTEN ${ch}`);
  }

  listenClient = client;
  logger.info("[pgPubSub] LISTEN client connected", {
    channels: CHANNELS.join(", "),
  });
}

let reconnecting = false;

async function scheduleReconnect(): Promise<void> {
  if (reconnecting) return;
  reconnecting = true;
  listenClient = null;

  const delay = 2_000;
  reconnectTimer = setTimeout(() => {
    reconnecting = false;
    connect().catch((err) => {
      logger.error("[pgPubSub] Reconnect attempt failed", {
        message: (err as Error).message,
      });
      void scheduleReconnect();
    });
  }, delay);
}

/**
 * Start the LISTEN client. Call once at server startup.
 */
export async function initPgPubSub(): Promise<void> {
  await connect();
}

// ---------------------------------------------------------------------------
// Publish (fire-and-forget — any instance can call this)
// ---------------------------------------------------------------------------

/**
 * Publish an event to all instances via Postgres NOTIFY.
 * Falls back silently (the 20 s poll fallback covers the gap) if the pool
 * query fails — we never want a NOTIFY failure to bubble into a request error.
 */
export function pgNotify(channel: PgChannel, payload: string): void {
  pool
    .query("SELECT pg_notify($1, $2)", [channel, payload])
    .catch((err: unknown) => {
      logger.error("[pgPubSub] pg_notify failed", {
        channel,
        payload,
        message: (err as Error).message,
      });
    });
}

// ---------------------------------------------------------------------------
// Subscribe (per-instance, per-SSE-client)
// ---------------------------------------------------------------------------

/**
 * Subscribe to notifications for a specific entity on this instance.
 * Returns an unsubscribe function to call when the SSE connection closes.
 */
export function pgSubscribe(
  channel: PgChannel,
  id: string,
  handler: () => void,
): () => void {
  const key = `${channel}:${id}`;
  localEmitter.on(key, handler);
  return () => localEmitter.off(key, handler);
}
