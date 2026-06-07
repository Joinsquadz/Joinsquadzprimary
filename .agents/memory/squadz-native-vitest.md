---
name: squadz-native vitest setup
description: How to unit-test pure logic in artifacts/squadz-native lib code under node.
---
Mobile app lib code (e.g. lib/checkout.ts) imports `react-native` and `@/lib/api`
(which pulls expo-constants). Those don't load under a plain node test env.

**How to apply:**
- Add `vitest` devDep to squadz-native and a `"test": "vitest run"` script.
- vitest.config.ts: `environment: "node"`, and a `resolve.alias` mapping `"@"` to the
  package root (mirrors the tsconfig `"@/*"` alias) so `@/lib/...` imports resolve.
- In tests, mock the native surface with `vi.hoisted` + `vi.mock("react-native", ...)`
  (e.g. just `Linking.openURL`) and `vi.mock("@/lib/api", ...)`. Stub global `fetch`
  per-test with `vi.stubGlobal`.

**Why:** importing the real dep graph crashes in node; mocking the thin native/api
boundary keeps the unit under test pure and fast.
