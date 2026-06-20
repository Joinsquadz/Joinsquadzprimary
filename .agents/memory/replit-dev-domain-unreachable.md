---
name: Replit dev domain unreachable from a user's network
description: How to diagnose "user can't sign in / Expo Go never loads" when the real cause is the user's network blocking *.replit.dev, not the code.
---

When a user reports they can't sign in / the Expo Go app "never downloads" / "page won't load", and NONE of their requests appear in the api-server logs, the cause is usually the **device/network never reaching the Replit dev server** — not auth, not the code.

**Diagnostic ladder (cheap → decisive):**
1. Check api-server logs for the user's login attempt. If the ONLY entries are your own curl tests, the request never arrived — stop suspecting auth.
2. Confirm auth actually works: admin-set a known temp password, then POST `/api/auth/login` through the **public** `$REPLIT_DEV_DOMAIN` URL (not localhost). 200 + token ⇒ auth is fine.
3. Distinguish in-container vs external reachability. **In-container `curl`/the `screenshot` tool do NOT prove external reachability** (internal DNS can resolve `$REPLIT_DEV_DOMAIN` to the local service, and screenshots of JSON render blank/inconclusive). Use `webFetch({url})` from the code-execution sandbox — it fetches from a truly external service. `{"status":"ok"}` back ⇒ the dev URL is genuinely public.
4. Have the user open `https://<dev-domain>/api/healthz` in plain **Safari** (bypasses Expo Go). "Page won't load" on a URL that `webFetch` reaches ⇒ the user's network is the blocker.
5. Rule out device-level: wrong **Date & Time** (breaks HTTPS on every network), VPN/DNS/config profiles, Screen Time content restrictions, managed phone. If it fails on a **second device** too, it's the network/ISP/region, not the device.

**Why:** Expo Go dev depends on the phone reaching `*.replit.dev` (Metro tunnel `expo.kirk.replit.dev` for the JS bundle + `kirk.replit.dev` for the API). Some ISPs/regions block Replit domains wholesale → the dev workflow is simply unusable there, and no code change fixes it.

**How to apply / resolution:** The durable fix is NOT a code change. It is (a) confirm by trying a genuinely different network/location or a friend elsewhere opening the link, and (b) move off the dev tunnel: publish a production deployment (ideally a **custom domain** like joinsquadz.com, since `.replit.app` is still Replit infra that a Replit-blocking ISP may also block) + a standalone EAS build that bundles the JS and points at the production API. Expo Go cannot help a user whose network blocks `*.replit.dev`.
