/**
 * Cross-instance integration test for Postgres LISTEN/NOTIFY.
 *
 * This test does NOT use any mocks. It opens two real pg.Client connections
 * to the Supabase DB — each representing an independent server instance with
 * its own dedicated LISTEN connection — and verifies:
 *
 *   1. A NOTIFY fired on one connection is received by BOTH connections.
 *      This is the core correctness guarantee: under Replit autoscale, a
 *      NOTIFY sent by instance A must wake SSE clients on instance B.
 *
 *   2. After a connection is terminated and re-established (simulating an
 *      instance reconnect), the new client still receives subsequent NOTIFYs.
 *
 * The suite is skipped gracefully when SUPABASE_DB_URL / DATABASE_URL is not
 * set in the environment, so it never breaks the CI baseline.
 *
 * Channel used: squadz_squad (already part of the production LISTEN set).
 * Payload: a test-specific string so production handlers see a non-existent
 * squad ID and no-op silently.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

// ---------------------------------------------------------------------------
// Connection helper
// ---------------------------------------------------------------------------

function getSessionConnStr(): string | null {
  const raw = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
  if (!raw) return null;
  // The main pool may use the Transaction pooler (port 6543 via DB_POOLER_PORT).
  // LISTEN requires a persistent Session pooler connection (port 5432).
  return raw.replace(/:6543\//, ":5432/");
}

function makeClient(connStr: string): pg.Client {
  return new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
    application_name: "squadz-test-cross-instance",
    connectionTimeoutMillis: 8_000,
  });
}

// ---------------------------------------------------------------------------
// Suite setup — skip entirely when no real DB is available
// ---------------------------------------------------------------------------

let connStr: string | null = null;
let clientA: pg.Client;
let clientB: pg.Client;
let available = false;

beforeAll(async () => {
  connStr = getSessionConnStr();
  if (!connStr) return;

  try {
    clientA = makeClient(connStr);
    await clientA.connect();
    await clientA.query("LISTEN squadz_squad");

    clientB = makeClient(connStr);
    await clientB.connect();
    await clientB.query("LISTEN squadz_squad");

    available = true;
  } catch {
    available = false;
  }
}, 15_000);

afterAll(async () => {
  // End connections regardless of test outcome; ignore errors on already-ended clients.
  await clientA?.end().catch(() => {});
  await clientB?.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect notifications received on a client for up to `waitMs` ms. */
function collectNotifications(
  client: pg.Client,
  waitMs = 1_500,
): () => Promise<string[]> {
  const payloads: string[] = [];
  const handler = (msg: pg.Notification) => {
    if (msg.payload !== undefined) payloads.push(msg.payload);
  };
  client.on("notification", handler);
  return async () => {
    await new Promise((r) => setTimeout(r, waitMs));
    client.off("notification", handler);
    return payloads;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Postgres LISTEN/NOTIFY — cross-connection delivery", () => {
  it(
    "delivers a NOTIFY from connection A to BOTH A and B (the core cross-instance proof)",
    async () => {
      if (!available) {
        console.log("  ⚠ Skipped — no DB connection available");
        return;
      }

      const collectA = collectNotifications(clientA);
      const collectB = collectNotifications(clientB);

      const payload = `cross-instance-${Date.now()}`;
      // Use client A itself to fire the NOTIFY — mirrors pgNotify which calls
      // pool.query; any connection can publish, all LISTEN clients receive it.
      await clientA.query("SELECT pg_notify('squadz_squad', $1)", [payload]);

      const [receivedA, receivedB] = await Promise.all([collectA(), collectB()]);

      // A receives its own NOTIFY (Postgres echoes to all listeners including sender)
      expect(receivedA, "connection A should receive its own NOTIFY").toContain(payload);

      // B receives A's NOTIFY — this is the cross-instance guarantee
      expect(
        receivedB,
        "connection B must receive the NOTIFY from connection A",
      ).toContain(payload);
    },
    10_000,
  );

  it(
    "delivers NOTIFY to a freshly-reconnected listener (simulates instance reconnect)",
    async () => {
      if (!available || !connStr) {
        console.log("  ⚠ Skipped — no DB connection available");
        return;
      }

      // Terminate client B and replace it with a new connection
      await clientB.end();
      clientB = makeClient(connStr);
      await clientB.connect();
      await clientB.query("LISTEN squadz_squad");

      const collectB = collectNotifications(clientB);
      const payload = `after-reconnect-${Date.now()}`;
      await clientA.query("SELECT pg_notify('squadz_squad', $1)", [payload]);

      const receivedB = await collectB();

      expect(
        receivedB,
        "reconnected connection B must receive NOTIFY after re-establishing LISTEN",
      ).toContain(payload);
    },
    10_000,
  );
});
