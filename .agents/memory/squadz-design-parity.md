---
name: Squadz cross-platform design parity
description: Which app is the visual source of truth and how the mobile app mirrors it
---

# Squadz design source of truth

The **web app** (`artifacts/squadz`) is the canonical visual reference. The **mobile app**
(`artifacts/squadz-native`) must mirror it, not the other way around.

**Why:** User explicitly designated web as source of truth when the two drifted (mobile had a
circular `icon.png` logo + flat solid buttons; web had a clean rounded-square gradient Z + orange
gradient buttons).

**How to apply:**
- Logo: use the native `components/SquadzIcon.tsx` (react-native-svg) which mirrors web
  `src/components/SquadzIcon.tsx` exactly (gradients #FF5C3A→#FFB547 mark, #1E1E2E→#0A0A14 bg,
  rx=114 on 512 viewBox). Do NOT reintroduce the PNG image logo.
- Primary CTAs: use the native `components/GradientButton.tsx` (expo-linear-gradient,
  #FF5C3A→#FF8050, radius 15, weight 800, accent shadow) to match web's gradient buttons. Avoid
  flat `backgroundColor: colors.primary` primary buttons in auth/landing flows.
