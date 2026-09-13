/**
 * Deep-link (universal links / app links) association-file smoke test.
 *
 * Usage:
 *   SQUADZ_BASE_URL=https://joinsquadz.com pnpm --filter @workspace/scripts run smoke-test-deeplinks
 *
 * Fetches the two association files that make a shared squad link open the
 * native app and asserts every property a real device's verifier requires:
 *   - /.well-known/apple-app-site-association
 *   - /.well-known/assetlinks.json
 *
 * What it checks (the automatable half of the pre-launch round-trip check):
 *   - Served over HTTPS with no redirects (Android's verifier rejects redirects).
 *   - Content-Type is application/json.
 *   - AASA appID is NOT the `TEAMID.*` placeholder and is in `<TEAM_ID>.<BUNDLE_ID>` form.
 *   - AASA paths/components cover every canonical squad and plan invite path.
 *   - assetlinks declares `delegate_permission/common.handle_all_urls`.
 *   - assetlinks has at least one SHA-256 fingerprint in valid colon-hex form
 *     (i.e. NOT the empty placeholder).
 *
 * What it CANNOT check (requires real hardware — do these by hand, see replit.md):
 *   - That the fingerprints/Team ID actually match the SIGNED builds.
 *   - That tapping the link on a physical iOS/Android device opens the app.
 *
 * Exit codes:
 *   0 — every automatable check passed (still finish the manual device taps).
 *   1 — at least one check failed, OR placeholders are still in place.
 */

const DEFAULT_BASE_URL = "https://joinsquadz.com";
const REQUIRED_PATHS = ["/squad/join-public", "/squad/join", "/squad/*", "/join/*"];
const SHA256_FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i;

type CheckResult = { ok: boolean; label: string; detail?: string };

const results: CheckResult[] = [];

function check(ok: boolean, label: string, detail?: string): void {
  results.push({ ok, label, detail });
  const mark = ok ? "PASS" : "FAIL";
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`  [${mark}] ${label}${suffix}`);
}

