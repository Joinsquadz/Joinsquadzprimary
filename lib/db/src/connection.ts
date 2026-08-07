import type { PoolConfig } from "pg";

type SslOption = PoolConfig["ssl"];

interface ParsedConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
}

/**
 * Resolve the Postgres connection config from the environment.
 *
 * Prefers SUPABASE_DB_URL (so the database can point at Supabase without
 * overwriting Replit's runtime-managed DATABASE_URL), falling back to
 * DATABASE_URL.
 *
 * Credentials are passed to `pg` as DISCRETE FIELDS rather than as a single
 * connection string. Supabase database passwords frequently contain characters
 * such as `/`, `@`, `:`, `?` or `#` that, when left un-encoded, make
 * `new URL()` / `pg-connection-string` throw "Invalid URL" (and drizzle-kit
 * silently swallows that error). See `parseConnectionString` for how both
 * standards-compliant (percent-encoded) and raw connection strings are handled.
 */
export function resolveDbConfig(): PoolConfig {
  const raw = (process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "").trim();
  if (!raw) {
    throw new Error(
      "No database connection string set. Provide SUPABASE_DB_URL or DATABASE_URL.",
    );
  }

  const { host, port: parsedPort, user, password, database, sslmode } =
    parseConnectionString(raw);

  if (!host) {
    throw new Error("Invalid Postgres connection string (missing host).");
  }

  // DB_POOLER_PORT switches between Supabase's Session pooler (:5432) and
  // Transaction pooler (:6543) without touching the secret that holds the URL.
  // Transaction pooler supports 100+ concurrent connections (vs ~15 for
  // Session) and is safe for the application: every advisory lock in the
  // codebase uses pg_advisory_xact_lock (transaction-scoped, released at
  // COMMIT) which is compatible with Transaction pooler.
  const port = process.env.DB_POOLER_PORT
    ? Number(process.env.DB_POOLER_PORT)
    : parsedPort;

  const ssl = resolveSsl(host, sslmode);

  return {
    host,
    port,
    user,
    password,
    database,
    ...(ssl !== undefined ? { ssl } : {}),
    // Pool tuning — override via DB_POOL_MAX for different deployment sizes.
    //
    // Confirmed ceiling (Supabase Small, pg max_connections=90):
    //   90 total − 3 superuser reserved − ~10 Supabase internals − ~7 direct/
    //   migration headroom = ~70 available. DB_POOL_MAX=45 uses 64% of that,
    //   leaving ~25 connections for Supabase admin services and a second API
    //   instance if the deployment scales.
    //
    // Transaction pooler (port 6543): DB_POOL_MAX=45 recommended for Small.
    // Session pooler (port 5432): capped at ~15 total across ALL processes;
    //   keep DB_POOL_MAX ≤ 9 if using Session pooler.
    max: Number(
      process.env.DB_POOL_MAX ??
        (process.env.NODE_ENV === "production" ? "45" : "4"),
    ),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? "30000"),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? "5000"),
  };
}

/**
 * Parse a `postgres(ql)://user:password@host:port/database?params` string.
 *
 * Strategy: parse manually (which tolerates raw, un-encoded special characters
 * in the password), then ALSO attempt a strict WHATWG `URL` parse. If the
 * strict parse succeeds and agrees with the manual parse on host+port, the
 * string is a well-formed/percent-encoded URL and we use the strict parser's
 * decoded credentials. Otherwise the password contains raw special characters
 * that confuse the URL parser, so we keep the manual (raw) values verbatim.
 */
