---
name: Webhook email dedup
description: How transactional emails sent from Stripe webhook handlers are deduplicated against Stripe retry deliveries.
---

# Webhook email dedup

## The rule
Any transactional email triggered from a webhook handler (`webhookHandlers.ts`) **must** call `markEmailSent(key)` from `lib/emailDedup.ts` before sending. Only send if `markEmailSent` returns `true`.

## Dedup keys in use
- `welcome:{subscriptionId}` — Pro welcome email on `checkout.session.completed`
- `renewal:{invoiceId}` — renewal receipt on `invoice.payment_succeeded`
- `payment_failed:{invoiceId}` — payment failure warning on `invoice.payment_failed`

## Implementation
- `lib/emailDedup.ts` — exports `ensureEmailDedupTable()` and `markEmailSent(key)`
- `webhook_email_sends` table is **raw SQL** (CREATE TABLE IF NOT EXISTS) — it is NOT in the Drizzle schema; do not look for it in `lib/db/src/schema/`
- `ensureEmailDedupTable()` is called once at server startup in `index.ts` (after `initStripe()`)
- `markEmailSent` inserts with ON CONFLICT DO NOTHING RETURNING; returns `true` = first delivery, `false` = duplicate suppressed
- On DB failure, `markEmailSent` returns `true` (allow send) rather than silently dropping transactional emails

**Why:** Stripe retries webhooks on non-2xx responses. The founding-spot path is idempotent separately; the email sends were not. Renewal receipts are financial documents; duplicates cause real user confusion/alarm.

**How to apply:** Add new webhook emails the same way — one dedup key per logically-unique event (use the Stripe object ID as the discriminator).
