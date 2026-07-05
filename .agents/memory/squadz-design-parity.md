---
name: Squadz design source of truth
description: Which Squadz app is the visual source of truth and the design components to keep
---

# Squadz design source of truth

Both apps are active:
- **Web app** (`artifacts/squadz`) — React Vite, previewPath `/`, restored from an earlier commit via `git archive` + `verifyAndReplaceArtifactToml`. The web app is the visual reference.
- **Mobile app** (`artifacts/squadz-native`) — Expo, previewPath `/mobile/`, served via `$REPLIT_EXPO_DEV_DOMAIN` (NOT the shared proxy). Canvas iframe for mobile must be set to the Expo domain URL — it does NOT auto-resolve (url="" is a known issue; must be patched via `applyCanvasActions` update).

**Why:** The web app was accidentally deleted and then restored. Both are now maintained in parallel.

**Mobile design components to preserve:**
- `components/SquadzIcon.tsx` (react-native-svg, gradients #FF5C3A→#FFB547 mark, #1E1E2E→#0A0A14 bg, rx=114 on 512 viewBox). Do NOT reintroduce a PNG image logo.
- `components/GradientButton.tsx` (expo-linear-gradient, #FF5C3A→#FF8050, radius 15, weight 800, accent shadow) for primary CTAs.
- Color tokens in `constants/colors.ts` (accessed via `useColors()`).

# Data layer (mobile)

State is 100% local in-memory React context (`context/AppContext.tsx`) — no persistence
(AsyncStorage intentionally skipped). Squads and events both live in context state with
mutators; event detail must look up its squad via context `getSquad`, not the static
`getSquadById` from `data/mock`, so runtime squad edits (rename/leave/create) stay consistent.
Social login is intentionally simulated (no real OAuth — integrations paused).

# Canvas iframe fix

Expo artifact canvas iframes have `url: ""` by default (platform does not auto-resolve expo-domain URLs).
Fix: `applyCanvasActions` → `update` the shape with `url: "https://$REPLIT_EXPO_DEV_DOMAIN/"`.
