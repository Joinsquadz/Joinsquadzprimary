import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn, Input } from "@/components/shared";
import { T, font } from "@/lib/data";

export default function Signup() {
  const [, setLocation] = useLocation();
  const [screen, setScreen] = useState("options");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);

  if (screen === "email") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px", overflowY: "auto" }}>
        <button onClick={() => setScreen("options")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Create Account</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Enter your email and a password</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          <Input placeholder="Email address" type="email" icon="✉️" value={email} onChange={setEmail} />
          <Input placeholder="Create password (8+ chars)" type="password" icon="🔒" value={pass} onChange={setPass} />
        </div>
        <Btn onPress={() => setLocation("/onboarding")}>Create My Account →</Btn>
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
          Already have an account? <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => setLocation("/login")}>Sign in</span>
        </div>
      </div>
    </PhoneShell>
  );

  if (screen === "phone") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px", overflowY: "auto" }}>
        <button onClick={() => setScreen("options")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Your Number</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>We'll send a 6-digit code to verify</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 12, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, width: 70, textAlign: "center", flexShrink: 0 }}>+1</div>
          <div style={{ flex: 1 }}><Input placeholder="(555) 000-0000" type="tel" value={phone} onChange={setPhone} /></div>
        </div>
        <Btn onPress={() => setScreen("otp")}>Send Code</Btn>
      </div>
    </PhoneShell>
  );

  if (screen === "otp") return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px", overflowY: "auto" }}>
        <button onClick={() => setScreen("phone")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Enter Code</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 36, fontFamily: font }}>Sent to (555) 000-0000 · <span style={{ color: T.accent }}>Change</span></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 32 }}>
          {code.map((c, i) => (
            <input key={i} value={c} maxLength={1} onChange={e => {
              const newCode = [...code]; newCode[i] = e.target.value.slice(-1); setCode(newCode);
            }} style={{ width: 46, height: 56, borderRadius: 12, background: T.surfaceUp, border: `2px solid ${c ? T.accent : T.border}`, color: T.white, fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 700, textAlign: "center", outline: "none" }} />
          ))}
        </div>
        <Btn onPress={() => setLocation("/onboarding")}>Verify →</Btn>
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
          Didn't get a code? <span style={{ color: T.accent, cursor: "pointer" }}>Resend</span>
        </div>
      </div>
    </PhoneShell>
  );

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px", overflowY: "auto" }}>
        <button onClick={() => setLocation("/")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", marginBottom: 16, padding: 0 }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 30, fontWeight: 700, color: T.white, marginBottom: 6 }}>Join Squadz</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 36, fontFamily: font }}>Create your account to start planning</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Btn variant="apple" onPress={() => setLocation("/onboarding")}>
            <span style={{ fontSize: 18 }}>🍎</span> Continue with Apple
          </Btn>
          <Btn variant="google" onPress={() => setLocation("/onboarding")}>
            <span style={{ fontSize: 18 }}>G</span> Continue with Google
          </Btn>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
            <div style={{ flex: 1, height: 1, background: T.border }} />
            <span style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>or</span>
            <div style={{ flex: 1, height: 1, background: T.border }} />
          </div>
          <Btn variant="secondary" onPress={() => setScreen("email")}>Continue with Email</Btn>
          <Btn variant="secondary" onPress={() => setScreen("phone")}>Continue with Phone</Btn>
        </div>
        <div style={{ marginTop: "auto", paddingTop: 32, fontSize: 12, color: T.textDim, textAlign: "center", fontFamily: font, lineHeight: 1.7 }}>
          By continuing you agree to our <span style={{ color: T.accent }}>Terms of Service</span> and <span style={{ color: T.accent }}>Privacy Policy</span>
        </div>
      </div>
    </PhoneShell>
  );
}
