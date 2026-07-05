# SquadZ UX Craft Sweep — Phase 1 Report
**Flow-by-flow analysis vs. best-in-class consumer apps (Instagram, Partiful, Airbnb)**
*July 5, 2026 · No code changed — analysis only*

## Report card

| # | Flow | Grade | One-line verdict |
|---|------|-------|------------------|
| 1 | First-run / onboarding | **B** | Solid funnel, but signup is long and there's no true "wow" moment |
| 2 | Squad creation + invite | **B+** | Quick-start chips and haptics are great; the *waiting-for-friends* state is dead air |
| 3 | Invite acceptance | **B−** | Growth-critical flow has a signup wall with no squad preview on private links |
| 4 | Event creation | **C+** | One long 10-field form; Partiful would defer 80% of it |
| 5 | Trip + itinerary | **C+** | StopSheet is an 11-field form; proposing is buried in a "Status" toggle |
| 6 | RSVP + attending | **A−** | Best flow in the app: optimistic, haptic, animated conflict warning, host celebration |
| 7 | Voting on stops | **C** | Spinner-gated, count-only, no avatars, no haptic — feels like a form, not a social act |
| 8 | Packing list | **C** | Check-off waits on the server with a whole-screen busy state; no haptic |
| 9 | Day-of experience | **D+** | Biggest gap: the app goes quiet at the moment of highest engagement |
| 10 | Post-event | **B−** | Vault nudges exist, but the Past tab is a flat archive with no recap moment |
| 11 | Upgrade / paywall | **B+** | Well-timed, fair, good copy; only presentation polish needed |
| 12 | Returning-user home | **B+** | Up Next hero + skeletons are strong; pending votes/actions aren't surfaced |

**Cross-cutting craft debt** (affects every flow):
- **Two interaction tiers exist.** RSVP/tasks are optimistic with haptics; trips (votes, packing, stops) use a `runMut` wrapper that sets a whole-screen `busy` flag and waits for the server. The app feels premium in events and laggy in trips.
- **Skeletons only on Home.** Vault, availability, and detail screens still use bare `ActivityIndicator` spinners.
- **No in-memory screen cache for detail screens.** Home renders instantly from `AppContext`, but event/trip/squad detail screens fetch on mount — brief blank/spinner on every navigation.
- **Icons are consistent** (Ionicons throughout) and the brand gradient is used with discipline. Dark-theme surface layering is decent but flat in list-heavy screens (Past tab, packing list).

---

## Flow 1 — First-run · **B**

**What exists:** Login screen sells value ("Stop texting. Start actually hanging." + feature pills) → signup (5 fields + optional phone) → onboarding step 0 (create squad, name chips + emoji) → step 1 (invite link + share) → Home. Zero-squad Home shows a "👋 Let's get your crew together" card with a gradient CTA. A 5-step coach tour arms after onboarding.

**Gaps vs. best-in-class:**
- Signup asks for **6 inputs before any value** (first, last, email, phone, password). Partiful gets you in with ~2.
- No wow moment: onboarding is functional, not delightful. Creating your *first squad* is a milestone — it deserves a celebration beat (the `CelebrationOverlay` component already exists and is only used for streaks/first-RSVP).
- The zero-squad Home card is good copy but static — it doesn't *show* what the app does (no illustration of the availability heatmap, event card, etc.).

