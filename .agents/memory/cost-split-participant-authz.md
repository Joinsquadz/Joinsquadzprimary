---
name: Cost-split participant authorization
description: Why event-cost payer/share user IDs and payment-handle disclosure must be validated against SQUAD membership, not getEventAsMember.
---

# Cost-split participant authorization

Any user ID that appears in an event cost (`paidById` and each `shares[].userId`) must be validated against the **event's squad membership** — the set built from `squad.memberIds` (for squad events) plus the host and anyone who RSVP'd. Each user may appear at most once per cost. The same allowed-set gates which users' payment handles `GET /events/:id/payment-handles` will disclose.

**Why:** the mobile cost UI assigns shares among `squad.memberIds`, NOT among RSVP participants, so validating against `getEventAsMember` semantics (host + RSVP keys only) would reject legitimate costs. But leaving payer/shares unvalidated lets any authenticated event member inject arbitrary external user IDs into a cost, which would (a) spoof debts and mis-fire "you owe {requester}" pushes to unintended users and (b) leak those users' Venmo/CashApp/Zelle handles via the payment-handles endpoint.

**How to apply:** use the shared `allowedParticipantIds(event)` helper in `artifacts/api-server/src/routes/events.ts` for both the costs POST validation and the payment-handles response. If you add any new endpoint that reads/writes cost participants or exposes per-user payment data, gate it through the same helper.
