import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { T, font } from "@/lib/data";
import { inviteStore } from "@/lib/inviteStore";

function GlowBlobs() {
  return (
    <>
      <div style={{ position: "absolute", top: -60, right: -40, width: 240, height: 240, borderRadius: "50%", background: T.accent, opacity: 0.1, filter: "blur(65px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 80, left: -60, width: 180, height: 180, borderRadius: "50%", background: T.blue, opacity: 0.08, filter: "blur(55px)", pointerEvents: "none" }} />
    </>
  );
}

function InviteBanner({ emoji, title, host }: { emoji: string; title: string; host: string }) {
  return (
    <div style={{ background: `linear-gradient(135deg, ${T.accent}20, ${T.gold}12)`, border: `1px solid ${T.accent}40`, borderRadius: 14, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: T.accent + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: T.accent, fontFamily: font, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>You've been invited to join</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.white, fontFamily: font, marginBottom: 1 }}>{title}</div>
        <div style={{ fontSize: 12, color: T.textSub, fontFamily: font }}>Hosted by {host}</div>
      </div>
      <div style={{ fontSize: 18 }}>🎉</div>
    </div>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const [invCtx] = useState(() => inviteStore.get());
  const [screen, setScreen] = useState("options");
  const [prevScreen, setPrevScreen] = useState("options");
  const [provider, setProvider] = useState<"facebook" | "google" | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [visible, setVisible] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => { setTimeout(() => setVisible(true), 80); }, [screen]);
  const anim = { opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(16px)", transition: "all 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)" };

  const goScreen = (to: string, from?: string) => {
    setVisible(false);
    if (from) setPrevScreen(from);
    setTimeout(() => setScreen(to), 80);
  };

  const goSocial = (p: "facebook" | "google") => {
    setProvider(p);
    setVisible(false);
    setTimeout(() => setScreen("social-phone"), 80);
  };

  const goOtp = (from: string) => {
    setPrevScreen(from);
    setVisible(false);
    setTimeout(() => setScreen("otp"), 80);
  };

  const BackBtn = ({ to }: { to: string }) => (
    <button onClick={() => goScreen(to)} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 24, textAlign: "left", width: "fit-content" }}>←</button>
  );

  const inputStyle: React.CSSProperties = {
    width: "100%", background: T.surfaceUp, border: `1.5px solid ${T.border}`,
    borderRadius: 13, padding: "13px 14px 13px 44px", color: T.text,
    fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box",
  };

  const Field = ({ icon, placeholder, type, value, onChange }: { icon: string; placeholder: string; type: string; value: string; onChange: (v: string) => void }) => (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>{icon}</span>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );

  const PrimaryBtn = ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button onClick={onPress} style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 16, padding: "14px 20px", cursor: "pointer", boxShadow: `0 8px 28px ${T.accent}45` }}>
      {children}
    </button>
  );

  // ── Social phone screen ─────────────────────────────────────────────
  if (screen === "social-phone") {
    const isFB = provider === "facebook";
    const providerColor = isFB ? "#1877F2" : "#4285F4";
    const mockName = "Alex Johnson";
    const mockEmail = isFB ? "alex.johnson@facebook.com" : "alex.johnson@gmail.com";
    return (
      <PhoneShell>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
          <GlowBlobs />
          <div style={{ background: isFB ? "#1877F2" : `linear-gradient(135deg, #4285F4, #34A853)`, padding: "48px 24px 20px", position: "relative", flexShrink: 0 }}>
            <button onClick={() => goScreen("options")} style={{ position: "absolute", top: 20, left: 16, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 20, color: "#fff", fontSize: 16, cursor: "pointer", padding: "4px 10px", fontFamily: font }}>←</button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: font, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
                {isFB ? "Facebook" : "Google"} connected ✓
              </div>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: "#fff" }}>Welcome back, Alex!</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 24px 20px", overflowY: "auto", position: "relative" }}>
            <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 16, padding: "16px", marginTop: -1, marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div style={{ width: 52, height: 52, borderRadius: 26, background: `linear-gradient(135deg, ${providerColor}, ${isFB ? "#4267B2" : "#0F9D58"})`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontWeight: 800, fontSize: 20, color: "#fff" }}>AJ</div>
                <div style={{ position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, background: providerColor, border: `2px solid ${T.surfaceUp}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isFB
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    : <svg width="11" height="11" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.4 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9L38.2 9C34.6 5.7 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-9 20-20 0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9L38.2 9C34.6 5.7 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.4 35.4 26.8 36 24 36c-5.2 0-9.6-3.5-11.2-8.3l-6.6 5.1C9.6 39.6 16.3 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.1-2.1 3.9-3.9 5.2l6.3 5.3C41.2 35 44 30 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
                  }
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.white, marginBottom: 2 }}>{mockName}</div>
                <div style={{ fontFamily: font, fontSize: 12, color: T.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mockEmail}</div>
              </div>
              <div style={{ fontSize: 11, color: T.green, fontFamily: font, fontWeight: 700, background: T.green + "18", borderRadius: 20, padding: "3px 8px", flexShrink: 0 }}>✓ Verified</div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.white, fontFamily: font, marginBottom: 4 }}>Verify it's you</div>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font, marginBottom: 16, lineHeight: 1.5 }}>
              We'll send a one-time code to your registered phone number.
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, width: 64, textAlign: "center", flexShrink: 0 }}>+1</div>
              <input type="tel" placeholder="(555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)}
                style={{ flex: 1, background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, outline: "none" }} />
            </div>
            <PrimaryBtn onPress={() => goOtp("social-phone")}>Send Verification Code →</PrimaryBtn>
            <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, textAlign: "center", lineHeight: 1.6, marginTop: 12 }}>
              Standard SMS rates may apply.
            </div>
          </div>
        </div>
      </PhoneShell>
    );
  }

  // ── Forgot password screen ──────────────────────────────────────────
  if (screen === "forgot") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden", position: "relative" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <BackBtn to="email" />
          <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>🔑</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4, textAlign: "center" }}>Reset password</div>
          <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font, textAlign: "center" }}>We'll send a reset link to your email</div>
          {!resetSent ? (
            <>
              <Field icon="✉️" placeholder="Email address" type="email" value={email} onChange={setEmail} />
              <div style={{ marginTop: 16 }}>
                <PrimaryBtn onPress={() => setResetSent(true)}>Send Reset Link →</PrimaryBtn>
              </div>
            </>
          ) : (
            <div style={{ background: T.green + "18", border: `1px solid ${T.green}40`, borderRadius: 14, padding: "18px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.green, marginBottom: 4 }}>Check your inbox!</div>
              <div style={{ fontSize: 13, color: T.textSub }}>A reset link was sent to {email || "your email"}.</div>
              <button onClick={() => { setResetSent(false); goScreen("email"); }} style={{ marginTop: 16, background: "none", border: "none", color: T.accent, fontFamily: font, fontSize: 14, cursor: "pointer" }}>← Back to sign in</button>
            </div>
          )}
        </div>
      </div>
    </PhoneShell>
  );

  // ── Email screen ────────────────────────────────────────────────────
  if (screen === "email") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden", position: "relative" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <BackBtn to="options" />
          <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>✉️</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4, textAlign: "center" }}>Sign in with email</div>
          <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font, textAlign: "center" }}>Enter your credentials, then verify your phone</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <Field icon="✉️" placeholder="Email address" type="email" value={email} onChange={setEmail} />
            <Field icon="🔒" placeholder="Password" type="password" value={pass} onChange={setPass} />
          </div>
          <div style={{ textAlign: "right", marginBottom: 20 }}>
            <span onClick={() => goScreen("forgot", "email")} style={{ fontSize: 13, color: T.accent, cursor: "pointer", fontFamily: font }}>Forgot password?</span>
          </div>
          <PrimaryBtn onPress={() => goScreen("email-phone", "email")}>Continue →</PrimaryBtn>
        </div>
      </div>
    </PhoneShell>
  );

  // ── Email → phone screen ────────────────────────────────────────────
  if (screen === "email-phone") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <BackBtn to="email" />
          <div style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>📱</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 6, textAlign: "center" }}>Verify your phone</div>
          <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font, textAlign: "center" }}>
            We'll send a 6-digit code to confirm it's really you
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, width: 64, textAlign: "center", flexShrink: 0 }}>+1</div>
            <input type="tel" placeholder="(555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)}
              style={{ flex: 1, background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, outline: "none" }} />
          </div>
          <PrimaryBtn onPress={() => goOtp("email-phone")}>Send Code →</PrimaryBtn>
        </div>
      </div>
    </PhoneShell>
  );

  // ── OTP screen ──────────────────────────────────────────────────────
  if (screen === "otp") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", position: "relative" }}>
          <button onClick={() => setScreen(prevScreen)} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 24, textAlign: "left", width: "fit-content" }}>←</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: 22, background: T.purple + "25", border: `1px solid ${T.purple}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 20 }}>💬</div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4, textAlign: "center" }}>Check your texts</div>
            <div style={{ fontSize: 14, color: T.textSub, marginBottom: 36, fontFamily: font, textAlign: "center" }}>
              Sent to {phone || "(555) 000-0000"} ·{" "}
              <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => setScreen(prevScreen)}>Change</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
              {code.map((c, i) => (
                <input key={i} value={c} maxLength={1} onChange={e => {
                  const v = e.target.value.replace(/\D/, "").slice(-1);
                  const n = [...code]; n[i] = v; setCode(n);
                  if (v && i < 5) { const next = document.querySelectorAll<HTMLInputElement>(".login-otp")[i + 1]; next?.focus(); }
                }} className="login-otp" style={{ width: 44, height: 54, borderRadius: 13, background: c ? T.accentDim : T.surfaceUp, border: `2px solid ${c ? T.accent : T.border}`, color: T.white, fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 700, textAlign: "center", outline: "none", transition: "all 0.15s" }} />
              ))}
            </div>
            {invCtx && (
              <div style={{ background: `${T.accent}18`, border: `1px solid ${T.accent}35`, borderRadius: 12, padding: "10px 14px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box" }}>
                <span style={{ fontSize: 20 }}>{invCtx.emoji}</span>
                <div>
                  <div style={{ fontSize: 11, color: T.accent, fontFamily: font, fontWeight: 700 }}>After sign in, you'll join</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.white, fontFamily: font }}>{invCtx.title}</div>
                </div>
              </div>
            )}
            <button onClick={() => { const dest = inviteStore.get()?.dest; inviteStore.clear(); setLocation(dest ?? "/home"); }} style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 16, padding: "14px 20px", cursor: "pointer", boxShadow: `0 8px 28px ${T.accent}45`, marginBottom: 14 }}>
              {invCtx ? `Join ${invCtx.title} →` : "Verify & Sign In →"}
            </button>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>
              Didn't get it? <span style={{ color: T.accent, cursor: "pointer" }}>Resend code</span>
            </div>
          </div>
        </div>
      </div>
    </PhoneShell>
  );

  // ── Options screen (main login) ─────────────────────────────────────
  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <button onClick={() => setLocation("/")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 24, textAlign: "left", width: "fit-content" }}>←</button>

          {invCtx && (
            <InviteBanner emoji={invCtx.emoji} title={invCtx.title} host={invCtx.host} />
          )}
          <div style={{ ...anim, textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 30, fontWeight: 700, color: T.white, lineHeight: 1.15, marginBottom: 6 }}>
              {invCtx ? "Sign in to join →" : "Welcome back 👋"}
            </div>
            <div style={{ fontSize: 14, color: T.textSub, fontFamily: font }}>
              {invCtx ? `Sign in to accept your invite to ${invCtx.title}` : "Sign in to your squad"}
            </div>
          </div>

          <div style={{ ...anim, display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {/* Facebook */}
            <button onClick={() => goSocial("facebook")}
              style={{ width: "100%", background: "#1877F2", borderRadius: 14, border: "none", padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", fontFamily: font, fontWeight: 800, fontSize: 15, color: "#fff" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Continue with Facebook
            </button>
            {/* Google */}
            <button onClick={() => goSocial("google")}
              style={{ width: "100%", background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 14, padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.4 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9L38.2 9C34.6 5.7 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-9 20-20 0-1.3-.1-2.7-.4-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 2.9L38.2 9C34.6 5.7 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.4 35.4 26.8 36 24 36c-5.2 0-9.6-3.5-11.2-8.3l-6.6 5.1C9.6 39.6 16.3 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.1-2.1 3.9-3.9 5.2l6.3 5.3C41.2 35 44 30 44 24c0-1.3-.1-2.7-.4-4z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <span style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>or sign in with</span>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>

            {/* Email */}
            <button onClick={() => goScreen("email")}
              style={{ width: "100%", background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>
              <span style={{ fontSize: 18 }}>✉️</span> Email & Phone Number
            </button>
          </div>

          <div style={{ ...anim, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
            New here? <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => setLocation("/signup")}>Create account</span>
          </div>
        </div>
        <div style={{ padding: "6px 24px 32px", textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>
            By continuing you agree to our <span style={{ color: T.textSub }}>Terms</span> & <span style={{ color: T.textSub }}>Privacy Policy</span>
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
