---
name: nodemailer v9 types
description: nodemailer v9 does NOT bundle its own types; @types/nodemailer is still required. Named imports needed.
---

nodemailer v9 dropped the bundled `@types/nodemailer` assumption but also does NOT ship its own `.d.ts` files (`package.json` has no `types` field). The `@types/nodemailer@^6.4.x` package must stay in `devDependencies`.

**How to import:**
```ts
import { createTransport as nmCreateTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
```
Do NOT use `import nodemailer from 'nodemailer'` (default import causes TS7016 under some moduleResolution modes).

**Why:** Default import resolution fails because v9 has `"main": "lib/nodemailer.js"` with no `"exports"` map and no `"types"` — TypeScript can't locate types without `@types/nodemailer`. Named imports + the `@types` package resolves cleanly.

**How to apply:** Any time nodemailer is upgraded or `@types/nodemailer` is questioned as "redundant" — it isn't.
