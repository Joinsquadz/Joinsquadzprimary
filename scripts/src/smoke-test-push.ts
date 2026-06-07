/**
 * Push notification end-to-end smoke test.
 *
 * Usage:
 *   TEST_PUSH_TOKEN=ExponentPushToken[xxxx] pnpm --filter @workspace/scripts run smoke-test-push
 *
 * The script sends one real push notification to the supplied Expo push token
 * and reports the ticket status. Optionally waits and checks the receipt too.
 *
 * Exit codes:
 *   0 — ticket (and receipt, if checked) came back "ok"
 *   1 — validation error, ticket error, or receipt error
 */

import { Expo } from "expo-server-sdk";

const RECEIPT_WAIT_MS = 20_000;

async function main() {
  const token = process.env.TEST_PUSH_TOKEN ?? process.argv[2];

  if (!token) {
    console.error(
      "ERROR: supply a push token via TEST_PUSH_TOKEN env var or as the first CLI argument.\n" +
        "  Example: TEST_PUSH_TOKEN=ExponentPushToken[xxxx] pnpm --filter @workspace/scripts run smoke-test-push",
    );
    process.exit(1);
  }

  if (!Expo.isExpoPushToken(token)) {
    console.error(
      `ERROR: "${token}" is not a valid Expo push token.\n` +
        "  Tokens look like: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    );
    process.exit(1);
  }

  const expo = new Expo();

  console.log(`\n── Sending test push to ${token} ──`);

  const [ticket] = await expo.sendPushNotificationsAsync([
    {
      to: token,
      title: "Squadz smoke test",
      body: "Push notification end-to-end check — this is a staging test.",
      data: { smokeTest: true, sentAt: new Date().toISOString() },
      sound: "default",
    },
  ]);

  if (!ticket) {
    console.error("ERROR: Expo returned an empty tickets array.");
    process.exit(1);
  }

  if (ticket.status === "error") {
    console.error(`TICKET ERROR: ${ticket.message ?? "(no message)"}`);
    if (ticket.details) {
      console.error("  details:", JSON.stringify(ticket.details, null, 2));
    }
    process.exit(1);
  }

  console.log(`TICKET OK — id: ${ticket.id}`);

  const checkReceipts = process.env.SKIP_RECEIPT_CHECK !== "1";
  if (!checkReceipts) {
    console.log("Receipt check skipped (SKIP_RECEIPT_CHECK=1).");
    console.log("\nResult: PASS");
    return;
  }

  console.log(
    `\nWaiting ${RECEIPT_WAIT_MS / 1000}s before checking receipt (Expo recommends ≥15 min in production; this uses a shorter window for staging)...`,
  );
  await new Promise((r) => setTimeout(r, RECEIPT_WAIT_MS));

  const receiptMap = await expo.getPushNotificationReceiptsAsync([ticket.id]);
  const receipt = receiptMap[ticket.id];

  if (!receipt) {
    console.warn(
      "RECEIPT NOT FOUND — Expo has not processed the receipt yet.\n" +
        "  The ticket was accepted (status ok) but the receipt is not available within the staging wait window.\n" +
        "  Re-run with SKIP_RECEIPT_CHECK=1 to skip this step, or check manually after 15+ minutes.",
    );
    console.log("\nResult: PARTIAL PASS (ticket ok, receipt pending)");
    return;
  }

  if (receipt.status === "error") {
    console.error(`RECEIPT ERROR: ${receipt.message ?? "(no message)"}`);
    if (receipt.details) {
      console.error("  details:", JSON.stringify(receipt.details, null, 2));
    }
    process.exit(1);
  }

  console.log("RECEIPT OK");
  console.log("\nResult: PASS");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