export function parseConnectionString(raw: string): ParsedConn {
  const scheme = raw.match(/^postgres(?:ql)?:\/\//i);
  if (!scheme) {
    throw new Error(
      "Invalid Postgres connection string (must start with postgres:// or postgresql://).",
    );
  }

  const manual = parseManual(raw.slice(scheme[0].length));

  const strict = tryStrictUrl(raw);
  if (strict && strict.host === manual.host && strict.port === manual.port) {
    // Well-formed URL: trust the spec parser's percent-decoded credentials.
    return strict;
  }

  return manual;
}

/** Manual parser that treats the password as a raw, un-encoded literal. */
function parseManual(rest: string): ParsedConn {
  // Credentials end at the LAST '@' (the password may itself contain '@');
  // the host section never contains '@'.
  const atIdx = rest.lastIndexOf("@");
  if (atIdx === -1) {
    throw new Error("Invalid Postgres connection string (missing credentials).");
  }
  const userinfo = rest.slice(0, atIdx);
  const afterAt = rest.slice(atIdx + 1);

  // The host/port section ends at the first '/', '?' or '#'. (Anything before
  // the '@' — including those characters in a raw password — is excluded here.)
  const authEnd = firstIndexOfAny(afterAt, ["/", "?", "#"]);
  const hostPort = authEnd === -1 ? afterAt : afterAt.slice(0, authEnd);
  const remainder = authEnd === -1 ? "" : afterAt.slice(authEnd);

  // remainder: "/database?query#frag" — extract path (database) and query.
  let path = "";
  let query = "";
  if (remainder) {
    const hashIdx = remainder.indexOf("#");
    const noFrag = hashIdx === -1 ? remainder : remainder.slice(0, hashIdx);
    const qIdx = noFrag.indexOf("?");
    if (qIdx === -1) {
      path = noFrag;
    } else {
      path = noFrag.slice(0, qIdx);
      query = noFrag.slice(qIdx + 1);
    }
  }
  const database = path.replace(/^\//, "") || "postgres";

  // userinfo: user is before the FIRST ':'; password is the remainder (raw).
  const userColon = userinfo.indexOf(":");
  const user = userColon === -1 ? userinfo : userinfo.slice(0, userColon);
  const password = userColon === -1 ? "" : userinfo.slice(userColon + 1);

  // host:port — port follows the LAST ':' of the host section.
  const hpColon = hostPort.lastIndexOf(":");
  const host = hpColon === -1 ? hostPort : hostPort.slice(0, hpColon);
  let port = 5432;
  if (hpColon !== -1) {
    const portStr = hostPort.slice(hpColon + 1);
    if (!/^\d+$/.test(portStr)) {
      throw new Error(`Invalid Postgres connection string (bad port: "${portStr}").`);
    }
    port = Number.parseInt(portStr, 10);
  }

  const sslmode = new URLSearchParams(query).get("sslmode") ?? undefined;
  return { host, port, user, password, database, sslmode };
}

/** Attempt a strict WHATWG URL parse; returns null if it throws. */
function tryStrictUrl(raw: string): ParsedConn | null {
  try {
    const u = new URL(raw);
    const portStr = u.port;
    if (portStr && !/^\d+$/.test(portStr)) return null;
    return {
      host: u.hostname,
      port: portStr ? Number.parseInt(portStr, 10) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
      sslmode: u.searchParams.get("sslmode") ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Decide TLS behavior.
 *
 * Supabase's pooler presents a self-signed cert chain that Node's default CA
 * bundle cannot verify, so verified TLS fails (`SELF_SIGNED_CERT_IN_CHAIN`).
 * For Supabase hosts we therefore use `rejectUnauthorized: false` UNLESS the
 * caller explicitly asked for verification via `sslmode=verify-ca|verify-full`
 * (in which case we honor their stricter intent). For non-Supabase hosts we
 * follow the standard `sslmode` semantics and otherwise leave TLS unset
 * (preserving prior behavior for the Replit-managed DATABASE_URL).
 */
function resolveSsl(host: string, sslmode?: string): SslOption {
  if (sslmode === "disable") return undefined;

  const verified = sslmode === "verify-ca" || sslmode === "verify-full";
  if (verified) return { rejectUnauthorized: true };

  const isSupabase = /supabase\.(co|com)$/i.test(host);
  if (isSupabase) return { rejectUnauthorized: false };

  if (sslmode === "require" || sslmode === "prefer") return true;

  return undefined;
}

function firstIndexOfAny(s: string, chars: string[]): number {
  let min = -1;
  for (const c of chars) {
    const i = s.indexOf(c);
    if (i !== -1 && (min === -1 || i < min)) min = i;
  }
  return min;
}
