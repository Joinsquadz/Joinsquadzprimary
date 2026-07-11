import { Helmet } from "react-helmet-async";
import { T, font } from "@/lib/data";
import { SquadzIcon } from "@/components/SquadzIcon";

const ACCENT_GRADIENT = `linear-gradient(135deg, ${T.accent} 0%, ${T.gold} 100%)`;
const SUPPORT_EMAIL = "javier@joinsquadz.com";

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is Squadz?",
    a: (
      <>
        Squadz is a mobile app for friend groups. Create a squad, find the time everyone's actually
        free with an availability overlap, plan events with RSVPs, chat in a thread tied to the plan,
        share a group photo vault, and split costs — all in one place.
      </>
    ),
  },
  {
    q: "Is my data private?",
    a: (
      <>
        Yes. Your squad data is only visible to members of the squads you join, and we never sell your
        personal information. For full details, see our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </>
    ),
  },
  {
    q: "How do I delete my account?",
    a: (
      <>
        Open the Squadz app and go to Settings → Account → Delete Account. This permanently removes
        your account and associated data. If you can't access the app, email us at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we'll help.
      </>
    ),
  },
  {
    q: "I found a bug or need help.",
    a: (
      <>
        We'd love to hear from you. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with
        as much detail as you can (what happened, your device, and steps to reproduce) and we'll get
        back to you.
      </>
    ),
  },
];

export default function Support() {
  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh" }}>
      <Helmet>
        <title>Support · Squadz</title>
        <meta name="description" content="Get help with Squadz. Contact our support team and read answers to common questions about the Squadz app." />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://joinsquadz.com/support" />
        <meta property="og:title" content="Support · Squadz" />
        <meta property="og:description" content="Get help with Squadz. Contact our support team and read answers to common questions about the Squadz app." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://joinsquadz.com/support" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Support · Squadz" />
        <meta name="twitter:description" content="Get help with Squadz. Contact our support team and read answers to common questions about the Squadz app." />
      </Helmet>
      <style>{`
        .lz-wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
        .lz-prose { max-width: 720px; margin: 0 auto; padding: 56px 24px 100px; }
        .lz-prose a { color: ${T.accent}; text-decoration: none; }
        .lz-prose a:hover { text-decoration: underline; }
        .lz-prose p { margin: 0 0 16px; }
      `}</style>

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,10,15,0.78)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.border}` }}>
        <div className="lz-wrap" style={{ display: "flex", alignItems: "center", height: 66 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", color: T.text }}>
            <SquadzIcon size={34} style={{ borderRadius: 10 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.04em" }}>squadz</span>
          </a>
        </div>
      </nav>

      <div className="lz-prose">
        <h1 style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px" }}>Support</h1>
        <p style={{ fontSize: 15.5, color: T.textSub, lineHeight: 1.72, marginBottom: 44 }}>
          Need a hand with Squadz? Check the common questions below, or reach out and we'll help.
        </p>

        {/* FAQ */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 20, letterSpacing: "-0.02em" }}>
            Frequently asked
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {FAQS.map((f) => (
              <div
                key={f.q}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: 14,
                  padding: "18px 20px",
                }}
              >
                <h3 style={{ fontSize: 16.5, fontWeight: 700, color: T.text, margin: "0 0 8px", letterSpacing: "-0.01em" }}>
                  {f.q}
                </h3>
                <div style={{ fontSize: 15, color: T.textSub, lineHeight: 1.65 }}>{f.a}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 18,
            padding: "32px 28px",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 8, letterSpacing: "-0.02em" }}>
            Still need help?
          </h2>
          <p style={{ fontSize: 15, color: T.textSub, lineHeight: 1.65, marginBottom: 22 }}>
            Email our team directly and we'll get back to you as soon as we can.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              background: ACCENT_GRADIENT,
              color: "#fff",
              textDecoration: "none",
              fontWeight: 800,
              fontSize: 15,
              padding: "13px 26px",
              borderRadius: 12,
              boxShadow: `0 6px 20px ${T.accent}40`,
            }}
          >
            ✉ {SUPPORT_EMAIL}
          </a>
        </section>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 32, marginTop: 40 }}>
          <a
            href="/"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "transparent", color: T.text, textDecoration: "none",
              fontWeight: 700, fontSize: 14, padding: "11px 20px", borderRadius: 12,
              border: `1px solid ${T.border}`,
            }}
          >
            ← Back to Squadz
          </a>
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${T.border}`, padding: "34px 0" }}>
        <div className="lz-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SquadzIcon size={28} style={{ borderRadius: 9 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.04em" }}>squadz</span>
          </div>
          <div style={{ fontSize: 13.5, color: T.textDim }}>© {new Date().getFullYear()} Squadz · Stop texting. Start actually hanging.</div>
        </div>
      </footer>
    </div>
  );
}
