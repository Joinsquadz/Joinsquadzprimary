---
name: Squadz design source of truth
description: Which Squadz app is the visual source of truth and the design components to keep
---

# Squadz design source of truth

The **mobile app** (`artifacts/squadz-native`) is now the standalone visual source of truth.
The web app (`artifacts/squadz`) was removed, so do NOT redesign the mobile app to match a web
reference — preserve the mobile design as-is and only fix functionality.

**Why:** The mobile design was first aligned to the (then-canonical) web app, then the web
artifact was deleted. Subsequent functional work was scoped to "do not redesign mobile."

**How to apply:**
- Keep the native `components/SquadzIcon.tsx` (react-native-svg, gradients #FF5C3A→#FFB547 mark,
  #1E1E2E→#0A0A14 bg, rx=114 on 512 viewBox). Do NOT reintroduce a PNG image logo.
- Keep `components/GradientButton.tsx` (expo-linear-gradient, #FF5C3A→#FF8050, radius 15,
  weight 800, accent shadow) for primary CTAs. Avoid flat `backgroundColor: colors.primary`
  primary buttons in auth/landing flows.
- Color tokens live in `constants/colors.ts` (accessed via `useColors()`): card, primary,
  mutedForeground, destructive, border, green, surface, surfaceUp, textDim, foreground, etc.

# Data layer

State is 100% local in-memory React context (`context/AppContext.tsx`) — no persistence
(AsyncStorage intentionally skipped). Squads and events both live in context state with
mutators; event detail must look up its squad via context `getSquad`, not the static
`getSquadById` from `data/mock`, so runtime squad edits (rename/leave/create) stay consistent.
Social login is intentionally simulated (no real OAuth — integrations paused).
