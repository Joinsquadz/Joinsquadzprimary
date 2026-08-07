import { Helmet } from "react-helmet-async";
import { T, font } from "@/lib/data";
import { SquadzIcon } from "@/components/SquadzIcon";

const ACCENT_GRADIENT = `linear-gradient(135deg, ${T.accent} 0%, ${T.gold} 100%)`;

export default function NotFound() {
  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Helmet>
        <title>Page Not Found · SquadZ</title>
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
        <div>
          <div style={{ fontSize: 72, marginBottom: 8 }}>🤷</div>
          <h1 style={{ fontSize: 52, fontWeight: 800, letterSpacing: "-0.04em", margin: "0 0 16px", background: ACCENT_GRADIENT, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>404</h1>
          <p style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: "0 0 12px" }}>Page not found</p>
          <p style={{ fontSize: 16, color: T.textSub, margin: "0 0 36px", maxWidth: 380, lineHeight: 1.55 }}>
            This URL doesn't lead anywhere. Maybe the link is broken, or the page was moved.
          </p>
          <a
            href="/"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: ACCENT_GRADIENT, color: "#fff", textDecoration: "none",
              fontWeight: 800, fontSize: 15, padding: "14px 28px", borderRadius: 14,
              boxShadow: `0 8px 28px ${T.accent}45`,
            }}
          >
            ← Back to SquadZ
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
