import { Helmet } from "react-helmet-async";
import { T, font } from "@/lib/data";
import { SquadzIcon } from "@/components/SquadzIcon";

const ACCENT_GRADIENT = `linear-gradient(135deg, ${T.accent} 0%, ${T.gold} 100%)`;

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 44 }}>
    <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 14, letterSpacing: "-0.02em" }}>{title}</h2>
    <div style={{ fontSize: 15.5, color: T.textSub, lineHeight: 1.72 }}>{children}</div>
  </section>
);

export default function Privacy() {
  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh" }}>
      <Helmet>
        <title>Privacy Policy · Squadz</title>
        <meta name="description" content="Read the Squadz Privacy Policy. Learn how we collect, use, and protect your personal information when you use the Squadz app." />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://joinsquadz.com/privacy" />
        <meta property="og:title" content="Privacy Policy · Squadz" />
        <meta property="og:description" content="Read the Squadz Privacy Policy. Learn how we collect, use, and protect your personal information when you use the Squadz app." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://joinsquadz.com/privacy" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Privacy Policy · Squadz" />
        <meta name="twitter:description" content="Read the Squadz Privacy Policy. Learn how we collect, use, and protect your personal information when you use the Squadz app." />
      </Helmet>
      <style>{`
        .lz-wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
        .lz-prose { max-width: 720px; margin: 0 auto; padding: 56px 24px 100px; }
        .lz-prose a { color: ${T.accent}; text-decoration: none; }
        .lz-prose a:hover { text-decoration: underline; }
        .lz-prose p { margin: 0 0 16px; }
        .lz-prose ul { margin: 0 0 16px; padding-left: 22px; }
        .lz-prose li { margin-bottom: 8px; }
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
        <h1 style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px" }}>Privacy Policy</h1>
        <p style={{ fontSize: 14, color: T.textDim, marginBottom: 48 }}>Last updated: June 10, 2026</p>

        <Section title="Overview">
          <p>
            Squadz ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect,
            use, disclose, and safeguard your information when you use the Squadz mobile application and website (collectively, the "Service").
          </p>
          <p>
            By using Squadz, you agree to the collection and use of information in accordance with this policy. If you do not
            agree with the terms of this policy, please do not access or use the Service.
          </p>
        </Section>

        <Section title="Information We Collect">
          <p>We collect the following types of information:</p>
          <ul>
            <li><strong style={{ color: T.text }}>Account information</strong> — name, email address, and optional profile details (bio, hometown, avatar) that you provide when you register.</li>
            <li><strong style={{ color: T.text }}>Squad and social data</strong> — squads you create or join, events you RSVP to, availability you mark, and friends you connect with.</li>
            <li><strong style={{ color: T.text }}>Photos and media</strong> — images you upload to squad photo vaults.</li>
            <li><strong style={{ color: T.text }}>Messages</strong> — content you send in squad group chats.</li>
            <li><strong style={{ color: T.text }}>Payment information</strong> — cost-split records and payment handles you share within your squads. We do not process or store credit card numbers.</li>
            <li><strong style={{ color: T.text }}>Device information</strong> — device type, operating system, push notification tokens, and app version for service functionality and crash reporting.</li>
            <li><strong style={{ color: T.text }}>Usage data</strong> — how you interact with the app, including features used and screens visited, collected via analytics tools.</li>
          </ul>
        </Section>

        <Section title="How We Use Your Information">
          <p>We use the information we collect to:</p>
          <ul>
            <li>Create and manage your account and authenticate your identity</li>
            <li>Operate squad features: availability polling, event planning, group chat, and photo sharing</li>
            <li>Send push notifications for squad activity (configurable in your settings)</li>
            <li>Send transactional emails (account verification, password reset)</li>
            <li>Monitor and improve app performance, fix bugs, and detect errors</li>
            <li>Analyze aggregate usage patterns to improve the product</li>
            <li>Comply with legal obligations</li>
          </ul>
          <p>We do not sell your personal information to third parties.</p>
        </Section>

        <Section title="Information Sharing">
          <p>Your information is shared only in the following circumstances:</p>
          <ul>
            <li><strong style={{ color: T.text }}>With squad members</strong> — your name, avatar, and availability are visible to members of squads you join. Photos you share in a squad vault are visible to all members of that squad.</li>
            <li><strong style={{ color: T.text }}>Service providers</strong> — we use trusted third-party services to operate Squadz, including Supabase (database and authentication), Expo (push notifications), Sentry (error monitoring), and PostHog (analytics). These providers access your data only as necessary to perform their services and are bound by confidentiality obligations.</li>
            <li><strong style={{ color: T.text }}>Legal requirements</strong> — we may disclose your information if required to do so by law or in response to valid requests by public authorities.</li>
            <li><strong style={{ color: T.text }}>Business transfers</strong> — if Squadz is acquired or merged with another company, your information may be transferred as part of that transaction.</li>
          </ul>
        </Section>

        <Section title="Data Retention">
          <p>
            We retain your personal information for as long as your account is active or as needed to provide you the Service.
            You may request deletion of your account and associated data at any time by contacting us at{" "}
            <a href="mailto:privacy@joinsquadz.com">privacy@joinsquadz.com</a>. Some data may be retained for a limited period
            to comply with legal obligations or resolve disputes.
          </p>
        </Section>

        <Section title="Push Notifications">
          <p>
            Squadz may send push notifications to your device for squad activity, event reminders, and messages. You can
            manage notification preferences in the Squadz app under Settings → Notifications, or through your device's
            system settings. Disabling notifications does not affect your account or data.
          </p>
        </Section>

        <Section title="Photos and Media">
          <p>
            Photos you upload to squad vaults are stored securely and are only accessible to members of the squad they were
            shared with. Squadz requests access to your device's photo library solely to let you select and upload photos —
            we do not scan or access photos you haven't chosen to share.
          </p>
        </Section>

        <Section title="Children's Privacy">
          <p>
            Squadz is not directed to children under the age of 13. We do not knowingly collect personal information from
            children under 13. If you believe we have inadvertently collected such information, please contact us immediately
            at <a href="mailto:privacy@joinsquadz.com">privacy@joinsquadz.com</a>.
          </p>
        </Section>

        <Section title="Your Rights">
          <p>Depending on your location, you may have the right to:</p>
          <ul>
            <li>Access the personal information we hold about you</li>
            <li>Correct inaccurate personal information</li>
            <li>Request deletion of your personal information</li>
            <li>Object to or restrict certain processing of your data</li>
            <li>Data portability (receive your data in a structured format)</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at <a href="mailto:privacy@joinsquadz.com">privacy@joinsquadz.com</a>.
            We will respond within 30 days.
          </p>
        </Section>

        <Section title="Security">
          <p>
            We implement industry-standard security measures to protect your information, including encrypted data transmission
            (HTTPS/TLS), encrypted data storage, and access controls. However, no method of transmission over the internet or
            electronic storage is 100% secure, and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="Third-Party Links">
          <p>
            The Service may contain links to third-party websites or services. We are not responsible for the privacy practices
            of those third parties and encourage you to review their privacy policies.
          </p>
        </Section>

        <Section title="Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify you of significant changes by updating the
            "Last updated" date at the top of this page and, where appropriate, by sending you an in-app notification or
            email. Your continued use of the Service after any changes constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title="Contact Us">
          <p>
            If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
          </p>
          <p>
            <strong style={{ color: T.text }}>Email:</strong>{" "}
            <a href="mailto:privacy@joinsquadz.com">privacy@joinsquadz.com</a>
          </p>
        </Section>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 32, marginTop: 16 }}>
          <a
            href="/"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: ACCENT_GRADIENT, color: "#fff", textDecoration: "none",
              fontWeight: 800, fontSize: 14, padding: "11px 20px", borderRadius: 12,
              boxShadow: `0 6px 20px ${T.accent}40`,
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
