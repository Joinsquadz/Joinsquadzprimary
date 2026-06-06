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
          <Btn variant="facebook" onPress={() => setLocation("/home")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Continue with Facebook
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
