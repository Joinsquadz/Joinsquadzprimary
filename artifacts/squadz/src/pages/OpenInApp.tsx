import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { T, font } from "@/lib/data";
import { trackEvent } from "@/lib/analytics";
import { SquadzIcon } from "@/components/SquadzIcon";
import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from "@/lib/storeLinks";

const ACCENT_GRADIENT = `linear-gradient(135deg, ${T.accent} 0%, ${T.gold} 100%)`;

type SquadPreview = {
  name: string;
  emoji: string;
  memberCount: number;
  creatorFirstName: string | null;
};

type LinkKind = "squad" | "publicSquad" | "plan" | "event" | "friend" | "poll";

type PlanPreview = {
  emoji?: string | null;
  title?: string | null;
  type?: "event" | "trip";
  hostName?: string | null;
};

/**
 * Web fallback for app deep links (squad/event/friend invites, polls).
 *
 * Invite links are branded joinsquadz.com/... — on iPhones with the app
 * installed, universal links open the app directly. Everyone else lands
 * here, so this page must never 404: it explains the invite, surfaces the
 * code so it can be entered manually in the app, and points at the app.
 */
export default function OpenInApp({ kind, url }: { kind: LinkKind; url?: string }) {
  const location = useMemo(() => {
    const href = url ?? (typeof window !== "undefined" ? window.location.href : "https://joinsquadz.com/");
    return new URL(href, "https://joinsquadz.com");
  }, [url]);
  const query = useMemo(() => location.searchParams, [location]);
  const pathParts = useMemo(() => location.pathname.split("/").filter(Boolean), [location]);

  // Code the recipient can type into the app manually, when the link carries one.
  const code =
    kind === "squad"
      ? query.get("code")
      : kind === "plan" || kind === "event" || kind === "friend"
        ? pathParts[pathParts.length - 1] ?? null
        : null;
  const publicSquadId =
    kind === "publicSquad"
      ? query.get("id") ?? pathParts[pathParts.length - 1] ?? null
      : null;

  const [preview, setPreview] = useState<SquadPreview | null>(null);
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);
  const [inviteUnavailable, setInviteUnavailable] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "failed">("idle");

  useEffect(() => {
    trackEvent("invite_fallback_viewed", {
      invite_type: kind,
      code_present: Boolean(code),
    });
  }, [kind, code]);

  // Best-effort rich preview for private squad invites (same unauthenticated
  // endpoint the app uses). Non-fatal: generic copy if it can't load.
  useEffect(() => {
    if (!["squad", "publicSquad"].includes(kind)) return;
    const lookup = kind === "squad" ? code : publicSquadId;
    if (!lookup) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_000);
    (async () => {
      try {
        const endpoint =
          kind === "squad"
            ? `/api/squads/preview?code=${encodeURIComponent(lookup)}`
            : `/api/discover/squads/${encodeURIComponent(lookup)}`;
        const res = await fetch(endpoint, { signal: controller.signal });
        if (res.ok) {
          const data = (await res.json()) as SquadPreview;
          if (!cancelled) setPreview(data);
        } else if ((res.status === 404 || res.status === 410) && !cancelled) {
          setInviteUnavailable(true);
        }
      } catch {
        // keep generic copy
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [kind, code, publicSquadId]);

  // Plan-kind previews are deliberately public, privacy-minimized, and
  // best-effort. The fallback paints immediately even when the API is slow.
  useEffect(() => {
    if (kind !== "plan" || !code) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_000);
    fetch(`/api/events/preview?code=${encodeURIComponent(code)}`, { signal: controller.signal })
      .then((res) => {
        if ((res.status === 404 || res.status === 410) && !cancelled) {
          setInviteUnavailable(true);
        }
        return res.ok ? res.json() : null;
      })
      .then((data: PlanPreview | null) => {
        if (!cancelled && data) setPlanPreview(data);
      })
      .catch(() => {})
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [kind, code]);

  const copy: Record<LinkKind, { emoji: string; title: string; sub: string }> = {
    squad: {
      emoji: inviteUnavailable ? "🔗" : preview?.emoji ?? "🎉",
      title: inviteUnavailable
        ? "This invite is no longer available"
        : preview
        ? `You're invited to ${preview.name}!`
        : "You're invited to a squad!",
      sub: inviteUnavailable
        ? "This link has expired or was replaced. Ask the squad organizer to send you a fresh invite."
        : preview
        ? `${preview.creatorFirstName ? `${preview.creatorFirstName} and ` : ""}${preview.memberCount} ${preview.memberCount === 1 ? "friend is" : "friends are"} planning hangouts on SquadZ. Open this link on your phone to join them.`
        : "A friend invited you to their squad on SquadZ. Open this link on your phone to join them.",
    },
    publicSquad: {
      emoji: inviteUnavailable ? "🔗" : preview?.emoji ?? "🌎",
      title: inviteUnavailable
        ? "This squad invite is no longer available"
        : preview
          ? `Join ${preview.name} on SquadZ!`
          : "You're invited to a squad!",
      sub: inviteUnavailable
        ? "This squad is no longer public or the link has expired. Ask the organizer for a fresh invite."
        : preview
        ? `${preview.memberCount} ${preview.memberCount === 1 ? "member is" : "members are"} already planning together. Open this link on your phone to join.`
        : "This squad is open to join. Open this link on your phone with SquadZ installed to jump in.",
    },
    event: {
      emoji: "📅",
      title: "You're invited to a hangout!",
      sub: "A friend wants you at their event. Open this link on your phone with SquadZ installed to RSVP.",
    },
    plan: {
      emoji: inviteUnavailable ? "🔗" : planPreview?.type === "trip" ? "✈️" : planPreview?.emoji ?? "📅",
      title: inviteUnavailable
        ? "This plan invite is no longer available"
        : planPreview?.title
        ? `You're invited to ${planPreview.type === "trip" ? "a trip" : "an event"}: ${planPreview.title}`
        : "You're invited to a plan!",
      sub: inviteUnavailable
        ? "This link has expired or was replaced. Ask the organizer to send you a fresh invite."
        : planPreview?.type === "trip"
        ? "A friend wants you on their itinerary. Open this link on your phone with SquadZ installed to see the trip."
        : "A friend wants you at their event. Open this link on your phone with SquadZ installed to RSVP.",
    },
    friend: {
      emoji: "👥",
      title: "Add me on SquadZ!",
      sub: "A friend wants to connect with you on SquadZ. Open this link on your phone with the app installed.",
    },
    poll: {
      emoji: "🗓️",
      title: "When are you free?",
      sub: "A friend is finding the best time for a hangout. Open this link on your phone with SquadZ installed to mark your availability.",
    },
  };

  const { emoji, title, sub } = copy[kind];
  const nativeAppUrl = !inviteUnavailable
    ? kind === "squad" && code
      ? `squadz-native://squad/join?code=${encodeURIComponent(code)}`
      : (kind === "plan" || kind === "event") && code
        ? `squadz-native://join/${encodeURIComponent(code)}`
        : kind === "friend" && code
          ? `squadz-native://add/friend/${encodeURIComponent(code)}`
          : kind === "publicSquad" && publicSquadId
            ? `squadz-native://squad/join-public?id=${encodeURIComponent(publicSquadId)}`
            : null
    : null;

  async function copyInviteThenOpenStore(event: React.MouseEvent<HTMLAnchorElement>) {
    trackEvent("app_store_clicked", {
      location: "invite_fallback",
      invite_type: kind,
      store: event.currentTarget.dataset.store ?? "unknown",
    });
    if (!["squad", "publicSquad", "plan", "event", "friend"].includes(kind)) return;
    event.preventDefault();
    const destination = event.currentTarget.href;
    const inviteUrl = window.location.href;
    let preservationMethod = "textarea";
    let preserved = false;
    try {
      // Keep this synchronous while still inside the click gesture. Safari
      // preview iframes often reject navigator.clipboard before navigation.
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      preserved = document.execCommand("copy");
      textarea.remove();
      if (!preserved && navigator.clipboard) {
        preservationMethod = "clipboard";
        await navigator.clipboard.writeText(inviteUrl);
        preserved = true;
      }
    } catch {
      // The visible code/link remains a usable manual fallback.
    } finally {
      trackEvent("invite_link_preservation", {
        invite_type: kind,
        method: preservationMethod,
        result: preserved ? "success" : "failed",
      });
      window.location.assign(destination);
    }
  }

  async function copyInviteCode() {
    if (!code) return;
    let copied = false;
    try {
      // execCommand must run synchronously in the click gesture. It works in
      // embedded previews where the async Clipboard API may be blocked.
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
      if (!copied && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        copied = true;
      }
    } catch {
      copied = false;
    }
    setCopyStatus(copied ? "success" : "failed");
    trackEvent("invite_code_copy", {
      invite_type: kind,
      result: copied ? "success" : "failed",
    });
  }

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Helmet>
        <title>{`${title} · SquadZ`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,10,15,0.78)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", height: 66 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", color: T.text }}>
            <SquadzIcon size={34} style={{ borderRadius: 10 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.04em" }}>SquadZ</span>
          </a>
        </div>
      </nav>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 440 }}>
          <div style={{ fontSize: 72, marginBottom: 12 }}>{emoji}</div>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 14px", background: ACCENT_GRADIENT, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            {title}
          </h1>
          <p style={{ fontSize: 16.5, color: T.textSub, margin: "0 0 28px", lineHeight: 1.6 }}>{sub}</p>

          {code && !inviteUnavailable ? (
            <div style={{ margin: "0 0 28px" }}>
              <div style={{ fontSize: 13, color: T.textDim, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                {kind === "friend" ? "Friend code" : "Invite code"}
              </div>
              <div style={{ display: "inline-flex", alignItems: "stretch", gap: 8, maxWidth: "100%" }}>
                <div
                  style={{
                    display: "inline-flex", alignItems: "center", padding: "12px 18px", borderRadius: 12,
                    border: `1.5px dashed ${T.border}`, background: "rgba(255,255,255,0.04)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 22, fontWeight: 700, letterSpacing: "0.12em", userSelect: "all",
                  }}
                >
                  {code}
                </div>
                <button
                  type="button"
                  onClick={copyInviteCode}
                  aria-label="Copy invite code"
                  style={{
                    border: `1px solid ${T.border}`, borderRadius: 12, padding: "0 16px",
                    background: T.surfaceUp, color: T.text, fontFamily: font, fontSize: 14,
                    fontWeight: 800, cursor: "pointer",
                  }}
                >
                  {copyStatus === "success" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div role="status" aria-live="polite" style={{ minHeight: 18, fontSize: 12.5, color: copyStatus === "failed" ? T.gold : T.textDim, marginTop: 8 }}>
                {copyStatus === "success"
                  ? "Invite code copied."
                  : copyStatus === "failed"
                    ? "Copy failed. Select the code and copy it manually."
                    : ""}
              </div>
              <p style={{ fontSize: 13.5, color: T.textDim, margin: "10px 0 0" }}>
                Already have the app? Enter this code there to accept the invite.
              </p>
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, maxWidth: 320, margin: "0 auto" }}>
            <a
              href={IOS_APP_STORE_URL}
              data-store="ios"
              onClick={copyInviteThenOpenStore}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: ACCENT_GRADIENT, color: "#fff", textDecoration: "none",
                fontWeight: 800, fontSize: 15, padding: "14px 28px", borderRadius: 14,
                boxShadow: `0 8px 28px ${T.accent}45`,
              }}
            >
              Get SquadZ on the App Store
            </a>
            {ANDROID_PLAY_STORE_URL ? (
              <a
                href={ANDROID_PLAY_STORE_URL}
                data-store="android"
                onClick={copyInviteThenOpenStore}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  background: T.surfaceUp, color: T.text, textDecoration: "none",
                  border: `1px solid ${T.border}`, fontWeight: 800, fontSize: 15,
                  padding: "13px 28px", borderRadius: 14,
                }}
              >
                Get SquadZ on Google Play
              </a>
            ) : (
              <div
                aria-label="Google Play version coming soon"
                style={{
                  border: `1px solid ${T.border}`, borderRadius: 14, padding: "12px 28px",
                  color: T.textDim, background: T.surface, fontSize: 14, fontWeight: 700,
                }}
              >
                Android · Coming soon
              </div>
            )}
          </div>
          {!inviteUnavailable ? (
            <p style={{ fontSize: 13, color: T.textDim, lineHeight: 1.5, margin: "16px 0 0" }}>
              Keep this page or copy the invite code above. After installing and
              creating your account, SquadZ will return you to this invite.
            </p>
          ) : null}
          {nativeAppUrl ? (
            <a
              href={nativeAppUrl}
              style={{ display: "inline-block", marginTop: 12, color: T.accent, fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}
            >
              Already installed? Open in SquadZ
            </a>
          ) : null}
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${T.border}`, padding: "34px 0" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SquadzIcon size={28} style={{ borderRadius: 9 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.04em" }}>SquadZ</span>
          </div>
          <div style={{ fontSize: 13.5, color: T.textDim }}>© {new Date().getFullYear()} SquadZ</div>
        </div>
      </footer>
    </div>
  );
}
