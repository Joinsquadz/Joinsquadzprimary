import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { T, font } from "@/lib/data";

function GlowBlobs() {
  return (
    <>
      <div style={{ position: "absolute", top: -60, right: -40, width: 240, height: 240, borderRadius: "50%", background: T.accent, opacity: 0.13, filter: "blur(65px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 80, left: -60, width: 180, height: 180, borderRadius: "50%", background: T.purple, opacity: 0.09, filter: "blur(55px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 80, right: -30, width: 160, height: 160, borderRadius: "50%", background: T.gold, opacity: 0.08, filter: "blur(50px)", pointerEvents: "none" }} />
    </>
  );
}

function SocialBtn({ icon, label, onPress, style = {} }: { icon: string; label: string; onPress: () => void; style?: React.CSSProperties }) {
  const [p, setP] = useState(false);
  return (
    <button onClick={onPress} onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onMouseLeave={() => setP(false)}
      style={{ width: "100%", background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text, transform: p ? "scale(0.97)" : "scale(1)", transition: "all 0.12s", ...style }}>
      <span style={{ fontSize: 19, lineHeight: 1 }}>{icon}</span>{label}
    </button>
  );
}

export default function Signup() {
  const [, setLocation] = useLocation();
  const [screen, setScreen] = useState("options");
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);

  useEffect(() => { setTimeout(() => setVisible(true), 80); }, [screen]);

  const anim = { opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(16px)", transition: "all 0.5s cubic-bezier(0.34, 1.4, 0.64, 1)" };

  if (screen === "email") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden", position: "relative" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <button onClick={() => { setVisible(false); setTimeout(() => setScreen("options"), 80); }} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 24, textAlign: "left", width: "fit-content" }}>←</button>
          <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>✉️</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4, textAlign: "center" }}>Your email</div>
          <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font, textAlign: "center" }}>We'll send you a magic link to get in</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Email address", icon: "✉️", type: "email", val: email, set: setEmail },
              { label: "Password (8+ chars)", icon: "🔒", type: "password", val: pass, set: setPass },
            ].map(f => (
              <div key={f.label} style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>{f.icon}</span>
                <input type={f.type} placeholder={f.label} value={f.val} onChange={e => f.set(e.target.value)}
                  style={{ width: "100%", background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px 13px 44px", color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
          </div>
          <button onClick={() => setLocation("/onboarding")}
            style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 16, padding: "14px 20px", cursor: "pointer", boxShadow: `0 8px 28px ${T.accent}45` }}>
            Create Account →
          </button>
        </div>
      </div>
    </PhoneShell>
  );

  if (screen === "phone") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <button onClick={() => { setVisible(false); setTimeout(() => setScreen("options"), 80); }} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 24, textAlign: "left", width: "fit-content" }}>←</button>
          <div style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>📱</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4, textAlign: "center" }}>Your number</div>
          <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font, textAlign: "center" }}>We'll text you a 6-digit code — no passwords needed</div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, width: 72, textAlign: "center", flexShrink: 0 }}>+1</div>
            <input type="tel" placeholder="(555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)}
              style={{ flex: 1, background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, outline: "none" }} />
          </div>
          <button onClick={() => setScreen("otp")} style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 16, padding: "14px 20px", cursor: "pointer", boxShadow: `0 8px 28px ${T.accent}45` }}>
            Send Code →
          </button>
        </div>
      </div>
    </PhoneShell>
  );

  if (screen === "otp") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", position: "relative" }}>
          <button onClick={() => setScreen("phone")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 24, textAlign: "left", width: "fit-content" }}>←</button>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: 22, background: T.purple + "25", border: `1px solid ${T.purple}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 20 }}>💬</div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4, textAlign: "center" }}>Check your texts</div>
            <div style={{ fontSize: 14, color: T.textSub, marginBottom: 36, fontFamily: font, textAlign: "center" }}>Sent to (555) 000-0000 · <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => setScreen("phone")}>Change</span></div>
            <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
              {code.map((c, i) => (
                <input key={i} value={c} maxLength={1} onChange={e => {
                  const v = e.target.value.replace(/\D/, "").slice(-1);
                  const n = [...code]; n[i] = v; setCode(n);
                  if (v && i < 5) { const next = document.querySelectorAll<HTMLInputElement>(".otp-box")[i + 1]; next?.focus(); }
                }} className="otp-box" style={{ width: 44, height: 54, borderRadius: 13, background: c ? T.accentDim : T.surfaceUp, border: `2px solid ${c ? T.accent : T.border}`, color: T.white, fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 700, textAlign: "center", outline: "none", transition: "all 0.15s" }} />
              ))}
            </div>
            <button onClick={() => setLocation("/onboarding")} style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 16, padding: "14px 20px", cursor: "pointer", boxShadow: `0 8px 28px ${T.accent}45`, marginBottom: 14 }}>
              Verify →
            </button>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>Didn't get it? <span style={{ color: T.accent, cursor: "pointer" }}>Resend code</span></div>
          </div>
        </div>
      </div>
    </PhoneShell>
  );

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <GlowBlobs />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px", overflowY: "auto", position: "relative" }}>
          <button onClick={() => setLocation("/")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0, marginBottom: 20, textAlign: "left", width: "fit-content" }}>←</button>

          {/* Header */}
          <div style={{ ...anim, textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 32, fontWeight: 700, color: T.white, lineHeight: 1.1, marginBottom: 6 }}>
              Your squad<br />awaits. 🎉
            </div>
            <div style={{ fontSize: 14, color: T.textSub, fontFamily: font }}>
              Join 50,000+ friend groups planning smarter
            </div>
          </div>

          {/* Auth buttons */}
          <div style={{ ...anim, display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            <button onClick={() => setLocation("/onboarding")}
              style={{ width: "100%", background: "#1877F2", borderRadius: 14, border: "none", padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", fontFamily: font, fontWeight: 800, fontSize: 15, color: "#fff" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Continue with Facebook
            </button>
            <button onClick={() => setLocation("/onboarding")}
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
              <span style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>or sign up with</span>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>

            <SocialBtn icon="✉️" label="Continue with Email" onPress={() => setScreen("email")} />
            <SocialBtn icon="📱" label="Continue with Phone" onPress={() => setScreen("phone")} />
          </div>

          {/* Feature preview */}
          <div style={{ ...anim, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: T.textDim, fontFamily: font, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>What you'll get</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { icon: "⚡", text: "Plan events in minutes, not group threads" },
                { icon: "🍔", text: "Coordinate food — who brings what" },
                { icon: "💸", text: "Split costs automatically" },
                { icon: "🗳️", text: "Settle debates with one-tap polls" },
              ].map(f => (
                <div key={f.icon} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 16 }}>{f.icon}</span>
                  <span style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>{f.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: "6px 24px 32px", textAlign: "center", flexShrink: 0, position: "relative" }}>
          <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, lineHeight: 1.7 }}>
            By continuing you agree to our <span style={{ color: T.textSub }}>Terms</span> & <span style={{ color: T.textSub }}>Privacy Policy</span>
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
