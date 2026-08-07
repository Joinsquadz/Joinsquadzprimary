import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { T, font } from "@/lib/data";
import { SquadzIcon } from "@/components/SquadzIcon";

const ACCENT_GRADIENT = `linear-gradient(135deg, ${T.accent} 0%, ${T.gold} 100%)`;

type SquadPreview = {
  name: string;
  emoji: string;
  memberCount: number;
  creatorFirstName: string | null;
};

type LinkKind = "squad" | "publicSquad" | "event" | "friend" | "poll";

/**
 * Web fallback for app deep links (squad/event/friend invites, polls).
 *
 * Invite links are branded joinsquadz.com/... — on iPhones with the app
 * installed, universal links open the app directly. Everyone else lands
 * here, so this page must never 404: it explains the invite, surfaces the
 * code so it can be entered manually in the app, and points at the app.
 */
export default function OpenInApp({ kind }: { kind: LinkKind }) {
  const query = useMemo(
    () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""),
    [],
  );
  const pathParts = useMemo(
    () => (typeof window !== "undefined" ? window.location.pathname.split("/").filter(Boolean) : []),
    [],
  );

  // Code the recipient can type into the app manually, when the link carries one.
  const code =
    kind === "squad"
      ? query.get("code")
      : kind === "event" || kind === "friend"
        ? pathParts[pathParts.length - 1] ?? null
        : null;

  const [preview, setPreview] = useState<SquadPreview | null>(null);

  // Best-effort rich preview for private squad invites (same unauthenticated
  // endpoint the app uses). Non-fatal: generic copy if it can't load.
  useEffect(() => {
    if (kind !== "squad" || !code) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/squads/preview?code=${encodeURIComponent(code)}`);
        if (res.ok) {
          const data = (await res.json()) as SquadPreview;
          if (!cancelled) setPreview(data);
        }
      } catch {
        // keep generic copy
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, code]);

  const copy: Record<LinkKind, { emoji: string; title: string; sub: string }> = {
    squad: {
      emoji: preview?.emoji ?? "🎉",
      title: preview
        ? `You're invited to ${preview.name}!`
        : "You're invited to a squad!",
      sub: preview
        ? `${preview.creatorFirstName ? `${preview.creatorFirstName} and ` : ""}${preview.memberCount} ${preview.memberCount === 1 ? "friend is" : "friends are"} planning hangouts on SquadZ. Open this link on your phone to join them.`
        : "A friend invited you to their squad on SquadZ. Open this link on your phone to join them.",
    },
    publicSquad: {
      emoji: "🌎",
      title: "You're invited to a squad!",
      sub: "This squad is open to join. Open this link on your phone with SquadZ installed to jump in.",
    },
    event: {
      emoji: "📅",
      title: "You're invited to a hangout!",
      sub: "A friend wants you at their event. Open this link on your phone with SquadZ installed to RSVP.",
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

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Helmet>
        <title>{title} · SquadZ</title>
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

          {code ? (
            <div style={{ margin: "0 0 28px" }}>
              <div style={{ fontSize: 13, color: T.textDim, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                {kind === "friend" ? "Friend code" : "Invite code"}
              </div>
              <div
                style={{
                  display: "inline-block", padding: "12px 22px", borderRadius: 12,
                  border: `1.5px dashed ${T.border}`, background: "rgba(255,255,255,0.04)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 22, fontWeight: 700, letterSpacing: "0.12em", userSelect: "all",
                }}
              >
                {code}
              </div>
              <p style={{ fontSize: 13.5, color: T.textDim, margin: "10px 0 0" }}>
                Already have the app? Enter this code there to accept the invite.
              </p>
            </div>
          ) : null}

          <a
            href="/"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: ACCENT_GRADIENT, color: "#fff", textDecoration: "none",
              fontWeight: 800, fontSize: 15, padding: "14px 28px", borderRadius: 14,
              boxShadow: `0 8px 28px ${T.accent}45`,
            }}
          >
            Get SquadZ
          </a>
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
