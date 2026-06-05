import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn, Input } from "@/components/shared";
import { T, font } from "@/lib/data";

export default function Login() {
  const [, setLocation] = useLocation();
  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px", overflowY: "auto" }}>
        <button onClick={() => setLocation("/")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Welcome Back</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Sign in to your account</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Btn variant="apple" onPress={() => setLocation("/home")}>
            <span style={{ fontSize: 18 }}>🍎</span> Continue with Apple
          </Btn>
          <Btn variant="google" onPress={() => setLocation("/home")}>
            <span style={{ fontSize: 18 }}>G</span> Continue with Google
          </Btn>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: T.border }} />
            <span style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>or</span>
            <div style={{ flex: 1, height: 1, background: T.border }} />
          </div>
          <Input placeholder="Email" type="email" icon="✉️" />
          <Input placeholder="Password" type="password" icon="🔒" />
          <div style={{ textAlign: "right" }}><span style={{ fontSize: 13, color: T.accent, cursor: "pointer", fontFamily: font }}>Forgot password?</span></div>
          <Btn onPress={() => setLocation("/home")}>Sign In</Btn>
        </div>
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
          New here? <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => setLocation("/signup")}>Create account</span>
        </div>
      </div>
    </PhoneShell>
  );
}
