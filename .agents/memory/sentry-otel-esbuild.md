---
name: Sentry + OpenTelemetry + esbuild externals
description: @sentry/node v8 requires @opentelemetry/* packages at runtime; esbuild can't bundle them due to dynamic requires; fix is to externalize both.
---

## Rule

When `@sentry/node` (v8+) is added to an api-server that uses esbuild to bundle, add TWO entries to the `external` array in `build.mjs`:

```js
"@opentelemetry/*",
"@sentry/node",
```

## Why

`@sentry/node` v8 uses OpenTelemetry under the hood. It dynamically requires `@opentelemetry/instrumentation` (and siblings) at runtime via code esbuild cannot statically analyze. If these packages are bundled, the dynamic require fails at runtime with `ERR_MODULE_NOT_FOUND`. Externalizing `@opentelemetry/*` tells esbuild to leave those imports alone, but then `@sentry/core` (an internal dep of `@sentry/node`, not a direct dep of the api-server) also can't be found because pnpm doesn't hoist transitive deps. The cleanest fix is to externalize `@sentry/node` entirely, so Node.js resolves the full Sentry + OpenTelemetry subtree through pnpm's own module graph.

## How to apply

In `artifacts/api-server/build.mjs`, ensure the `external` array contains:
- `"@opentelemetry/*"` — prevents OpenTelemetry packages from being bundled (they load dynamically).
- `"@sentry/node"` — lets Node resolve Sentry + all its OpenTelemetry transitive deps naturally.

Do NOT add `"@sentry/core"` as a separate external entry — it is not a direct dep and pnpm won't hoist it.
