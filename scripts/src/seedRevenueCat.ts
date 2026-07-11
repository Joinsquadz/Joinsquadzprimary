/**
 * Idempotent seeder for the Squadz+ RevenueCat project.
 *
 * Creates (or reuses) the App Store + Play Store apps, the two yearly products,
 * the `squadz_plus` entitlement, and the current `default` offering with a
 * founding + standard package. Prints the public SDK keys so they can be set as
 * EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY.
 *
 * Identifiers MUST match the client (`squadz-native/lib/revenuecat.ts`) and the
 * server (`api-server/lib/revenuecat.ts`):
 *   entitlement  squadz_plus
 *   products     squadz_plus_founding_yearly / squadz_plus_standard_yearly
 *
 * Auth is via the Replit RevenueCat connector (no API key handled here). Run:
 *   pnpm --filter @workspace/scripts run seed-revenuecat
 *
 * Optional: set RC_WEBHOOK_URL + RC_WEBHOOK_AUTH to also create/update the
 * server-to-server webhook integration.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";

const BUNDLE_ID = "com.squadz.app";
const FOUNDING = "squadz_plus_founding_yearly";
const STANDARD = "squadz_plus_standard_yearly";
const ENTITLEMENT = "squadz_plus";

const connectors = new ReplitConnectors();

type Json = Record<string, unknown> & { items?: any[] };

async function rc(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: Json | null }> {
  const opts: { method: string; body?: string; headers?: Record<string, string> } = {
    method: init?.method ?? "GET",
  };
  if (init?.body !== undefined) {
    opts.body = JSON.stringify(init.body);
    opts.headers = { "Content-Type": "application/json" };
  }
  const resp = await connectors.proxy("revenuecat", path, opts);
  let json: Json | null = null;
  try {
    json = (await resp.json()) as Json;
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

function must<T>(cond: T, msg: string): T {
  if (!cond) throw new Error(msg);
  return cond;
}

async function resolveProjectId(): Promise<string> {
  if (process.env.RC_PROJECT_ID) return process.env.RC_PROJECT_ID;
  const res = await rc("/v2/projects?limit=20");
  const projects = res.json?.items ?? [];
  if (projects.length > 1) {
    throw new Error(
      `Multiple RevenueCat projects found — set RC_PROJECT_ID to disambiguate (${projects
        .map((p) => p.id)
        .join(", ")})`,
    );
  }
  return must(projects[0]?.id, "No RevenueCat project found (set RC_PROJECT_ID)") as string;
}

async function ensureApp(
  projectId: string,
  type: "app_store" | "play_store",
  name: string,
): Promise<any> {
  const res = await rc(`/v2/projects/${projectId}/apps?limit=50`);
  // Match on store identity, not just type, so a multi-app project doesn't bind
  // to the wrong app.
  const found = (res.json?.items ?? []).find(
    (a) =>
      a.type === type &&
      (type === "app_store"
        ? a.app_store?.bundle_id === BUNDLE_ID
        : a.play_store?.package_name === BUNDLE_ID),
  );
  if (found) return found;
  const body =
    type === "app_store"
      ? { name, type, app_store: { bundle_id: BUNDLE_ID } }
      : { name, type, play_store: { package_name: BUNDLE_ID } };
  const r = await rc(`/v2/projects/${projectId}/apps`, { method: "POST", body });
  return must(r.status < 300 ? r.json : null, `createApp ${type} failed: ${r.status}`);
}

async function ensureProduct(
  projectId: string,
  existing: any[],
  appId: string,
  storeId: string,
  displayName: string,
): Promise<any> {
  const found = existing.find((p) => p.store_identifier === storeId && p.app_id === appId);
  if (found) return found;
  const r = await rc(`/v2/projects/${projectId}/products`, {
    method: "POST",
    body: { store_identifier: storeId, app_id: appId, type: "subscription", display_name: displayName },
  });
  return must(r.status < 300 ? r.json : null, `createProduct ${storeId} failed: ${r.status}`);
}

async function ensureEntitlement(projectId: string): Promise<any> {
  const res = await rc(`/v2/projects/${projectId}/entitlements?limit=50`);
  const found = (res.json?.items ?? []).find((e) => e.lookup_key === ENTITLEMENT);
  if (found) return found;
  const r = await rc(`/v2/projects/${projectId}/entitlements`, {
    method: "POST",
    body: { lookup_key: ENTITLEMENT, display_name: "Squadz+" },
  });
  return must(r.status < 300 ? r.json : null, `createEntitlement failed: ${r.status}`);
}

async function ensureOffering(projectId: string): Promise<any> {
  const res = await rc(`/v2/projects/${projectId}/offerings?limit=50`);
  const found = (res.json?.items ?? []).find((o) => o.lookup_key === "default");
  if (found) return found;
  const r = await rc(`/v2/projects/${projectId}/offerings`, {
    method: "POST",
    body: { lookup_key: "default", display_name: "Squadz+ Yearly" },
  });
  return must(r.status < 300 ? r.json : null, `createOffering failed: ${r.status}`);
}

async function ensurePackage(
  projectId: string,
  offeringId: string,
  existing: any[],
  lookupKey: string,
  displayName: string,
): Promise<any> {
  const found = existing.find((p) => p.lookup_key === lookupKey);
  if (found) return found;
  const r = await rc(`/v2/projects/${projectId}/offerings/${offeringId}/packages`, {
    method: "POST",
    body: { lookup_key: lookupKey, display_name: displayName },
  });
  return must(r.status < 300 ? r.json : null, `createPackage ${lookupKey} failed: ${r.status}`);
}

async function attachToPackage(projectId: string, packageId: string, productIds: string[]): Promise<void> {
  // Package attach_products returns 422 for already-attached products, so only
  // attach the missing ones (keeps reruns idempotent while still surfacing real
  // failures).
  const current = await rc(`/v2/projects/${projectId}/packages/${packageId}/products`);
  const attached = new Set((current.json?.items ?? []).map((i: any) => i.product?.id));
  const missing = productIds.filter((id) => !attached.has(id));
  if (missing.length === 0) return;
  const r = await rc(`/v2/projects/${projectId}/packages/${packageId}/actions/attach_products`, {
    method: "POST",
    body: { products: missing.map((id) => ({ product_id: id, eligibility_criteria: "all" })) },
  });
  must(r.status < 300 || null, `attach products to package ${packageId} failed: ${r.status}`);
}

async function publicKey(projectId: string, appId: string): Promise<string | null> {
  const res = await rc(`/v2/projects/${projectId}/apps/${appId}/public_api_keys`);
  return (res.json?.items?.[0]?.key as string | undefined) ?? null;
}

async function main(): Promise<void> {
  const projectId = await resolveProjectId();
  console.log(`Project: ${projectId}`);

  const appStore = await ensureApp(projectId, "app_store", "Squadz iOS");
  const playStore = await ensureApp(projectId, "play_store", "Squadz Android");
  console.log(`Apps: iOS=${appStore.id} Android=${playStore.id}`);

  const prodRes = await rc(`/v2/projects/${projectId}/products?limit=100`);
  const existingProducts = prodRes.json?.items ?? [];
  const iosFounding = await ensureProduct(projectId, existingProducts, appStore.id, FOUNDING, "Squadz+ Founding (Yearly)");
  const iosStandard = await ensureProduct(projectId, existingProducts, appStore.id, STANDARD, "Squadz+ Standard (Yearly)");
  // Google Play subscriptions use `{subscriptionId}:{basePlanId}`.
  const andFounding = await ensureProduct(projectId, existingProducts, playStore.id, `${FOUNDING}:founding-yearly`, "Squadz+ Founding (Yearly)");
  const andStandard = await ensureProduct(projectId, existingProducts, playStore.id, `${STANDARD}:standard-yearly`, "Squadz+ Standard (Yearly)");
  const allProductIds = [iosFounding.id, iosStandard.id, andFounding.id, andStandard.id];
  console.log(`Products: ${allProductIds.join(", ")}`);

  const entitlement = await ensureEntitlement(projectId);
  const attachEnt = await rc(`/v2/projects/${projectId}/entitlements/${entitlement.id}/actions/attach_products`, {
    method: "POST",
    body: { product_ids: allProductIds },
  });
  must(attachEnt.status < 300 || null, `attach products to entitlement failed: ${attachEnt.status}`);
  console.log(`Entitlement: ${entitlement.id} (${ENTITLEMENT})`);

  const offering = await ensureOffering(projectId);
  const pkgRes = await rc(`/v2/projects/${projectId}/offerings/${offering.id}/packages?limit=50`);
  const existingPkgs = pkgRes.json?.items ?? [];
  const foundingPkg = await ensurePackage(projectId, offering.id, existingPkgs, "founding", "Founding (Yearly)");
  const standardPkg = await ensurePackage(projectId, offering.id, existingPkgs, "$rc_annual", "Standard (Yearly)");
  await attachToPackage(projectId, foundingPkg.id, [iosFounding.id, andFounding.id]);
  await attachToPackage(projectId, standardPkg.id, [iosStandard.id, andStandard.id]);
  console.log(`Offering: ${offering.id} (default, is_current=${offering.is_current})`);

  const webhookUrl = process.env.RC_WEBHOOK_URL;
  const webhookAuth = process.env.RC_WEBHOOK_AUTH;
  if (webhookUrl && webhookAuth) {
    const existing = await rc(`/v2/projects/${projectId}/integrations/webhooks?limit=20`);
    const hook = (existing.json?.items ?? []).find((w) => (w.url || "").includes("/api/revenuecat/webhook"));
    if (hook) {
      const r = await rc(`/v2/projects/${projectId}/integrations/webhooks/${hook.id}`, {
        method: "POST",
        body: { url: webhookUrl, authorization_header: webhookAuth },
      });
      must(r.status < 300 || null, `update webhook failed: ${r.status}`);
      console.log(`Webhook updated: ${hook.id} -> ${webhookUrl}`);
    } else {
      const r = await rc(`/v2/projects/${projectId}/integrations/webhooks`, {
        method: "POST",
        body: { name: "Squadz API", url: webhookUrl, authorization_header: webhookAuth },
      });
      must(r.status < 300 ? r.json : null, `create webhook failed: ${r.status}`);
      console.log(`Webhook created: ${(r.json as any)?.id} -> ${webhookUrl}`);
    }
  }

  const iosKey = await publicKey(projectId, appStore.id);
  const androidKey = await publicKey(projectId, playStore.id);
  console.log("\nSet these env vars (public SDK keys, safe to ship in the client):");
  console.log(`  EXPO_PUBLIC_REVENUECAT_IOS_KEY=${iosKey ?? "(none)"}`);
  console.log(`  EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=${androidKey ?? "(none)"}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
