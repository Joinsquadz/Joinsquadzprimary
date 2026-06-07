# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/squadz-native` — the Squadz **mobile app** (Expo). This is the actual product; build all new user features here.
- `artifacts/squadz` — the **web marketing landing page** only (not an app). Entry: `src/pages/Landing.tsx`; brand tokens/font in `src/lib/data.ts` (`T`, `font`), logo in `src/components/SquadzIcon.tsx`.
- `artifacts/api-server` — Express API. Routes in `src/routes/*` registered via `src/routes/index.ts`; persistence helpers in `src/storage.ts`.
- `lib/db/src/schema/*` — Drizzle table definitions (source of truth for DB schema), re-exported from `schema/index.ts`.

## Architecture decisions

- **Mobile is the product; web is marketing.** The web app is a single informational landing page with a real waitlist + app-store "coming soon" CTAs. Every web route renders `Landing` (no in-app web screens, no auth guard).
- **App feature routes are NOT in the OpenAPI spec.** They use inline Zod validation on the server + plain `fetch` on the client (no Orval codegen). The waitlist endpoints follow this convention. Only add to `openapi.yaml` for contracts that genuinely need generated hooks/schemas.
- **Waitlist is idempotent.** `addToWaitlist` uses `onConflictDoNothing` on the unique `email`, so re-submits return `{ok:true}` without duplicating rows.
- **Waitlist count is real, never inflated.** The landing page shows the true `/api/waitlist/count`, and falls back to a non-numeric label below a small threshold rather than fabricating social proof.

## Product

Squadz is a mobile app for friend groups: create squads, find the time everyone is free (overlap heatmap → best time), plan events with RSVPs, group chat tied to the plan, a shared photo vault, and cost splitting. The web presence is a marketing landing page that drives waitlist signups ahead of the iOS/Android launch.

## User preferences

- Mobile app is the ONLY product. Build new features mobile-only. The web app must stay an informational marketing landing page (no in-app web screens).
- **Two separate apps live in this one project — never confuse them:**
  - **Website** = `artifacts/squadz` (marketing landing page).
  - **Mobile App** = `artifacts/squadz-native` (the actual product).
- **Route every request to exactly one app.** A change to one must not touch the other unless the user explicitly asks for both. The shared `artifacts/api-server` backend is the only intentionally-shared piece.
- **If a request doesn't make the target app obvious, STOP and ask "Website or Mobile App?" before editing.** Do not guess. Optional shortcut: the user may prefix a message with `Website:` or `App:` to set the target explicitly.

## Gotchas

- Verify web changes with `pnpm --filter @workspace/squadz run typecheck` (NOT `build`, which needs workflow-provided `PORT`/`BASE_PATH`).
- After changing `lib/db` schema, run `pnpm --filter @workspace/db run push` and restart the api-server workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
