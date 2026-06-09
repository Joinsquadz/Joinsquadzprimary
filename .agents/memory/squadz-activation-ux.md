---
name: Squadz activation/onboarding UX invariants
description: Product/UX rules for the squadz-native onboarding + activation surfaces; respect these, don't regress them.
---

Deliberate activation-focused UX decisions for `artifacts/squadz-native` (mobile only — web `artifacts/squadz` is untouched).

- **No paywall in onboarding.** Onboarding flow is name → create squad (real `addSquad`) → invite crew (climax: RN `Share.share` + invite link/code). Value before payment.
  **Why:** activation requires getting person #2 into a squad fast; a plan/paywall step before any value kills conversion.
- **Invite-crew is the climax**, surfaced again as a persistent Home quick action + onboarding step. Uses squad invite link (`https://joinsquadz.com/squad/join?code=<code>` or `/squad/<id>`), falls back to friendCode link.
- **"Find the Best Time" (availability) must stay discoverable:** prominent gradient CTA near top of Squad Detail (above Members) + Home quick action + empty-state CTA. Don't bury it below photos/members again.
- **No fabricated social proof.** login.tsx uses honest early-access copy (green liveDot), never invented counts like "50k+ squads". Waitlist/counts must be real.
- **Stripe trust signal** ("Secure checkout via Stripe · Cancel anytime" + lock) sits under the Pro upgrade CTA.

**How to apply:** when editing onboarding/login/home/squad-detail/create, preserve these; don't reintroduce paywalls, fake numbers, or hidden availability entry points.

Known residual (pre-existing, out of activation scope): Home bell badge is hardcoded `"4"` — reads as synthetic; replace with a real unread count when that feature is built.