async function fetchNoRedirect(
  url: string,
): Promise<{ res: Response; text: string }> {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  return { res, text };
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function checkAasa(baseUrl: string): Promise<void> {
  const url = `${baseUrl}/.well-known/apple-app-site-association`;
  console.log(`\n── Apple App Site Association ──\n  ${url}`);

  let fetched: { res: Response; text: string };
  try {
    fetched = await fetchNoRedirect(url);
  } catch (err) {
    check(false, "reachable", err instanceof Error ? err.message : String(err));
    return;
  }
  const { res, text } = fetched;

  check(res.status === 200, "HTTP 200 (no redirect)", `got ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  check(
    contentType.toLowerCase().includes("application/json"),
    "Content-Type application/json",
    contentType || "(missing)",
  );

  const json = parseJson(text) as
    | { applinks?: { details?: Array<Record<string, unknown>> } }
    | undefined;
  if (!json) {
    check(false, "valid JSON", "body did not parse");
    return;
  }
  check(true, "valid JSON");

  const details = json.applinks?.details ?? [];
  check(details.length > 0, "applinks.details present");

  const appIds = new Set<string>();
  for (const d of details) {
    if (typeof d.appID === "string") appIds.add(d.appID);
    if (Array.isArray(d.appIDs)) {
      for (const a of d.appIDs) if (typeof a === "string") appIds.add(a);
    }
  }
  const appIdList = [...appIds];
  check(appIdList.length > 0, "appID present", appIdList.join(", "));

  const hasPlaceholder = appIdList.some((a) => a.startsWith("TEAMID."));
  check(
    !hasPlaceholder,
    "appID is not the TEAMID placeholder (set IOS_APP_ID)",
    hasPlaceholder ? appIdList.join(", ") : undefined,
  );

  const wellFormed =
    appIdList.length > 0 &&
    appIdList.every((a) => /^[A-Z0-9]{10}\.[A-Za-z0-9.]+$/.test(a));
  check(
    wellFormed,
    "appID in <TEAM_ID>.<BUNDLE_ID> form",
    wellFormed ? undefined : appIdList.join(", "),
  );

  const pathsCovered = REQUIRED_PATHS.filter((requiredPath) => details.some((d) => {
    const paths = Array.isArray(d.paths) ? (d.paths as unknown[]) : [];
    const inPaths = paths.some(
      (p) => typeof p === "string" && p.includes(requiredPath),
    );
    const components = Array.isArray(d.components)
      ? (d.components as Array<Record<string, unknown>>)
      : [];
    const inComponents = components.some((c) =>
      Object.values(c).some(
        (v) => typeof v === "string" && v.includes(requiredPath),
      ),
    );
    return inPaths || inComponents;
  }));
  for (const requiredPath of REQUIRED_PATHS) {
    check(
      pathsCovered.includes(requiredPath),
      `paths/components cover ${requiredPath}`,
    );
  }
}

async function checkAssetLinks(baseUrl: string): Promise<void> {
  const url = `${baseUrl}/.well-known/assetlinks.json`;
  console.log(`\n── Android Asset Links ──\n  ${url}`);

  let fetched: { res: Response; text: string };
  try {
    fetched = await fetchNoRedirect(url);
  } catch (err) {
    check(false, "reachable", err instanceof Error ? err.message : String(err));
    return;
  }
  const { res, text } = fetched;

  check(res.status === 200, "HTTP 200 (no redirect)", `got ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  check(
    contentType.toLowerCase().includes("application/json"),
    "Content-Type application/json",
    contentType || "(missing)",
  );

  const json = parseJson(text) as
    | Array<{
        relation?: unknown;
        target?: {
          namespace?: unknown;
          package_name?: unknown;
          sha256_cert_fingerprints?: unknown;
        };
      }>
    | undefined;
  if (!json || !Array.isArray(json)) {
    check(false, "valid JSON array", "body did not parse as an array");
    return;
  }
  check(true, "valid JSON array");

  const entry = json[0];
  check(json.length > 0 && !!entry, "at least one statement present");
  if (!entry) return;

  const relation = Array.isArray(entry.relation)
    ? (entry.relation as unknown[])
    : [];
  check(
    relation.includes("delegate_permission/common.handle_all_urls"),
    "relation handle_all_urls present",
  );

  const namespace = entry.target?.namespace;
  check(namespace === "android_app", "target.namespace android_app", String(namespace));

  const pkg = entry.target?.package_name;
  check(
    typeof pkg === "string" && pkg.length > 0,
    "package_name present",
    typeof pkg === "string" ? pkg : "(missing)",
  );

  const fingerprints = Array.isArray(entry.target?.sha256_cert_fingerprints)
    ? (entry.target!.sha256_cert_fingerprints as unknown[])
    : [];
  check(
    fingerprints.length > 0,
    "at least one SHA-256 fingerprint (set ANDROID_SHA256_CERT_FINGERPRINTS)",
    fingerprints.length === 0 ? "empty placeholder" : `${fingerprints.length} found`,
  );

  const allWellFormed =
    fingerprints.length > 0 &&
    fingerprints.every(
      (f) => typeof f === "string" && SHA256_FINGERPRINT_RE.test(f),
    );
  check(
    allWellFormed,
    "fingerprints in colon-separated hex form",
    allWellFormed ? undefined : JSON.stringify(fingerprints),
  );
}

async function main() {
  const baseUrl = (
    process.env.SQUADZ_BASE_URL ??
    process.argv[2] ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  if (!baseUrl.startsWith("https://")) {
    console.error(
      `ERROR: base URL must be https:// (universal/app links require it). Got: ${baseUrl}`,
    );
    process.exit(1);
  }

  console.log(`Verifying deep-link association files at: ${baseUrl}`);

  await checkAasa(baseUrl);
  await checkAssetLinks(baseUrl);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n── Summary ── ${results.length - failed.length}/${results.length} checks passed`,
  );

  if (failed.length > 0) {
    console.log("\nResult: FAIL");
    console.log(
      "Fix the failures above. Placeholder failures mean the deploy-time env vars\n" +
        "(IOS_APP_ID, ANDROID_SHA256_CERT_FINGERPRINTS) are not set for this environment.",
    );
    process.exit(1);
  }

  console.log("\nResult: PASS (association files are well-formed and non-placeholder)");
  console.log(
    "Still required before launch — these CANNOT be automated:\n" +
      "  1. Confirm the values match the SIGNED builds.\n" +
      "  2. Apple AASA validator: https://app-site-association.cdn-apple.com/a/v1/" +
      baseUrl.replace(/^https:\/\//, "") +
      "\n" +
      "  3. Google Digital Asset Links tester:\n" +
      "     https://developers.google.com/digital-asset-links/tools/generator\n" +
      "  4. Tap https://" +
      baseUrl.replace(/^https:\/\//, "") +
      REQUIRED_PATHS[0] +
      "?id=<id> on a real iOS and Android device — it must open the app.\n" +
      "  5. (Android) adb shell pm verify-app-links --re-verify com.squadz.app\n" +
      "     then: adb shell pm get-app-links com.squadz.app  → expect 'verified'.",
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
