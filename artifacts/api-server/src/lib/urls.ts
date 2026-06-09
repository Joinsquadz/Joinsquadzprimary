/**
 * Canonical base URL for server-generated links (Stripe return URLs, email CTAs, etc.).
 *
 * Priority:
 *  1. SQUADZ_BASE_URL env var  — set this in the production deployment environment
 *  2. First domain in REPLIT_DOMAINS — Replit-provided domains list
 *  3. localhost fallback for local dev
 *
 * Always returns a URL with no trailing slash.
 */
export function getBaseUrl(): string {
  const explicit = process.env.SQUADZ_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  const first = domains[0]?.trim();
  if (first) return `https://${first}`;

  const port = process.env.PORT ?? "5000";
  return `http://localhost:${port}`;
}
