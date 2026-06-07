---
name: Squadz native-module web safety
description: How to use Expo native-only modules (media-library, file-system) without crashing the Expo-web preview.
---

Squadz mobile (`artifacts/squadz-native`) runs on native AND on the Expo-web dev preview (the URL users see in the workspace). Native-only Expo modules crash the web bundle if imported at module top level.

**Rule:** import native-only modules (`expo-media-library`, `expo-file-system/legacy`) via dynamic `await import(...)` inside a `Platform.OS !== "web"` branch — never as static top-level imports. The web branch must use a pure-web path (e.g. download = fetch → blob → anchor click). See `lib/downloadPhoto.ts` for the canonical shape.

**Why:** a static import of a native module is evaluated when the web bundle loads, before any Platform check can run, so it throws during bundling/startup and blanks the preview. Dynamic import defers evaluation until the guarded native code path actually runs.

**How to apply:** any new device-feature module (camera, contacts, sharing, etc.) follows the same guard-then-dynamic-import pattern. Also add the module's config plugin + permission strings to `app.json` plugins so the native build has the entitlements.

**Platform-split component convention:** for a component whose native impl needs a native-only module (e.g. `expo-video`), make the **web variant the suffix-less default** (`Foo.tsx`) and the native variant `Foo.native.tsx`. Import as `@/components/Foo`. Metro picks `.native.tsx` on native and `.tsx` on web; tsc resolves the import to `.tsx` (web, no native import) so the web bundle never pulls the native module. Do NOT name the web file `Foo.web.tsx` with no plain `.tsx` — then `@/components/Foo` fails tsc resolution. (See `components/AttachmentVideo.{tsx,native.tsx}`.)

**Typed-routes hazard:** newly-added dynamic routes (e.g. `app/conversation/[id].tsx`) aren't in expo-router's generated route types until a dev build regenerates them, so `router.push(\`/conversation/${id}\`)` fails tsc. Cast with `as never` (existing codebase pattern) to keep typecheck green.

**Related hazard:** when multiple task agents merge, watch for duplicate `useState` declarations in `context/AppContext.tsx` (TS2451 "Cannot redeclare") — two agents adding the same loading flag. Fix by deleting the duplicate lines.
