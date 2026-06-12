import Stripe from 'stripe';
import type { ConnectionOptions } from 'node:tls';
import { StripeSync } from 'stripe-replit-sync';
import { resolveDbConfig } from '@workspace/db';

async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      'Missing Replit environment variables. ' +
      'Ensure the Stripe integration is connected via the Integrations tab.'
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!resp.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as { items?: Array<{ settings?: { secret?: string; publishable?: string; webhook_secret?: string } }> };
  const settings = data.items?.[0]?.settings;

  if (!settings?.secret) {
    throw new Error(
      'Stripe integration not connected or missing secret key. ' +
      'Connect Stripe via the Integrations tab first.'
    );
  }

  return {
    secretKey: settings.secret,
    webhookSecret: settings.webhook_secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Build the Postgres connection details for the Stripe sync from the SAME source
 * the app reads through (`resolveDbConfig`, which prefers SUPABASE_DB_URL). The
 * sync MUST write the `stripe.*` tables into the database the app queries — if
 * the sync writes to a different DB (e.g. a Replit-managed DATABASE_URL) the
 * app's `stripe.products` lookups 500 with "relation does not exist" and the
 * upgrade button can never find the Pro plan.
 *
 * Returns both a `poolConfig` (discrete pg fields, used by StripeSync) and a
 * percent-encoded `databaseUrl` + `ssl` (used by runMigrations, which only
 * accepts a connection string). The URL is rebuilt from the parsed discrete
 * fields so raw Supabase passwords with special characters are encoded safely.
 */
export function getStripeDbConfig(): {
  poolConfig: ReturnType<typeof resolveDbConfig>;
  databaseUrl: string;
  ssl: ConnectionOptions | undefined;
} {
  const poolConfig = resolveDbConfig();
  const { host, port, user, password, database, ssl } = poolConfig as {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean | ConnectionOptions;
  };
  const databaseUrl =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${encodeURIComponent(database)}`;
  const sslOption: ConnectionOptions | undefined =
    ssl === true
      ? { rejectUnauthorized: true }
      : ssl === undefined
        ? undefined
        : (ssl as ConnectionOptions);
  return { poolConfig, databaseUrl, ssl: sslOption };
}

export async function getStripeSync(): Promise<StripeSync> {
  const { poolConfig } = getStripeDbConfig();
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig,
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? '',
  });
}