**Improvements (ranked):**
1. **P1** — Celebration beat when the first squad is created (reuse `CelebrationOverlay`, subtle).
2. **P1** — Zero-squad Home upgraded to a mini "landing page": show a beautiful non-interactive preview of an event card/heatmap so the empty app sells the product.
3. **P2** — Collapse signup: single "Name" field, defer phone entirely (it's already optional).

## Flow 2 — Squad creation + invite · **B+**

**What exists:** 1–2 taps to reach create; only Name required; Quick-Start category chips pre-fill name+emoji; haptics on all controls. Post-create lands in the squad with "Just you so far" + "Invite your crew" section, one-time long-press hint animation. Share copy is good. Member joins arrive live via SSE.

**Gaps:**
- **Waiting is dead air.** After sharing, the inviter sees a static member list of one. No "invite sent · waiting" state, no acknowledgment when someone *opens* the link, no gentle celebration when the first friend joins.
- Squad creation button is spinner-gated ("Creating…") — acceptable, but the transition to the squad screen is a hard replace.

**Improvements:**
1. **P0** — First-member-joined moment: when SSE delivers a new member, animate the avatar in and show a one-time "🎉 [Name] joined!" toast/celebration for the creator.
2. **P1** — Pending-invite rows in the member list ("Invited · waiting") so the squad never looks like a party of one after you've invited people.

## Flow 3 — Invite acceptance (growth-critical) · **B−**

**What exists:** Link → `join.tsx`/`join-public.tsx`. Public squads get a preview (emoji, name, member count). Not-logged-in users are hard-redirected to `/login` with params preserved; after auth they land on an accept screen → success checkmark → "View Squad →".

**Gaps:**
- **Private invite links show a generic "You're Invited" hero** — no squad name, emoji, or who invited you. Best-in-class (Partiful invites) leads with *who and what* before asking anything.
- The redirect to login is a **hard cut** with no context carried visually — the recipient loses sight of what they were joining during a 6-field signup.
- Two extra screens between auth and being *in* the squad (accept screen + success screen). Every screen here costs members.

**Improvements:**
1. **P0** — Rich preview on private invite links: server already knows squadName/emoji from the invite code — show "🎿 Ski Crew · 4 members · invited by Maya" *before* signup, and keep a compact banner of it on the login/signup screen ("Joining 🎿 Ski Crew after you sign up").
2. **P1** — Auto-accept after auth when arriving via invite link: skip the accept screen, land directly in the squad with a welcome state (success screen becomes an in-squad banner).

## Flow 4 — Event creation · **C+**

**What exists:** Single long form in `create.tsx`: kind toggle, emoji, title, location, date/time, description, squad, public toggle, invites, end time. Only kind + title required. Date defaults to *now*; squad only preselected when arriving from a squad screen. Min ~3 taps but the form *looks* heavy. `router.replace` to the event after — no beat, no share prompt.

**Gaps vs. Partiful (the stated bar):**
- Partiful's flow is title-first, everything else progressive. SquadZ shows all 10 fields at once — high perceived effort even when 8 are optional.
- Defaults aren't smart: "now" is almost never the event time (best-in-class defaults to the next Friday/Saturday evening); most-recent/only squad should be preselected always.
- No post-create moment: no celebration, no immediate "invite the squad / share" prompt — creation just cuts to the detail screen.

**Improvements:**
1. **P0** — Progressive disclosure: title + date + squad above the fold; collapse location/description/end-time/public/invites behind an "Add details" expander. (Pure reorganization, no data-model change.)
2. **P0** — Smart defaults: date defaults to next Saturday 7pm (round upcoming weekend); squad defaults to the user's only/most-recently-active squad.
3. **P1** — Post-create beat: success haptic + brief created-state, with a primary "Share with the squad" affordance.

## Flow 5 — Trip creation + itinerary · **C+**

**What exists:** Trip = kind toggle in the same create form (adds date range). Stops added via `StopSheet` — 11 fields (title required; day, times, category, place, address, cost, assignee, note, status). Proposed-vs-confirmed is a "Status" toggle inside the sheet. Stops group by day with headings.

**Gaps:**
- **Adding a stop is data entry.** Best-in-class would be: type a title, pick a day chip, done — refine later. 11 visible fields kills the "let's throw ideas in" energy.
- "Proposed vs Confirmed" as a form field is the wrong mental model. The social framing is *"Suggest this"* vs *"Lock it in"* — it should be the action button, not a status dropdown.
- Itinerary building has no collaborative feel: no attribution ("Maya suggested this"), votes are a number.

**Improvements:**
1. **P0** — Quick-add mode in StopSheet: title + day + category above the fold, everything else behind "More details". Submit buttons become "Suggest" / "Add to plan" (permission-aware).
2. **P1** — Suggested-by attribution on proposed stop cards.

## Flow 6 — RSVP + attending · **A−**

**What exists:** Optimistic RSVP via `AppContext.setRsvp`, per-button pending spinner, success haptic. Conflict detection (`lib/conflicts.ts`) shows an animated non-blocking banner ("2 other plans on this day") with field highlighting. Host gets a `CelebrationOverlay` on first guest RSVP. Guests tab shows status-colored attendees + pending list.

**Gaps (minor):**
- After RSVPing "Going", there's no forward pull — no "add to calendar", no social proof moment ("You + 4 others are going").
- The Maybe/No paths give no feedback beyond state change.

**Improvements:**
1. **P2** — Post-RSVP micro-moment: brief inline confirmation with attendee avatars ("You're in — 4 going 🎉").

## Flow 7 — Voting on proposed stops · **C**

**What exists:** Heart button per proposed stop; `runMut` spinner-gated (whole-screen `busy`), vote shown as a bare count (`3` or "Vote"), no avatars, no haptic on the vote itself. Host confirms via a checkmark button.

**Gaps:** This should be the *most* social interaction in trips and it currently feels like submitting a form. Instagram-tier apps make the vote instant, springy, and show *who* voted.

**Improvements:**
1. **P0** — Optimistic vote toggle with haptic + scale/spring animation on the heart; reconcile via existing SSE.
2. **P0** — Voter avatar stack (up to 3 + overflow count) on each proposed stop.
3. **P1** — Confirmation moment when the host locks a stop in (stop card animates to confirmed, light haptic for viewers via SSE refresh).

## Flow 8 — Packing list · **C**

**What exists:** Text input + Add; tap to toggle done via `patchPacking`, spinner-gated through `runMut` (whole-screen busy); assignee avatar renders if set.

**Gaps:** Check-off is *the* canonical optimistic interaction (Things, Apple Reminders — instant tick + haptic). Here it visibly lags.

**Improvements:**
1. **P0** — Optimistic check-off: instant strikethrough + light haptic, reconcile on 409/error by reverting with a toast.
2. **P2** — Checked items sink to the bottom with a layout animation; progress line ("6 of 9 packed").

## Flow 9 — Day-of experience · **D+**

**What exists:** Event detail shows "Starts in Xh Ym"/"Happening now" within 24h; active trips float up in the Trips segment. That's it — nothing on Home, no day-of mode.

**Gaps:** This is the moment of highest real-world engagement and the app is silent. The user must *dig into the detail screen* to see even the countdown. Best-in-class: Partiful's day-of text blasts, Airbnb's trip-in-progress home takeover.

**Improvements:**
1. **P0** — "Today" takeover of the Home hero: when a plan is today/in-progress, the Up Next card switches to a live day-of variant — countdown/"Happening now", location one-tap (opens maps), today's itinerary stops for trips, quick access to the plan's chat.
2. **P1** — During a trip, the trip screen defaults to today's day group scrolled into view.

## Flow 10 — Post-event · **B−**

**What exists:** Past segment in the plans hub (flat cards + clock icon), `recapPromptSentAt` photo nudge, "5 new photos in 🍕 Dinner" banner, personal vault with favorites (Squadz+).

**Gaps:** No closure moment. An ended plan just… moves lists. No recap ("12 photos · 6 went · $340 split"), nothing pulling the squad back to relive it.

**Improvements:**
1. **P1** — Recap strip on past event/trip detail: photo count, attendance, cost summary — assembled from data that already exists.
2. **P2** — Past cards show a photo thumbnail strip when vault photos exist (visual memory > text row).

## Flow 11 — Upgrade / paywall · **B+**

**What exists:** `UpgradeModal` with trigger-specific headlines, Free-vs-Squadz+ comparison, Founding Member pricing, "Not now" escape, Stripe checkout with foreground polling, gold-ring avatar celebration on success.

**Gaps (presentation only, per constraints):** Cap errors surface as the modal *after* a failed attempt; the create/join affordances don't foreshadow remaining allowance ("4 of 5 plans used"), so hitting the wall feels sudden.

**Improvements:**
1. **P2** — Show remaining allowance passively near the gate (e.g., a quiet "4/5 plans this year" caption on create) so the cap is never a surprise. Gates themselves unchanged.

## Flow 12 — Returning-user home · **B+**

**What exists:** Greeting header, live status banner, quick actions, orange Up Next hero, streaks, squads row, upcoming row, balances (only when nonzero), "For You" suggestions. Skeletons for hero + squads. Data from `AppContext` + SSE, so reopen is fast.

**Gaps:**
- **Pending actions aren't surfaced**: open votes on proposed stops, unanswered RSVPs, and availability polls awaiting your response never appear on Home — the exact things a returning user should handle in 10 seconds.
- Below the hero, everything has uniform visual weight.
- Detail screens aren't prefetched — tapping a squad/event shows a spinner beat that Home never has.

**Improvements:**
1. **P0** — "Needs you" row under the hero: pending RSVPs, open stop votes, unanswered availability polls — each a one-tap deep link. (Derivable from existing `events`/polls data already in context.)
2. **P1** — Prefetch detail data for the Up Next event and top squads while Home is idle.
3. **P2** — Skeletons for the Upcoming and For You sections (currently only hero + squads).

---

## Ranked implementation plan (proposed)

**P0 — the gap between "works" and "feels premium"** (highest impact)
1. Trip interaction overhaul: optimistic votes + haptics + voter avatars; optimistic packing check-off; StopSheet quick-add with "Suggest / Add to plan" actions (flows 5, 7, 8)
2. Day-of Home takeover: live hero variant for today's plan (flow 9)
3. Event creation: progressive disclosure + smart defaults (next-weekend date, squad preselect) (flow 4)
4. Invite acceptance: rich squad preview on private links + auto-accept after auth (flow 3)
5. "Needs you" row on Home (flow 12)
6. First-member-joined celebration for squad creators (flow 2)

**P1 — depth and delight**
7. First-squad celebration + richer zero-squad landing state (flow 1)
8. Pending-invite rows in squad member list (flow 2)
9. Suggested-by attribution on proposed stops; host lock-in moment (flows 5, 7)
10. Post-create share beat for events (flow 4)
11. Past-plan recap strip (flow 10)
12. Prefetch Up Next / top-squad details (flow 12)

**P2 — polish**
13. Signup collapse (single name field, defer phone) (flow 1)
14. Post-RSVP social-proof micro-moment (flow 6)
15. Packing progress + sink-checked-items animation (flow 8)
16. Photo thumbnails on past cards (flow 10)
17. Passive allowance captions near freemium gates (flow 11)
18. Skeleton coverage for remaining Home sections + vault/availability (flow 12)

**Constraint compliance:** every item above is squad-scoped, intent-explicit, uses the existing brand system, changes zero freemium gate logic, and needs no new dependencies (Reanimated/Animated, expo-haptics, and CelebrationOverlay all already exist in the app).

**Regression guard:** after Phase 2, the standing 10-user simulation from the July 5 audit will be re-run and all 34 checks confirmed passing.
