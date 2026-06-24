---
name: Avatar storage & which DB the app actually uses
description: App data lives in Supabase, not the executeSql DB; how avatars must be stored
---

**The app's data is in Supabase**, reached via `SUPABASE_DB_URL` (Session pooler,
`current_database()` = `postgres`). The `executeSql` code-exec callback and the
`database` skill's dev queries hit Replit's BUILT-IN db (`heliumdb`), which this
app does NOT use — it looks empty (0 rows everywhere) and will mislead you into
thinking data was wiped.

**Why:** during a "profile picture gone" report, querying executeSql showed an
empty users table; the real Supabase DB had 14 users intact. Always query the
real DB by connecting with `SUPABASE_DB_URL` for app-data questions.

**How to apply:** to inspect real app data from bash, parse `SUPABASE_DB_URL`
into discrete pg fields (raw special-char password breaks URL parsers; split on
last `@`, first `:`), `ssl:{rejectUnauthorized:false}`. Import pg via the pnpm
store absolute path (resolve with `require.resolve('pg',{paths:[...]})`) since it
won't resolve from `/tmp`. Never print credentials.

**Avatars:** must live in the PUBLIC `squadz-avatars` bucket (plain `<Image>`,
no auth header) AND the user row's `profile_image_url` must persist the returned
public URL. Two historic bugs broke this: upload-to-private-bucket (URLs 400) and
upload-succeeds-but-row-not-updated (orphaned object in the bucket). Both fixed;
remedy for an affected user is to re-upload.
