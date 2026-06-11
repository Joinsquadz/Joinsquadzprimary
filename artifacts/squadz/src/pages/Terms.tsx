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

export default function Terms() {
  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh" }}>
      <Helmet>
        <title>Terms of Service · Squadz</title>
        <meta name="description" content="Read the Squadz Terms of Service. Learn about your rights and responsibilities when using the Squadz app." />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://joinsquadz.com/terms" />
        <meta property="og:title" content="Terms of Service · Squadz" />
        <meta property="og:description" content="Read the Squadz Terms of Service. Learn about your rights and responsibilities when using the Squadz app." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://joinsquadz.com/terms" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Terms of Service · Squadz" />
        <meta name="twitter:description" content="Read the Squadz Terms of Service. Learn about your rights and responsibilities when using the Squadz app." />
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

      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,10,15,0.78)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.border}` }}>
        <div className="lz-wrap" style={{ display: "flex", alignItems: "center", height: 66 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", color: T.text }}>
            <SquadzIcon size={34} style={{ borderRadius: 10 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.04em" }}>squadz</span>
          </a>
        </div>
      </nav>

      <div className="lz-prose">
        <h1 style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px" }}>Terms of Service</h1>
        <p style={{ fontSize: 14, color: T.textDim, marginBottom: 48 }}>Last updated: June 10, 2026</p>

        <Section title="Acceptance of Terms">
          <p>
            Welcome to Squadz. By downloading, installing, or using the Squadz mobile application or website (collectively,
            the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms,
            do not access or use the Service.
          </p>
          <p>
            We may update these Terms from time to time. Continued use of the Service after any changes constitutes your
            acceptance of the revised Terms. We will notify you of material changes via in-app notification or email.
          </p>
        </Section>

        <Section title="Description of Service">
          <p>
            Squadz is a social coordination app for friend groups. The Service allows you to:
          </p>
          <ul>
            <li>Create and join "squads" (private groups) with your friends</li>
            <li>Poll group availability and identify optimal meeting times</li>
            <li>Plan events, send invitations, and track RSVPs</li>
            <li>Message your squad through group chats tied to events</li>
            <li>Share photos in a private squad vault</li>
            <li>Track and split costs for shared expenses</li>
            <li>Access premium features through a Squadz Pro subscription</li>
          </ul>
        </Section>

        <Section title="Eligibility &amp; Accounts">
          <p>
            You must be at least 13 years old to use Squadz. By creating an account, you represent that you meet this
            age requirement and that all information you provide is accurate and complete.
          </p>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activity
            that occurs under your account. Notify us immediately at{" "}
            <a href="mailto:support@joinsquadz.com">support@joinsquadz.com</a> if you suspect unauthorized access to
            your account.
          </p>
          <p>
            You may not create accounts for others without their permission, impersonate any person or entity, or
            otherwise misrepresent your identity.
          </p>
        </Section>

        <Section title="User Content">
          <p>
            You retain ownership of content you submit to Squadz, including photos, messages, and profile information
            ("User Content"). By submitting User Content, you grant Squadz a limited, non-exclusive, royalty-free
            license to store, display, and distribute that content solely as necessary to provide the Service to you
            and the members of your squads.
          </p>
          <p>
            You represent and warrant that you own or have the necessary rights to your User Content, and that it does
            not infringe the rights of any third party. You are solely responsible for the User Content you submit.
          </p>
          <p>
            We do not sell your User Content or use it to train AI models.
          </p>
        </Section>

        <Section title="Prohibited Conduct">
          <p>You agree not to use the Service to:</p>
          <ul>
            <li>Post or transmit content that is illegal, harassing, defamatory, obscene, or invasive of another's privacy</li>
            <li>Impersonate any person or entity or misrepresent your affiliation with any person or entity</li>
            <li>Upload or share content that infringes any intellectual property rights</li>
            <li>Distribute spam, unsolicited messages, or pyramid schemes</li>
            <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure</li>
            <li>Scrape, crawl, or use automated means to access or collect data from the Service</li>
            <li>Interfere with or disrupt the integrity or performance of the Service</li>
            <li>Use the Service for any unlawful purpose or in violation of any applicable law or regulation</li>
          </ul>
          <p>
            We reserve the right to suspend or terminate accounts that violate these prohibitions without notice.
          </p>
        </Section>

        <Section title="Squadz Pro Subscription">
          <p>
            Squadz offers a "Squadz Pro" subscription that provides access to premium features including unlimited
            events, additional squad slots, and priority support. Subscription pricing and feature details are
            displayed in the app before purchase.
          </p>
          <p>
            Subscriptions are billed on a recurring basis (monthly or annual) through the Apple App Store or
            Google Play Store, depending on your platform. Subscription management and cancellation must be done
            through your respective app store account settings. We do not process subscription payments directly.
          </p>
          <p>
            Refunds for in-app purchases are governed by Apple's or Google's refund policies. We do not issue
            refunds outside those policies.
          </p>
        </Section>

        <Section title="Intellectual Property">
          <p>
            All rights, title, and interest in and to the Service — including the Squadz name, logo, app design,
            software, and content created by Squadz — are and remain the exclusive property of Squadz and its
            licensors. These Terms do not grant you any right, title, or interest in the Service other than a
            limited license to use it as described herein.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            You may delete your account at any time from Settings → Privacy → Delete Account in the Squadz app.
            Deletion permanently removes your profile, content, and squad memberships, subject to our data
            retention obligations described in our{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>
          <p>
            We reserve the right to suspend or terminate your access to the Service at any time, with or without
            cause or notice, including for violation of these Terms.
          </p>
        </Section>

        <Section title="Disclaimers">
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
            INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF
            HARMFUL COMPONENTS.
          </p>
        </Section>

        <Section title="Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SQUADZ AND ITS OFFICERS, DIRECTORS, EMPLOYEES,
            AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
            DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF ADVISED
            OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY TO YOU FOR ANY CLAIMS ARISING UNDER THESE
            TERMS SHALL NOT EXCEED THE AMOUNT YOU PAID TO SQUADZ IN THE TWELVE MONTHS PRECEDING THE CLAIM.
          </p>
        </Section>

        <Section title="Governing Law">
          <p>
            These Terms are governed by the laws of the State of Delaware, without regard to its conflict-of-law
            principles. Any dispute arising from these Terms shall be resolved by binding arbitration under the
            rules of the American Arbitration Association, except that either party may seek injunctive relief
            in a court of competent jurisdiction to prevent irreparable harm.
          </p>
        </Section>

        <Section title="Contact Us">
          <p>
            If you have questions about these Terms, please contact us:
          </p>
          <p>
            <strong style={{ color: T.text }}>Email:</strong>{" "}
            <a href="mailto:support@joinsquadz.com">support@joinsquadz.com</a>
          </p>
        </Section>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 32, marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
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
          <a
            href="/privacy"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: T.surfaceUp, border: `1px solid ${T.border}`,
              color: T.textSub, textDecoration: "none",
              fontWeight: 600, fontSize: 14, padding: "11px 20px", borderRadius: 12,
            }}
          >
            Privacy Policy →
          </a>
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${T.border}`, padding: "34px 0" }}>
        <div className="lz-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SquadzIcon size={28} style={{ borderRadius: 9 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.04em" }}>squadz</span>
          </div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            <a href="/terms" style={{ fontSize: 13.5, color: T.textDim, textDecoration: "none" }}>Terms of Service</a>
            <a href="/privacy" style={{ fontSize: 13.5, color: T.textDim, textDecoration: "none" }}>Privacy Policy</a>
            <div style={{ fontSize: 13.5, color: T.textDim }}>© {new Date().getFullYear()} Squadz</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
