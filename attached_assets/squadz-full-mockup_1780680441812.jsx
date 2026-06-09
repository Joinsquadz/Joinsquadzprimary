import { useState, useEffect, useRef } from "react";

/* ─── DESIGN TOKENS ─────────────────────────────────────────────────────────── */
const T = {
  bg: "#0A0A0F",
  surface: "#12121A",
  surfaceUp: "#1A1A26",
  surfaceHigh: "#22222F",
  border: "#2A2A3A",
  borderLight: "#333348",
  accent: "#FF5C3A",
  accentDim: "#FF5C3A30",
  accentGlow: "#FF5C3A18",
  gold: "#FFB547",
  goldDim: "#FFB54720",
  green: "#2ECC8A",
  greenDim: "#2ECC8A20",
  blue: "#4A9EFF",
  blueDim: "#4A9EFF20",
  purple: "#A855F7",
  purpleDim: "#A855F720",
  pink: "#FF6BB5",
  pinkDim: "#FF6BB520",
  text: "#F0EFF8",
  textSub: "#9898B0",
  textDim: "#55556A",
  white: "#FFFFFF",
};

const avatarPalette = [T.accent, T.gold, T.green, T.blue, T.purple, T.pink, "#FF8C42", "#42D4FF"];
const getAvatarColor = (str) => avatarPalette[(str || "?").charCodeAt(0) % avatarPalette.length];

/* ─── SHARED COMPONENTS ─────────────────────────────────────────────────────── */
const font = `'DM Sans', system-ui, sans-serif`;
const fontMono = `'DM Mono', monospace`;

function PhoneShell({ children, screen }) {
  return (
    <div style={{
      width: 390, minHeight: 844, background: T.bg,
      borderRadius: 52, overflow: "hidden", position: "relative",
      display: "flex", flexDirection: "column",
      boxShadow: `0 0 0 1px ${T.border}, 0 40px 120px rgba(0,0,0,0.9), 0 0 80px ${T.accent}18`,
      fontFamily: font,
    }}>
      {/* Status bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 28px 0", flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: font }}>9:41</span>
        <div style={{ width: 120, height: 34, background: "#000", borderRadius: 20 }} />
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <svg width="16" height="11" viewBox="0 0 16 11"><rect x="0" y="4" width="3" height="7" rx="1" fill={T.text} /><rect x="4.5" y="2.5" width="3" height="8.5" rx="1" fill={T.text} /><rect x="9" y="0" width="3" height="11" rx="1" fill={T.text} /><rect x="13.5" y="0" width="2.5" height="11" rx="1" fill={T.text} opacity=".3" /></svg>
          <svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.5C10.8 2.5 12.9 3.5 14.3 5.1L15.7 3.7C13.9 1.8 11.3 0.7 8.5 0.7C5.7 0.7 3.1 1.8 1.3 3.7L2.7 5.1C4.1 3.5 6.2 2.5 8.5 2.5Z" fill={T.text} /><path d="M8.5 5.5C10.1 5.5 11.5 6.2 12.5 7.3L13.9 5.9C12.5 4.5 10.6 3.7 8.5 3.7C6.4 3.7 4.5 4.5 3.1 5.9L4.5 7.3C5.5 6.2 6.9 5.5 8.5 5.5Z" fill={T.text} /><circle cx="8.5" cy="10" r="1.8" fill={T.text} /></svg>
          <svg width="25" height="12" viewBox="0 0 25 12"><rect x="0" y="1" width="22" height="10" rx="3" stroke={T.text} strokeWidth="1.2" fill="none" /><rect x="1.5" y="2.5" width="16" height="7" rx="1.5" fill={T.text} /><path d="M23 4.2v3.6c.9-.4 1.5-1.1 1.5-1.8s-.6-1.4-1.5-1.8z" fill={T.text} opacity=".4" /></svg>
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function Btn({ children, variant = "primary", onPress, style = {}, small = false }) {
  const [pressed, setPressed] = useState(false);
  const styles = {
    primary: { background: T.accent, color: "#fff", border: "none" },
    secondary: { background: T.surfaceUp, color: T.text, border: `1px solid ${T.border}` },
    ghost: { background: "transparent", color: T.accent, border: `1px solid ${T.accent}` },
    google: { background: T.surfaceUp, color: T.text, border: `1px solid ${T.border}` },
    apple: { background: T.text, color: T.bg, border: "none" },
    danger: { background: "#FF4444", color: "#fff", border: "none" },
    gold: { background: T.gold, color: "#000", border: "none" },
  };
  return (
    <button onClick={onPress} onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)}
      style={{
        ...styles[variant], borderRadius: 14, fontFamily: font, fontWeight: 700,
        fontSize: small ? 13 : 15, padding: small ? "8px 16px" : "14px 20px",
        cursor: "pointer", width: "100%", textAlign: "center", transition: "all 0.15s",
        transform: pressed ? "scale(0.97)" : "scale(1)", outline: "none",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, ...style,
      }}>{children}</button>
  );
}

function Input({ placeholder, type = "text", icon, value, onChange }) {
  return (
    <div style={{ position: "relative" }}>
      {icon && <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>{icon}</span>}
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange?.(e.target.value)}
        style={{
          width: "100%", background: T.surfaceUp, border: `1px solid ${T.border}`,
          borderRadius: 12, padding: `13px ${icon ? "14px 13px 40px" : "14px"}`,
          color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box",
          paddingLeft: icon ? 42 : 14,
        }} />
    </div>
  );
}

function Avatar({ name = "?", size = 36, color }) {
  const bg = color || getAvatarColor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2, background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, color: "#000", flexShrink: 0, fontFamily: font,
    }}>{name[0]?.toUpperCase()}</div>
  );
}

function Tag({ children, color = T.accent }) {
  return (
    <span style={{
      background: color + "22", color, fontSize: 11, fontWeight: 700, padding: "3px 9px",
      borderRadius: 20, fontFamily: fontMono, letterSpacing: "0.04em", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function BottomTab({ tabs, active, setActive }) {
  return (
    <div style={{
      display: "flex", background: T.surface, borderTop: `1px solid ${T.border}`,
      padding: "8px 0 28px", flexShrink: 0,
    }}>
      {tabs.map(tab => (
        <button key={tab.key} onClick={() => setActive(tab.key)} style={{
          flex: 1, background: "none", border: "none", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          color: active === tab.key ? T.accent : T.textDim, transition: "color 0.15s",
        }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</div>
          <div style={{ fontSize: 10, fontFamily: font, fontWeight: 600, letterSpacing: "0.03em" }}>{tab.label}</div>
        </button>
      ))}
    </div>
  );
}

function ScrollArea({ children, style = {} }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Card({ children, style = {}, onPress }) {
  return (
    <div onClick={onPress} style={{
      background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`,
      padding: 16, cursor: onPress ? "pointer" : "default",
      transition: onPress ? "all 0.15s" : "none", ...style,
    }}>{children}</div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: T.border, margin: "4px 0" }} />;
}

function Switch({ on, toggle }) {
  return (
    <div onClick={toggle} style={{
      width: 44, height: 26, borderRadius: 13, background: on ? T.green : T.surfaceHigh,
      position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10, background: "#fff",
        position: "absolute", top: 3, left: on ? 21 : 3, transition: "left 0.2s",
      }} />
    </div>
  );
}

/* ─── DATA ──────────────────────────────────────────────────────────────────── */
const SQUADS = [
  { id: 1, name: "The Usual Suspects", emoji: "🔥", members: 7, color: T.accent, lastEvent: "Rooftop BBQ", streak: 12 },
  { id: 2, name: "Work Crew", emoji: "💼", members: 5, color: T.blue, lastEvent: "Escape Room", streak: 4 },
  { id: 3, name: "College Fam", emoji: "🎓", members: 12, color: T.purple, lastEvent: "Lake House Wknd", streak: 8 },
  { id: 4, name: "Neighbors", emoji: "🏡", members: 6, color: T.green, lastEvent: "Block BBQ", streak: 3 },
];

const MEMBERS = [
  { name: "Marcus", role: "Host", status: "going" },
  { name: "Jordan", role: "You", status: "going" },
  { name: "Kira", role: "Member", status: "going" },
  { name: "Alex", role: "Member", status: "maybe" },
  { name: "Tasha", role: "Member", status: "going" },
  { name: "Rico", role: "Member", status: "cant" },
  { name: "Priya", role: "Member", status: "going" },
];

const EVENT = {
  title: "Rooftop BBQ 🔥",
  date: "Sat, Jun 7 · 5:00 PM",
  location: "Marcus's Place, 142 Oak St",
  squad: "The Usual Suspects",
  cover: T.accent,
  rsvp: { going: 5, maybe: 1, cant: 1 },
};

const FOOD_ITEMS = [
  { id: 1, item: "Burgers & buns", emoji: "🍔", who: "Marcus", claimed: true },
  { id: 2, item: "Veggie skewers", emoji: "🥦", who: "Kira", claimed: true },
  { id: 3, item: "Potato salad", emoji: "🥗", who: null, claimed: false },
  { id: 4, item: "Watermelon", emoji: "🍉", who: "Jordan", claimed: true },
  { id: 5, item: "Drinks & seltzers", emoji: "🥤", who: null, claimed: false },
  { id: 6, item: "Chips & dip", emoji: "🍟", who: "Alex", claimed: true },
];

const EXPENSES = [
  { id: 1, label: "Drinks (Jordan)", amt: 38, who: "Jordan" },
  { id: 2, label: "Decorations (Kira)", amt: 24, who: "Kira" },
  { id: 3, label: "Ice (TBD)", amt: 12, who: null },
];

const ACTIVITY_FEED = [
  { who: "Marcus", action: "updated location", detail: "his rooftop ✨", time: "2m ago", emoji: "📍" },
  { who: "Kira", action: "claimed", detail: "Veggie skewers 🥦", time: "14m ago", emoji: "🍽️" },
  { who: "Alex", action: "voted", detail: "5 PM start time", time: "1h ago", emoji: "🗳️" },
  { who: "Tasha", action: "RSVP'd Going", detail: "✓", time: "2h ago", emoji: "✅" },
  { who: "Rico", action: "can't make it", detail: "next time 🙏", time: "3h ago", emoji: "😔" },
  { who: "Jordan", action: "created event", detail: "Rooftop BBQ 🔥", time: "Yesterday", emoji: "🎉" },
];

const SUGGESTIONS = [
  { title: "Game Night 🎮", why: "You haven't hung out in 2 weeks!", color: T.purple, type: "Indoor" },
  { title: "Brunch Run ☀️", why: "3 of you loved the last one", color: T.gold, type: "Food" },
  { title: "Hiking Day 🥾", why: "Weather looks perfect this weekend", color: T.green, type: "Outdoor" },
  { title: "Movie Night 🎬", why: "New releases are dropping", color: T.blue, type: "Indoor" },
];

/* ─── ALL SCREENS ───────────────────────────────────────────────────────────── */

// S1: Splash
function SplashScreen({ go }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);
  return (
    <div style={{ flex: 1, background: T.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 0, position: "relative", overflow: "hidden" }}>
      {/* Animated bg blobs */}
      <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: T.accent, opacity: 0.12, filter: "blur(60px)" }} />
      <div style={{ position: "absolute", bottom: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: T.gold, opacity: 0.08, filter: "blur(50px)" }} />
      <div style={{ position: "absolute", bottom: 200, right: 20, width: 120, height: 120, borderRadius: "50%", background: T.purple, opacity: 0.08, filter: "blur(40px)" }} />

      {/* Logo */}
      <div style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(30px)", transition: "all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)", textAlign: "center", marginBottom: 16 }}>
        <div style={{ width: 90, height: 90, borderRadius: 28, background: `linear-gradient(135deg, ${T.accent}, #FF8C3A)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", boxShadow: `0 20px 60px ${T.accent}40` }}>
          <span style={{ fontSize: 44 }}>⚡</span>
        </div>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 46, fontWeight: 700, color: T.white, letterSpacing: "-0.04em", lineHeight: 1 }}>squadz</div>
        <div style={{ fontFamily: font, fontSize: 16, color: T.textSub, marginTop: 8, letterSpacing: "0.02em" }}>Stop texting. Start planning.</div>
      </div>

      {/* Feature pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", margin: "28px 0 48px", opacity: visible ? 1 : 0, transition: "opacity 0.7s 0.3s" }}>
        {["🗓️ Events", "🍔 Food Plans", "💸 Split Costs", "🗳️ Polls", "📅 Schedules"].map(pill => (
          <div key={pill} style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 20, padding: "6px 14px", fontSize: 13, color: T.textSub, fontFamily: font }}>
            {pill}
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, opacity: visible ? 1 : 0, transition: "opacity 0.7s 0.5s" }}>
        <Btn onPress={() => go("signup-options")}>Get Started — It's Free</Btn>
        <Btn variant="secondary" onPress={() => go("login")}>I Already Have an Account</Btn>
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: T.textDim, textAlign: "center", fontFamily: font, opacity: visible ? 1 : 0, transition: "opacity 0.7s 0.7s" }}>
        50,000+ squads planning smarter 🎉
      </div>
    </div>
  );
}

// S2: Signup Options
function SignupOptionsScreen({ go }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px" }}>
      <button onClick={() => go("splash")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", marginBottom: 16, padding: 0 }}>←</button>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 30, fontWeight: 700, color: T.white, marginBottom: 6 }}>Join Squadz</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 36, fontFamily: font }}>Create your account to start planning</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Btn variant="apple" onPress={() => go("onboarding-name")}>
          <svg width="18" height="22" viewBox="0 0 18 22" fill="currentColor"><path d="M14.5 0c.1 1.5-.4 3-1.4 4.1-1 1.1-2.3 1.8-3.7 1.7-.1-1.4.5-2.9 1.4-4C11.8.7 13.2 0 14.5 0zm4.4 16.1c-.7 1.5-1 2.2-1.8 3.5-.9 1.5-2.3 3.4-4 3.4-1.5 0-1.8-.9-3.8-.9-2 0-2.3.9-3.8.9-1.7 0-3-1.7-4-3.2-2.8-4.2-3-9.2-1.3-12.2 1.2-2.1 3.2-3.3 5.1-3.3 1.9 0 3.1 1 4.6 1 1.5 0 2.4-1 4.6-1 1.7 0 3.5.9 4.7 2.6-4.1 2.2-3.4 8-.1 10.2z" /></svg>
          Continue with Apple
        </Btn>
        <Btn variant="google" onPress={() => go("onboarding-name")}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" /><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" /><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" /><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" /></svg>
          Continue with Google
        </Btn>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
          <div style={{ flex: 1, height: 1, background: T.border }} />
          <span style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>or</span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>
        <Btn variant="secondary" onPress={() => go("signup-email")}>Continue with Email</Btn>
        <Btn variant="secondary" onPress={() => go("signup-phone")}>Continue with Phone</Btn>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 32, fontSize: 12, color: T.textDim, textAlign: "center", fontFamily: font, lineHeight: 1.7 }}>
        By continuing you agree to our <span style={{ color: T.accent }}>Terms of Service</span> and <span style={{ color: T.accent }}>Privacy Policy</span>
      </div>
    </div>
  );
}

// S3: Email Signup
function SignupEmailScreen({ go }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px" }}>
      <button onClick={() => go("signup-options")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Create Account</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Enter your email and a password</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
        <Input placeholder="Email address" type="email" icon="✉️" value={email} onChange={setEmail} />
        <Input placeholder="Create password (8+ chars)" type="password" icon="🔒" value={pass} onChange={setPass} />
      </div>
      <Btn onPress={() => go("onboarding-name")}>Create My Account →</Btn>
      <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
        Already have an account? <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => go("login")}>Sign in</span>
      </div>
    </div>
  );
}

// S4: Phone Signup
function SignupPhoneScreen({ go }) {
  const [phone, setPhone] = useState("");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px" }}>
      <button onClick={() => go("signup-options")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Your Number</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>We'll send a 6-digit code to verify</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 12, padding: "13px 14px", color: T.text, fontFamily: font, fontSize: 15, width: 70, textAlign: "center" }}>🇺🇸 +1</div>
        <div style={{ flex: 1 }}><Input placeholder="(555) 000-0000" type="tel" value={phone} onChange={setPhone} /></div>
      </div>
      <Btn onPress={() => go("verify-otp")}>Send Code</Btn>
    </div>
  );
}

// S5: OTP Verify
function VerifyOTPScreen({ go }) {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const inputs = useRef([]);
  const handleKey = (i, val) => {
    const newCode = [...code];
    newCode[i] = val.slice(-1);
    setCode(newCode);
    if (val && i < 5) inputs.current[i + 1]?.focus();
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px" }}>
      <button onClick={() => go("signup-phone")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Enter Code</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 36, fontFamily: font }}>Sent to (555) 000-0000 · <span style={{ color: T.accent }}>Change</span></div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 32 }}>
        {code.map((c, i) => (
          <input key={i} ref={el => inputs.current[i] = el} value={c} onChange={e => handleKey(i, e.target.value)}
            maxLength={1} style={{
              width: 46, height: 56, borderRadius: 12, background: T.surfaceUp,
              border: `2px solid ${c ? T.accent : T.border}`, color: T.white, fontFamily: fontMono,
              fontSize: 22, fontWeight: 700, textAlign: "center", outline: "none",
            }} />
        ))}
      </div>
      <Btn onPress={() => go("onboarding-name")}>Verify →</Btn>
      <div style={{ marginTop: 16, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
        Didn't get a code? <span style={{ color: T.accent, cursor: "pointer" }}>Resend (30s)</span>
      </div>
    </div>
  );
}

// S6: Login
function LoginScreen({ go }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px" }}>
      <button onClick={() => go("splash")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Welcome Back</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Sign in to your account</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Btn variant="apple" onPress={() => go("home")}><svg width="18" height="22" viewBox="0 0 18 22" fill="currentColor"><path d="M14.5 0c.1 1.5-.4 3-1.4 4.1-1 1.1-2.3 1.8-3.7 1.7-.1-1.4.5-2.9 1.4-4C11.8.7 13.2 0 14.5 0zm4.4 16.1c-.7 1.5-1 2.2-1.8 3.5-.9 1.5-2.3 3.4-4 3.4-1.5 0-1.8-.9-3.8-.9-2 0-2.3.9-3.8.9-1.7 0-3-1.7-4-3.2-2.8-4.2-3-9.2-1.3-12.2 1.2-2.1 3.2-3.3 5.1-3.3 1.9 0 3.1 1 4.6 1 1.5 0 2.4-1 4.6-1 1.7 0 3.5.9 4.7 2.6-4.1 2.2-3.4 8-.1 10.2z" /></svg> Continue with Apple</Btn>
        <Btn variant="google" onPress={() => go("home")}><svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" /><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" /><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" /><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" /></svg> Continue with Google</Btn>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1, height: 1, background: T.border }} /><span style={{ fontSize: 12, color: T.textDim }}>or</span><div style={{ flex: 1, height: 1, background: T.border }} /></div>
        <Input placeholder="Email" type="email" icon="✉️" />
        <Input placeholder="Password" type="password" icon="🔒" />
        <div style={{ textAlign: "right" }}><span style={{ fontSize: 13, color: T.accent, cursor: "pointer", fontFamily: font }}>Forgot password?</span></div>
        <Btn onPress={() => go("home")}>Sign In</Btn>
      </div>
      <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font }}>
        New here? <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => go("signup-options")}>Create account</span>
      </div>
    </div>
  );
}

// S7: Onboarding Name
function OnboardingNameScreen({ go }) {
  const [name, setName] = useState("");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
        {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i === 1 ? T.accent : T.surfaceHigh }} />)}
      </div>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>What's your name?</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 32, fontFamily: font }}>How your squad will see you</div>
      <Input placeholder="First name" icon="👤" value={name} onChange={setName} />
      <div style={{ marginTop: 12 }}><Input placeholder="Last name (optional)" /></div>
      <div style={{ marginTop: "auto", paddingTop: 32 }}>
        <Btn onPress={() => go("onboarding-avatar")} style={{ opacity: name ? 1 : 0.5 }}>Next →</Btn>
      </div>
    </div>
  );
}

// S8: Onboarding Avatar
function OnboardingAvatarScreen({ go }) {
  const [selected, setSelected] = useState(null);
  const avatars = ["🐶", "🦊", "🐻", "🐼", "🦁", "🐯", "🦝", "🐸", "🐙", "🦋", "🌈", "⚡"];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
        {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= 2 ? T.accent : T.surfaceHigh }} />)}
      </div>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Pick your vibe</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Choose an avatar or upload a photo</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {avatars.map(a => (
          <div key={a} onClick={() => setSelected(a)} style={{
            height: 70, borderRadius: 18, background: selected === a ? T.accentDim : T.surfaceUp,
            border: `2px solid ${selected === a ? T.accent : T.border}`, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 30, cursor: "pointer", transition: "all 0.15s",
          }}>{a}</div>
        ))}
      </div>
      <Btn variant="secondary" small>📷 Upload a Photo Instead</Btn>
      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <Btn onPress={() => go("onboarding-interests")}>Next →</Btn>
      </div>
    </div>
  );
}

// S9: Onboarding Interests
function OnboardingInterestsScreen({ go }) {
  const [sel, setSel] = useState(new Set());
  const interests = ["🍕 Food & Dining", "🏖️ Outdoors", "🎮 Gaming", "🎬 Movies", "🎵 Music", "🏋️ Fitness", "🎨 Arts", "✈️ Travel", "🍺 Bars", "🎤 Live Events", "🧩 Board Games", "🍳 Cooking"];
  const toggle = (i) => { const s = new Set(sel); s.has(i) ? s.delete(i) : s.add(i); setSel(s); };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
        {[1,2,3].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: T.accent }} />)}
      </div>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>What do you love?</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 24, fontFamily: font }}>Helps us suggest the perfect events (pick 3+)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
        {interests.map(i => (
          <div key={i} onClick={() => toggle(i)} style={{
            padding: "9px 16px", borderRadius: 20, border: `1.5px solid ${sel.has(i) ? T.accent : T.border}`,
            background: sel.has(i) ? T.accentDim : T.surfaceUp, fontSize: 13, color: sel.has(i) ? T.accent : T.textSub,
            fontFamily: font, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
          }}>{i}</div>
        ))}
      </div>
      <div style={{ paddingTop: 24 }}>
        <Btn onPress={() => go("create-first-squad")} style={{ opacity: sel.size >= 3 ? 1 : 0.5 }}>Let's Go! 🎉</Btn>
        <div style={{ textAlign: "center", marginTop: 12 }}><span onClick={() => go("create-first-squad")} style={{ fontSize: 13, color: T.textDim, cursor: "pointer", fontFamily: font }}>Skip for now</span></div>
      </div>
    </div>
  );
}

// S10: Create First Squad
function CreateFirstSquadScreen({ go }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔥");
  const emojis = ["🔥", "💼", "🎓", "🏡", "✈️", "🎮", "🍕", "🎉", "💪", "🌊", "🎵", "🦄"];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px" }}>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4 }}>Create Your First Squad</div>
      <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Name your crew and pick an emoji</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 20 }}>
        {emojis.map(e => (
          <div key={e} onClick={() => setEmoji(e)} style={{
            height: 50, borderRadius: 14, background: emoji === e ? T.accentDim : T.surfaceUp,
            border: `2px solid ${emoji === e ? T.accent : T.border}`, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer",
          }}>{e}</div>
        ))}
      </div>

      <Input placeholder="Squad name (e.g. The Usual Suspects)" icon={emoji} value={name} onChange={setName} />

      <div style={{ marginTop: 20 }}>
        <SectionLabel>Use case</SectionLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["Friend Group", "Coworkers", "Family", "Sports Team", "Roommates", "College Friends"].map(u => (
            <div key={u} style={{ padding: "7px 14px", borderRadius: 20, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, fontFamily: font, cursor: "pointer" }}>{u}</div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <Btn onPress={() => go("invite-members")}>Create Squad & Invite Friends →</Btn>
        <Btn variant="ghost" onPress={() => go("home")}>I'll invite later</Btn>
      </div>
    </div>
  );
}

// S11: Invite Members
function InviteMembersScreen({ go }) {
  const [search, setSearch] = useState("");
  const contacts = ["Alex Chen", "Tasha Williams", "Marcus Lee", "Kira Patel", "Rico Santos", "Priya Kumar", "Sam Johnson"];
  const [invited, setInvited] = useState(new Set());
  const toggle = (c) => { const s = new Set(invited); s.has(c) ? s.delete(c) : s.add(c); setInvited(s); };
  const filtered = contacts.filter(c => c.toLowerCase().includes(search.toLowerCase()));
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 0 0" }}>
      <div style={{ padding: "0 24px 20px" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Invite Your Squad</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 20, fontFamily: font }}>Add friends to "The Usual Suspects"</div>

        {/* Share link */}
        <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>🔗</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>Squad invite link</div>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: fontMono }}>joinsquadz.com/join/abc123</div>
          </div>
          <div style={{ background: T.accentDim, borderRadius: 8, padding: "5px 10px", fontSize: 12, color: T.accent, fontWeight: 700, fontFamily: font, cursor: "pointer" }}>Copy</div>
        </div>

        {/* Share buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[["💬 iMessage", T.green], ["📱 SMS", T.blue], ["📸 Instagram", T.pink], ["📨 Email", T.gold]].map(([l, c]) => (
            <div key={l} style={{ flex: 1, background: c + "18", border: `1px solid ${c}40`, borderRadius: 10, padding: "8px 4px", textAlign: "center", fontSize: 11, color: c, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{l}</div>
          ))}
        </div>

        <Input placeholder="Search contacts…" icon="🔍" value={search} onChange={setSearch} />
      </div>

      <ScrollArea>
        <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map(c => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
              <Avatar name={c} size={40} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: font, fontWeight: 600, color: T.text, fontSize: 15 }}>{c}</div>
                <div style={{ fontSize: 12, color: T.textDim }}>On Squadz</div>
              </div>
              <div onClick={() => toggle(c)} style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font,
                background: invited.has(c) ? T.accentDim : T.surfaceHigh,
                border: `1px solid ${invited.has(c) ? T.accent : T.border}`,
                color: invited.has(c) ? T.accent : T.textSub,
              }}>{invited.has(c) ? "✓ Added" : "+ Add"}</div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div style={{ padding: "16px 24px 32px", flexShrink: 0 }}>
        <Btn onPress={() => go("home")}>Done ({invited.size} invited) →</Btn>
      </div>
    </div>
  );
}

// S12: Home
function HomeScreen({ go }) {
  const [tab, setTab] = useState("home");
  const mainTabs = [
    { key: "home", icon: "⊞", label: "Home" },
    { key: "squads", icon: "👥", label: "Squads" },
    { key: "messages", icon: "💬", label: "Messages" },
    { key: "discover", icon: "✦", label: "Discover" },
    { key: "activity", icon: "◎", label: "Activity" },
    { key: "profile", icon: "◉", label: "You" },
  ];
  const tabContent = {
    home: <HomeTab go={go} />,
    squads: <SquadsTab go={go} />,
    messages: <MessagesInboxScreen go={go} />,
    discover: <DiscoverTab go={go} />,
    activity: <ActivityTab go={go} />,
    profile: <ProfileTab go={go} />,
  };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tabContent[tab]}
      </div>
      <BottomTab tabs={mainTabs} active={tab} setActive={setTab} />
    </div>
  );
}

function HomeTab({ go }) {
  return (
    <ScrollArea>
      <div style={{ padding: "20px 20px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white }}>Hey, Jordan 👋</div>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>4 squads · 1 event this week</div>
          </div>
          <div style={{ position: "relative" }}>
            <Avatar name="Jordan" size={44} color={T.accent} />
            <div style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, background: T.green, borderRadius: "50%", border: `2px solid ${T.bg}` }} />
          </div>
        </div>

        {/* Next event hero */}
        <div onClick={() => go("event-detail")} style={{ background: `linear-gradient(135deg, ${T.accent}, #FF8C3A)`, borderRadius: 22, padding: 20, marginBottom: 20, cursor: "pointer", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -30, top: -30, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
          <div style={{ position: "absolute", right: 30, bottom: -50, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
          <Tag color="#fff">⚡ Up Next · Sat Jun 7</Tag>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: "#fff", margin: "8px 0 4px" }}>Rooftop BBQ 🔥</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14 }}>Marcus's Place · 5:00 PM</div>
          <div style={{ display: "flex", alignItems: "center", gap: -6 }}>
            {MEMBERS.slice(0, 5).map((m, i) => (
              <div key={i} style={{ width: 28, height: 28, borderRadius: 14, background: getAvatarColor(m.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#000", marginLeft: i > 0 ? -8 : 0, border: `2px solid ${T.accent}` }}>{m.name[0]}</div>
            ))}
            <div style={{ marginLeft: 4, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>+2 going</div>
          </div>
        </div>

        {/* Streak banner */}
        <div style={{ background: T.goldDim, border: `1px solid ${T.gold}40`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 28 }}>🔥</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 700, color: T.gold, fontSize: 14 }}>12-week squad streak!</div>
            <div style={{ fontSize: 12, color: T.textSub }}>The Usual Suspects has hung out every week</div>
          </div>
          <Tag color={T.gold}>🏆</Tag>
        </div>

        {/* My squads quick */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionLabel>My Squads</SectionLabel>
          <span style={{ fontSize: 12, color: T.accent, fontFamily: font, cursor: "pointer" }} onClick={() => {}}>See All →</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
          {SQUADS.map(s => (
            <div key={s.id} onClick={() => go("squad-detail")} style={{
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16,
              padding: "12px 14px", minWidth: 130, cursor: "pointer", flexShrink: 0,
            }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{s.emoji}</div>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: T.textDim }}>{s.members} members</div>
            </div>
          ))}
          <div onClick={() => go("create-first-squad")} style={{ background: T.surfaceUp, border: `1.5px dashed ${T.border}`, borderRadius: 16, padding: "12px 14px", minWidth: 100, cursor: "pointer", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <div style={{ fontSize: 24, color: T.textDim }}>+</div>
            <div style={{ fontSize: 11, color: T.textDim, fontFamily: font }}>New Squad</div>
          </div>
        </div>

        {/* Suggestions */}
        <div style={{ marginBottom: 12 }}><SectionLabel>✦ AI Suggestions</SectionLabel></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SUGGESTIONS.slice(0, 2).map(s => (
            <div key={s.title} onClick={() => go("create-event")} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{s.title.split(" ").pop()}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{s.title}</div>
                <div style={{ fontSize: 12, color: T.textSub }}>{s.why}</div>
              </div>
              <Tag color={s.color}>{s.type}</Tag>
            </div>
          ))}
        </div>

        {/* FAB */}
        <div onClick={() => go("create-event")} style={{
          position: "fixed", bottom: 100, right: 24, width: 56, height: 56,
          background: T.accent, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26, cursor: "pointer", boxShadow: `0 8px 30px ${T.accent}60`, zIndex: 100,
        }}>+</div>
      </div>
    </ScrollArea>
  );
}

function SquadsTab({ go }) {
  return (
    <ScrollArea>
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Your Squads</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>4 active groups</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {SQUADS.map(s => (
            <div key={s.id} onClick={() => go("squad-detail")} style={{ background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`, padding: "16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 18, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, border: `1px solid ${s.color}40` }}>{s.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{s.name}</div>
                <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{s.members} members · {s.lastEvent}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <Tag color={s.color}>🔥 {s.streak}wk streak</Tag>
                </div>
              </div>
              <span style={{ color: T.textDim, fontSize: 20 }}>›</span>
            </div>
          ))}
          <Btn variant="ghost" onPress={() => go("create-first-squad")}>+ Create New Squad</Btn>
          <Btn variant="secondary" onPress={() => go("join-invite")}>Join with Invite Link</Btn>
        </div>
      </div>
    </ScrollArea>
  );
}

function DiscoverTab({ go }) {
  const ideas = [
    { emoji: "🎮", title: "Game Night", desc: "Board games, video games, trivia", color: T.purple },
    { emoji: "🍕", title: "Food Adventure", desc: "Try a new restaurant together", color: T.accent },
    { emoji: "🏖️", title: "Day Trip", desc: "Get out of the city for a day", color: T.gold },
    { emoji: "🎬", title: "Movie Night", desc: "Stream, drive-in, or theater", color: T.blue },
    { emoji: "🏋️", title: "Fitness Challenge", desc: "Hike, yoga, or gym together", color: T.green },
    { emoji: "🍳", title: "Cook Together", desc: "Potluck, cooking class, or meal prep", color: T.pink },
    { emoji: "🎨", title: "Creative Night", desc: "Pottery, painting, craft night", color: "#FF8C42" },
    { emoji: "✈️", title: "Weekend Trip", desc: "Short getaway with the squad", color: "#42D4FF" },
  ];
  return (
    <ScrollArea>
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Discover Ideas</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>Pick a vibe and we'll help you plan it</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {ideas.map(i => (
            <div key={i.title} onClick={() => go("create-event")} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: i.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{i.emoji}</div>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>{i.title}</div>
              <div style={{ fontSize: 12, color: T.textSub }}>{i.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function ActivityTab({ go }) {
  return (
    <ScrollArea>
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Activity</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>What's happening across your squads</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {ACTIVITY_FEED.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 16, position: "relative" }}>
              {i < ACTIVITY_FEED.length - 1 && <div style={{ position: "absolute", left: 19, top: 40, bottom: 0, width: 1, background: T.border }} />}
              <Avatar name={item.who} size={40} />
              <div style={{ flex: 1, paddingTop: 4 }}>
                <div style={{ fontFamily: font, fontSize: 14, color: T.text, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700 }}>{item.who}</span>
                  <span style={{ color: T.textSub }}> {item.action} </span>
                  <span style={{ fontWeight: 600, color: T.blue }}>{item.detail}</span>
                </div>
                <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{item.time}</div>
              </div>
              <div style={{ fontSize: 18 }}>{item.emoji}</div>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function ProfileTab({ go }) {
  const [notifs, setNotifs] = useState(true);
  const [calSync, setCalSync] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const stats = [{ n: "24", l: "Events" }, { n: "4", l: "Squads" }, { n: "🔥12", l: "Streak" }];
  return (
    <ScrollArea>
      <div style={{ padding: "20px 20px 24px" }}>
        {/* Avatar + stats */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 800, color: "#000" }}>J</div>
            <div onClick={() => go("edit-profile")} style={{ position: "absolute", bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, background: T.surfaceHigh, border: `2px solid ${T.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13 }}>✏️</div>
          </div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.white }}>Jordan Kim</div>
          <div style={{ fontSize: 13, color: T.textSub, marginTop: 2 }}>@jordank · Since Jan 2025</div>
          <div style={{ display: "flex", gap: 28, marginTop: 16 }}>
            {stats.map(s => (
              <div key={s.l} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 20, color: T.white }}>{s.n}</div>
                <div style={{ fontSize: 11, color: T.textDim, fontFamily: font }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Settings groups */}
        {[
          {
            label: "Account", items: [
              { icon: "✏️", label: "Edit Profile", onPress: () => go("edit-profile") },
              { icon: "🔒", label: "Change Password", onPress: () => {} },
              { icon: "📧", label: "Email: jordan@email.com", onPress: () => {} },
            ]
          },
          {
            label: "Preferences", items: [
              { icon: "🔔", label: "Push Notifications", toggle: notifs, onToggle: () => setNotifs(!notifs) },
              { icon: "📅", label: "Calendar Sync (Google)", toggle: calSync, onToggle: () => setCalSync(!calSync) },
              { icon: "🌙", label: "Dark Mode", toggle: darkMode, onToggle: () => setDarkMode(!darkMode) },
            ]
          },
          {
            label: "Payments", items: [
              { icon: "💳", label: "Payment Method: Venmo", onPress: () => {} },
              { icon: "📊", label: "Expense History", onPress: () => {} },
            ]
          },
          {
            label: "Squad", items: [
              { icon: "🔗", label: "My Invite Link", onPress: () => {} },
              { icon: "👥", label: "Find Friends", onPress: () => go("invite-members") },
              { icon: "⭐", label: "Upgrade to Pro", onPress: () => go("paywall"), accent: true },
              { icon: "💰", label: "Compare Plans & Pricing", onPress: () => go("pricing") },
            ]
          },
          {
            label: "More", items: [
              { icon: "❓", label: "Help & Support", onPress: () => {} },
              { icon: "⭐", label: "Rate Squadz", onPress: () => {} },
              { icon: "📄", label: "Privacy Policy", onPress: () => {} },
              { icon: "🚪", label: "Sign Out", onPress: () => go("splash"), danger: true },
            ]
          },
        ].map(group => (
          <div key={group.label} style={{ marginBottom: 20 }}>
            <SectionLabel>{group.label}</SectionLabel>
            <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
              {group.items.map((item, ii) => (
                <div key={item.label}>
                  {ii > 0 && <Divider />}
                  <div onClick={item.onPress} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: item.onPress ? "pointer" : "default" }}>
                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                    <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: item.danger ? "#FF4444" : item.accent ? T.accent : T.text }}>{item.label}</div>
                    {item.toggle !== undefined ? <Switch on={item.toggle} toggle={item.onToggle} /> : item.onPress ? <span style={{ color: T.textDim, fontSize: 18 }}>›</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// S13: Squad Detail
function SquadDetailScreen({ go }) {
  const [tab, setTab] = useState("events");
  const squad = SQUADS[0];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 0", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: squad.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{squad.emoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 800, fontSize: 17, color: T.white }}>{squad.name}</div>
            <div style={{ fontSize: 12, color: T.textSub }}>{squad.members} members · {squad.streak}wk streak 🔥</div>
          </div>
          <button onClick={() => go("squad-settings")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer" }}>⚙️</button>
        </div>

        {/* Members row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, overflowX: "auto" }}>
          {MEMBERS.map(m => (
            <div key={m.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <Avatar name={m.name} size={38} />
              <div style={{ fontSize: 10, color: T.textDim, fontFamily: font }}>{m.name}</div>
            </div>
          ))}
          <div onClick={() => go("invite-members")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 19, background: T.surfaceHigh, border: `1.5px dashed ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: T.textDim }}>+</div>
            <div style={{ fontSize: 10, color: T.textDim }}>Invite</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {["events", "memories", "polls"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, background: "none", border: "none", padding: "8px 0", cursor: "pointer",
              fontFamily: font, fontWeight: 700, fontSize: 13, textTransform: "capitalize",
              color: tab === t ? T.accent : T.textDim,
              borderBottom: `2px solid ${tab === t ? T.accent : "transparent"}`,
            }}>{t}</button>
          ))}
        </div>
      </div>

      <ScrollArea>
        <div style={{ padding: "16px 20px" }}>
          {tab === "events" && (
            <>
              <Btn onPress={() => go("create-event")}>+ Plan Something</Btn>
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {["Rooftop BBQ 🔥", "Bowling Night 🎳", "Game Night 🎮"].map((e, i) => (
                  <Card key={e} onPress={() => go("event-detail")} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: [T.accent, T.blue, T.purple][i] + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{e.split(" ").pop()}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>{e}</div>
                      <div style={{ fontSize: 12, color: T.textDim }}>{["Sat Jun 7 · 5PM", "Fri Jun 13 · 7PM", "Sat Jun 21 · 6PM"][i]}</div>
                    </div>
                    <span style={{ color: T.textDim, fontSize: 18 }}>›</span>
                  </Card>
                ))}
              </div>
            </>
          )}
          {tab === "memories" && (
            <div style={{ textAlign: "center", padding: "40px 0", color: T.textDim, fontFamily: font }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📸</div>
              <div>Photos from past events will appear here</div>
            </div>
          )}
          {tab === "polls" && (
            <div style={{ textAlign: "center", padding: "40px 0", color: T.textDim, fontFamily: font }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🗳️</div>
              <div>No active polls right now</div>
              <div style={{ marginTop: 16 }}><Btn small onPress={() => {}}>Create a Poll</Btn></div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// S14: Create Event
function CreateEventScreen({ go }) {
  const [step, setStep] = useState(0);
  const [eventData, setEventData] = useState({ name: "", type: "", date: "", time: "", location: "", sections: new Set() });
  const steps = ["Basics", "Date & Time", "Location", "Who's Invited", "Sections", "Review"];

  const eventTypes = [
    { e: "🔥", n: "BBQ / Cookout" }, { e: "🎮", n: "Game Night" },
    { e: "🍕", n: "Dinner / Food" }, { e: "✈️", n: "Trip / Travel" },
    { e: "🎉", n: "Party / Celebrate" }, { e: "🏋️", n: "Fitness" },
    { e: "🎬", n: "Movie Night" }, { e: "🎨", n: "Creative" },
    { e: "🏖️", n: "Outdoor / Hike" }, { e: "🍺", n: "Happy Hour" },
    { e: "🎤", n: "Live Event" }, { e: "🧩", n: "Custom" },
  ];
  const sectionOpts = [
    { id: "food", icon: "🍔", label: "Food Planner", desc: "Who brings what" },
    { id: "budget", icon: "💸", label: "Budget Tracker", desc: "Split costs easily" },
    { id: "poll", icon: "🗳️", label: "Group Polls", desc: "Vote on anything" },
    { id: "schedule", icon: "📅", label: "Schedule Finder", desc: "Find the best time" },
    { id: "tasks", icon: "✅", label: "Checklist", desc: "Track to-dos" },
    { id: "playlist", icon: "🎵", label: "Playlist", desc: "Collaborative music" },
  ];
  const toggleSection = (id) => {
    const s = new Set(eventData.sections);
    s.has(id) ? s.delete(id) : s.add(id);
    setEventData({ ...eventData, sections: s });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button onClick={() => step > 0 ? setStep(step - 1) : go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ flex: 1, fontFamily: font, fontWeight: 700, fontSize: 16, color: T.text }}>{steps[step]}</div>
          <div style={{ fontSize: 13, color: T.textDim }}>{step + 1}/{steps.length}</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {steps.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? T.accent : T.surfaceHigh, transition: "background 0.3s" }} />)}
        </div>
      </div>

      <ScrollArea>
        <div style={{ padding: "24px 20px" }}>
          {step === 0 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>What are you planning?</div>
              <Input placeholder="Event name (e.g. Rooftop BBQ)" icon="✍️" value={eventData.name} onChange={v => setEventData({ ...eventData, name: v })} />
              <div style={{ marginTop: 20, marginBottom: 12 }}><SectionLabel>Event Type</SectionLabel></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {eventTypes.map(t => (
                  <div key={t.n} onClick={() => setEventData({ ...eventData, type: t.n })} style={{
                    background: eventData.type === t.n ? T.accentDim : T.surfaceUp, border: `1.5px solid ${eventData.type === t.n ? T.accent : T.border}`,
                    borderRadius: 12, padding: "10px 6px", textAlign: "center", cursor: "pointer",
                  }}>
                    <div style={{ fontSize: 22 }}>{t.e}</div>
                    <div style={{ fontSize: 10, color: T.textSub, marginTop: 4, fontFamily: font }}>{t.n}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>When is it?</div>
              <div style={{ marginBottom: 16 }}><Input placeholder="Select date" icon="📅" /></div>
              <div style={{ marginBottom: 20 }}><Input placeholder="Start time" icon="🕐" /></div>
              <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
                <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 8 }}>⚡ AI Best Time Finder</div>
                <div style={{ fontSize: 12, color: T.textSub, marginBottom: 12 }}>Sync calendars to find when everyone is free</div>
                <Btn small variant="ghost" onPress={() => {}}>Sync Google Calendar</Btn>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}><Btn small variant="secondary" onPress={() => {}}>Add End Time</Btn></div>
                <div style={{ flex: 1 }}><Btn small variant="secondary" onPress={() => {}}>Recurring?</Btn></div>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>Where is it?</div>
              <div style={{ marginBottom: 12 }}><Input placeholder="Search for a place or address" icon="📍" /></div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {["📍 Use My Location", "🔗 Add a Link", "❓ TBD"].map(b => (
                  <div key={b} style={{ flex: 1, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSub, fontFamily: font, cursor: "pointer" }}>{b}</div>
                ))}
              </div>
              <div style={{ background: T.surfaceUp, borderRadius: 14, height: 160, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.border}` }}>
                <div style={{ textAlign: "center", color: T.textDim, fontSize: 14 }}>🗺️<br />Map Preview</div>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>Who's invited?</div>
              <div style={{ marginBottom: 12 }}>
                {SQUADS.map(s => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 22 }}>{s.emoji}</div>
                    <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{s.name} ({s.members})</div>
                    <Switch on={s.id === 1} toggle={() => {}} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}><Btn small variant="ghost">+ Invite Individuals</Btn></div>
            </>
          )}
          {step === 4 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 8 }}>Add Sections</div>
              <div style={{ fontSize: 14, color: T.textSub, marginBottom: 20 }}>Customize your event with tools</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sectionOpts.map(opt => (
                  <div key={opt.id} onClick={() => toggleSection(opt.id)} style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                    background: eventData.sections.has(opt.id) ? T.accentDim : T.surface,
                    border: `1.5px solid ${eventData.sections.has(opt.id) ? T.accent : T.border}`,
                    borderRadius: 14, cursor: "pointer",
                  }}>
                    <span style={{ fontSize: 24 }}>{opt.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: T.textSub }}>{opt.desc}</div>
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: 11, background: eventData.sections.has(opt.id) ? T.accent : T.surfaceHigh, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#000", fontWeight: 800 }}>
                      {eventData.sections.has(opt.id) ? "✓" : ""}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {step === 5 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 20 }}>Review & Publish</div>
              <Card style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: font, fontWeight: 800, fontSize: 18, color: T.text, marginBottom: 4 }}>{eventData.name || "Rooftop BBQ 🔥"}</div>
                {[["📅", "Sat, Jun 7 · 5:00 PM"], ["📍", "Marcus's Place, 142 Oak St"], ["👥", "The Usual Suspects (7 invited)"], ["⚡", "Food, Budget, Polls added"]].map(([icon, val]) => (
                  <div key={val} style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 13, color: T.textSub, fontFamily: font }}>
                    <span>{icon}</span><span>{val}</span>
                  </div>
                ))}
              </Card>
              <div style={{ marginBottom: 12 }}>
                <SectionLabel>Notify via</SectionLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  {["📲 Push", "💬 iMessage", "📧 Email"].map(b => (
                    <div key={b} style={{ flex: 1, background: T.accentDim, border: `1px solid ${T.accent}`, borderRadius: 10, padding: "8px 6px", textAlign: "center", fontSize: 12, color: T.accent, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{b}</div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <div style={{ padding: "12px 20px 32px", flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
        {step < steps.length - 1
          ? <Btn onPress={() => setStep(step + 1)}>Next →</Btn>
          : <Btn onPress={() => go("event-detail")} style={{ background: T.green }}>🎉 Publish Event & Notify Squad</Btn>
        }
      </div>
    </div>
  );
}

// S15: Event Detail
function EventDetailScreen({ go }) {
  const [tab, setTab] = useState("overview");
  const [myRsvp, setMyRsvp] = useState("going");
  const tabs = ["overview", "food", "budget", "polls", "chat"];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg, ${T.accent}, #C83E22)`, padding: "16px 20px 18px", flexShrink: 0, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -40, top: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button onClick={() => go("home")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>←</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => go("event-settings")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>⚙️</button>
          <button style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>↗️</button>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono }}>The Usual Suspects</div>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: "#fff", margin: "4px 0" }}>Rooftop BBQ 🔥</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14, fontFamily: font }}>Sat, Jun 7 · 5:00 PM · Marcus's Place</div>
        <div style={{ display: "flex", gap: 12 }}>
          {[{ label: "Going", val: 5, color: T.green }, { label: "Maybe", val: 1, color: T.gold }, { label: "Can't", val: 1, color: "rgba(255,255,255,0.4)" }].map(r => (
            <div key={r.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "6px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: r.color, fontFamily: fontMono }}>{r.val}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: font }}>{r.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* RSVP */}
      <div style={{ display: "flex", gap: 8, padding: "10px 16px", background: T.surfaceUp, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {[["✓ Going", "going", T.green], ["? Maybe", "maybe", T.gold], ["✕ Can't", "cant", "#FF4444"]].map(([l, v, c]) => (
          <button key={v} onClick={() => setMyRsvp(v)} style={{
            flex: 1, padding: "8px 0", borderRadius: 10, border: `1.5px solid ${myRsvp === v ? c : T.border}`,
            background: myRsvp === v ? c + "22" : "transparent", color: myRsvp === v ? c : T.textSub,
            fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, overflowX: "auto" }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", padding: "10px 14px",
            color: tab === t ? T.accent : T.textDim, fontFamily: font, fontWeight: 700, fontSize: 12,
            cursor: "pointer", textTransform: "capitalize", flexShrink: 0,
            borderBottom: `2px solid ${tab === t ? T.accent : "transparent"}`,
          }}>{t}</button>
        ))}
      </div>

      <ScrollArea>
        <div style={{ padding: "16px 18px 24px" }}>
          {tab === "overview" && <EventOverviewTab go={go} />}
          {tab === "food" && <EventFoodTab go={go} />}
          {tab === "budget" && <EventBudgetTab go={go} />}
          {tab === "polls" && <EventPollsTab go={go} />}
          {tab === "chat" && <EventChatTab go={go} />}
        </div>
      </ScrollArea>
    </div>
  );
}

function EventOverviewTab({ go }) {
  const tasks = [
    { id: 1, label: "Book the rooftop", done: true, owner: "Marcus" },
    { id: 2, label: "Buy drinks ($38)", done: true, owner: "Jordan" },
    { id: 3, label: "Get ice", done: false, owner: "Jordan" },
    { id: 4, label: "Make a playlist", done: false, owner: null },
  ];
  const [done, setDone] = useState(new Set(tasks.filter(t => t.done).map(t => t.id)));
  return (
    <div>
      <SectionLabel>Members</SectionLabel>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, overflowX: "auto" }}>
        {MEMBERS.map(m => (
          <div key={m.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <Avatar name={m.name} size={40} />
              <div style={{ position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, background: m.status === "going" ? T.green : m.status === "maybe" ? T.gold : "#FF4444", border: `2px solid ${T.bg}` }} />
            </div>
            <div style={{ fontSize: 10, color: T.textDim, fontFamily: font }}>{m.name}</div>
          </div>
        ))}
      </div>

      <SectionLabel>Checklist</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {tasks.map(t => (
          <div key={t.id} onClick={() => { const s = new Set(done); s.has(t.id) ? s.delete(t.id) : s.add(t.id); setDone(s); }} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 12, padding: "11px 14px", border: `1px solid ${T.border}`, cursor: "pointer" }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: done.has(t.id) ? T.green : "transparent", border: done.has(t.id) ? "none" : `2px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#000", fontWeight: 800, flexShrink: 0 }}>
              {done.has(t.id) ? "✓" : ""}
            </div>
            <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: done.has(t.id) ? T.textDim : T.text, textDecoration: done.has(t.id) ? "line-through" : "none" }}>{t.label}</div>
            {t.owner && <Avatar name={t.owner} size={24} />}
          </div>
        ))}
        <Btn small variant="ghost" onPress={() => {}}>+ Add Task</Btn>
      </div>

      <SectionLabel>Event Details</SectionLabel>
      <Card>
        {[["📅", "Sat, Jun 7 · 5:00 PM – 10:00 PM"], ["📍", "Marcus's Place, 142 Oak St"], ["👥", "The Usual Suspects"], ["🔗", "joinsquadz.com/event/xyz"]].map(([icon, val]) => (
          <div key={val} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.border}`, fontSize: 13, color: T.textSub, fontFamily: font }}>
            <span>{icon}</span><span style={{ flex: 1 }}>{val}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function EventFoodTab({ go }) {
  const [items, setItems] = useState(FOOD_ITEMS);
  const claim = (id) => setItems(items.map(i => i.id === id ? { ...i, who: "You", claimed: true } : i));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionLabel>Who's Bringing What</SectionLabel>
        <div style={{ fontSize: 12, color: T.textSub }}>{items.filter(i => i.claimed).length}/{items.length} claimed</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 14, padding: "12px 14px", border: `1px solid ${item.claimed ? T.border : T.gold + "50"}` }}>
            <span style={{ fontSize: 22 }}>{item.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{item.item}</div>
              <div style={{ fontSize: 12, marginTop: 2, color: item.claimed ? T.green : T.gold }}>{item.claimed ? `✓ ${item.who}` : "⚠ Unclaimed"}</div>
            </div>
            {!item.claimed && <Btn small variant="ghost" onPress={() => claim(item.id)} style={{ width: "auto", padding: "5px 12px" }}>Claim</Btn>}
          </div>
        ))}
      </div>
      <Btn variant="secondary" onPress={() => {}}>+ Add Item</Btn>
      <div style={{ marginTop: 10 }}><Btn variant="ghost" onPress={() => {}}>📤 Share Food List</Btn></div>
    </div>
  );
}

function EventBudgetTab({ go }) {
  const total = 120, spent = 74;
  const pct = (spent / total) * 100;
  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>Group Budget</div>
          <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 15, color: T.text }}>${spent} / ${total}</div>
        </div>
        <div style={{ background: T.surfaceHigh, borderRadius: 6, height: 8, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${T.green}, ${T.gold})`, borderRadius: 6, transition: "width 0.6s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textDim }}>
          <span>${total - spent} remaining</span>
          <span>~${Math.ceil(total / 7)}/person</span>
        </div>
      </Card>
      <SectionLabel>Expenses</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {EXPENSES.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 12, padding: "12px 14px", border: `1px solid ${T.border}` }}>
            {e.who ? <Avatar name={e.who} size={32} /> : <div style={{ width: 32, height: 32, borderRadius: 16, background: T.surfaceHigh, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>?</div>}
            <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{e.label}</div>
            <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 16, color: T.gold }}>${e.amt}</div>
          </div>
        ))}
      </div>
      <Btn onPress={() => {}}>+ Log Expense</Btn>
      <div style={{ marginTop: 10 }}><Btn variant="secondary" onPress={() => {}}>💸 Settle via Venmo</Btn></div>
    </div>
  );
}

function EventPollsTab({ go }) {
  const [votes, setVotes] = useState({ p1: null, p2: null });
  const polls = [
    { id: "p1", q: "What time should we start?", opts: [{ o: "4 PM", v: 2 }, { o: "5 PM", v: 4 }, { o: "6 PM", v: 1 }] },
    { id: "p2", q: "Music vibe?", opts: [{ o: "Hip-Hop 🎤", v: 3 }, { o: "House 🎧", v: 3 }, { o: "R&B 🎶", v: 1 }] },
  ];
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {polls.map(poll => {
          const total = poll.opts.reduce((a, o) => a + o.v, 0);
          const myVote = votes[poll.id];
          const maxV = Math.max(...poll.opts.map(o => o.v));
          return (
            <Card key={poll.id}>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 12 }}>{poll.q}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {poll.opts.map((opt, oi) => {
                  const pct = Math.round((opt.v / total) * 100);
                  const isVoted = myVote === oi;
                  const isWinner = opt.v === maxV;
                  return (
                    <div key={oi} onClick={() => setVotes({ ...votes, [poll.id]: oi })} style={{ cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13, fontFamily: font }}>
                        <span style={{ fontWeight: isVoted ? 700 : 500, color: isVoted ? T.accent : T.text }}>
                          {isVoted && "◆ "}{opt.o}
                          {isWinner && <span style={{ marginLeft: 6, fontSize: 10, background: T.goldDim, color: T.gold, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>LEAD</span>}
                        </span>
                        <span style={{ color: T.textDim }}>{pct}%</span>
                      </div>
                      <div style={{ background: T.surfaceHigh, borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: isVoted ? T.accent : T.textDim, borderRadius: 4, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {!myVote && myVote !== 0 && <div style={{ marginTop: 8, fontSize: 12, color: T.gold, fontFamily: font }}>Tap to vote</div>}
            </Card>
          );
        })}
        <Btn variant="secondary" onPress={() => {}}>+ Create Poll</Btn>
      </div>
    </div>
  );
}

function EventChatTab({ go }) {
  const [msg, setMsg] = useState("");
  const chats = [
    { who: "Marcus", msg: "Excited for Saturday! 🔥", time: "2h ago", me: false },
    { who: "Kira", msg: "Me too! I'll bring the veggie skewers 🥦", time: "1h ago", me: false },
    { who: "Jordan", msg: "Can't wait! Anyone need a ride?", time: "45m ago", me: true },
    { who: "Tasha", msg: "Yes please! I live on Oak St 🙏", time: "30m ago", me: false },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {chats.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: c.me ? "flex-end" : "flex-start" }}>
          {!c.me && <Avatar name={c.who} size={30} />}
          <div style={{ maxWidth: "70%" }}>
            {!c.me && <div style={{ fontSize: 11, color: T.textDim, marginBottom: 3, fontFamily: font }}>{c.who}</div>}
            <div style={{ background: c.me ? T.accent : T.surfaceUp, borderRadius: 14, padding: "9px 13px", fontSize: 14, color: c.me ? "#fff" : T.text, fontFamily: font }}>
              {c.msg}
            </div>
            <div style={{ fontSize: 10, color: T.textDim, marginTop: 2, textAlign: c.me ? "right" : "left" }}>{c.time}</div>
          </div>
          {c.me && <Avatar name="Jordan" size={30} color={T.accent} />}
        </div>
      ))}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}><Input placeholder="Say something…" value={msg} onChange={setMsg} /></div>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: T.accent, border: "none", fontSize: 18, cursor: "pointer" }}>↑</button>
      </div>
    </div>
  );
}

// S16: Guest RSVP (web)
function GuestRSVPScreen({ go }) {
  const [rsvp, setRsvp] = useState(null);
  const [name, setName] = useState("");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px" }}>
      <div style={{ background: `linear-gradient(135deg, ${T.accent}, #FF8C3A)`, borderRadius: 22, padding: 20, marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 6 }}>🔥</div>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: "#fff" }}>Rooftop BBQ</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>Sat, Jun 7 · 5:00 PM · Marcus's Place</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>Invited by Jordan Kim · The Usual Suspects</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Input placeholder="Your name" icon="👤" value={name} onChange={setName} />
      </div>
      <SectionLabel>Are you going?</SectionLabel>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[["✓ Going", "going", T.green], ["? Maybe", "maybe", T.gold], ["✕ Can't", "cant", "#FF4444"]].map(([l, v, c]) => (
          <button key={v} onClick={() => setRsvp(v)} style={{
            flex: 1, padding: "14px 0", borderRadius: 12, border: `2px solid ${rsvp === v ? c : T.border}`,
            background: rsvp === v ? c + "22" : "transparent", color: rsvp === v ? c : T.textSub,
            fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer",
          }}>{l}</button>
        ))}
      </div>
      {rsvp && (
        <>
          <Btn onPress={() => go("home")} style={{ marginBottom: 16 }}>Submit RSVP</Btn>
          <div style={{ background: T.surfaceUp, borderRadius: 14, padding: 16, textAlign: "center" }}>
            <div style={{ fontFamily: font, fontWeight: 700, color: T.accent, marginBottom: 4 }}>Want the full experience?</div>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 12 }}>Track food, budgets, and polls with Squadz</div>
            <Btn small onPress={() => go("signup-options")}>Download Squadz Free →</Btn>
          </div>
        </>
      )}
    </div>
  );
}

// S17: Join via invite link
function JoinInviteScreen({ go }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "40px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ width: 70, height: 70, borderRadius: 22, background: T.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 16px" }}>🔥</div>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white }}>You're invited!</div>
        <div style={{ fontSize: 14, color: T.textSub, marginTop: 4 }}>Jordan invited you to join</div>
        <div style={{ fontFamily: font, fontWeight: 800, fontSize: 18, color: T.accent, marginTop: 8 }}>The Usual Suspects</div>
        <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>7 members · 12-week streak 🔥</div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 32 }}>
        {MEMBERS.slice(0, 5).map(m => <Avatar key={m.name} name={m.name} size={40} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Btn onPress={() => go("signup-options")}>Join Squad — It's Free</Btn>
        <Btn variant="secondary" onPress={() => go("login")}>I Have an Account</Btn>
        <Btn variant="ghost" onPress={() => go("home")}>Continue as Guest (limited access)</Btn>
      </div>
    </div>
  );
}

// S18: Post Event Wrap Up
function PostEventScreen({ go }) {
  const [rating, setRating] = useState(0);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 24px 40px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🎉</div>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white }}>Event Wrapped!</div>
        <div style={{ fontSize: 14, color: T.textSub, marginTop: 4 }}>Rooftop BBQ · Sat Jun 7</div>
      </div>

      <Card style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontFamily: font, fontWeight: 700, color: T.text, marginBottom: 12 }}>How was it? ⭐</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          {[1,2,3,4,5].map(s => (
            <div key={s} onClick={() => setRating(s)} style={{ fontSize: 32, cursor: "pointer", opacity: s <= rating ? 1 : 0.3, transition: "opacity 0.15s" }}>⭐</div>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: font, fontWeight: 700, color: T.text, marginBottom: 8 }}>💸 Settle Up</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 12 }}>3 people owe money from shared expenses</div>
        {[{ who: "Alex", owes: 14 }, { who: "Kira", owes: 8 }].map(e => (
          <div key={e.who} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Avatar name={e.who} size={32} />
            <div style={{ flex: 1, fontFamily: font, fontSize: 13, color: T.textSub }}><span style={{ color: T.text, fontWeight: 700 }}>{e.who}</span> owes you ${e.owes}</div>
            <Btn small variant="ghost" onPress={() => {}} style={{ width: "auto", padding: "5px 10px" }}>Request</Btn>
          </div>
        ))}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: font, fontWeight: 700, color: T.text, marginBottom: 8 }}>📸 Drop Photos</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 12 }}>Share memories with the squad</div>
        <Btn small variant="secondary" onPress={() => {}}>Open Camera Roll</Btn>
      </Card>

      <Btn style={{ background: T.purple, marginBottom: 10 }} onPress={() => go("new-event-suggestion")}>✦ Plan the Next One →</Btn>
      <Btn variant="secondary" onPress={() => go("home")}>Back to Home</Btn>
    </div>
  );
}

// S19: New Event Suggestion (AI)
function NewEventSuggestionScreen({ go }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 20px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: "0 0 10px" }}>←</button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: T.purple + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>✦</div>
          <div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.white }}>What's Next?</div>
            <div style={{ fontSize: 12, color: T.textSub }}>AI-powered suggestions for your squad</div>
          </div>
        </div>
      </div>
      <ScrollArea>
        <div style={{ padding: "20px 20px 32px" }}>
          <div style={{ background: T.purpleDim, border: `1px solid ${T.purple}40`, borderRadius: 16, padding: 16, marginBottom: 24 }}>
            <div style={{ fontFamily: font, fontWeight: 700, color: T.purple, marginBottom: 4 }}>✦ Based on your squad's history</div>
            <div style={{ fontSize: 13, color: T.textSub }}>The Usual Suspects loves food events and has been most active on weekends. Here's what we recommend:</div>
          </div>

          <SectionLabel>Top Picks for You</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
            {SUGGESTIONS.map((s, i) => (
              <div key={s.title} style={{ background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                <div style={{ background: s.color + "22", padding: "14px 16px 10px", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontFamily: font, fontWeight: 800, fontSize: 16, color: T.text }}>{s.title}</div>
                    <Tag color={s.color}>{s.type}</Tag>
                  </div>
                  <div style={{ fontSize: 13, color: T.textSub, marginTop: 4 }}>{s.why}</div>
                </div>
                <div style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                  <Btn small onPress={() => go("create-event")} style={{ flex: 1 }}>Plan This →</Btn>
                  <Btn small variant="secondary" onPress={() => {}} style={{ width: "auto", padding: "8px 14px" }}>Poll Squad</Btn>
                </div>
              </div>
            ))}
          </div>

          <SectionLabel>Or Start from Scratch</SectionLabel>
          <Btn variant="ghost" onPress={() => go("create-event")}>+ Create Custom Event</Btn>
        </div>
      </ScrollArea>
    </div>
  );
}

// S20: Schedule Finder
function ScheduleFinderScreen({ go }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const times = ["6PM", "7PM", "8PM", "9PM", "10PM"];
  const heatmap = [
    [0,1,2,3,1,0,2], [1,2,3,4,2,1,1], [0,1,2,5,3,2,3],
    [1,0,1,3,4,5,4], [2,1,0,2,3,4,5],
  ];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: "0 0 10px" }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white }}>Find the Best Time</div>
        <div style={{ fontSize: 13, color: T.textSub }}>7 of 7 members synced their calendars</div>
      </div>
      <ScrollArea>
        <div style={{ padding: "20px" }}>
          <div style={{ background: T.greenDim, border: `1px solid ${T.green}40`, borderRadius: 14, padding: 14, marginBottom: 20, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 22 }}>⚡</span>
            <div>
              <div style={{ fontFamily: font, fontWeight: 700, color: T.green, fontSize: 14 }}>AI Best Pick: Saturday 8PM</div>
              <div style={{ fontSize: 12, color: T.textSub }}>6 of 7 members available — highest overlap</div>
            </div>
          </div>

          <SectionLabel>Availability Heatmap</SectionLabel>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `60px repeat(7, 1fr)`, gap: 3, minWidth: 340 }}>
              <div />
              {days.map(d => <div key={d} style={{ fontSize: 11, color: T.textDim, textAlign: "center", fontFamily: font, padding: "2px 0" }}>{d}</div>)}
              {times.map((time, ti) => (
                <>
                  <div key={time} style={{ fontSize: 11, color: T.textDim, display: "flex", alignItems: "center", fontFamily: fontMono }}>{time}</div>
                  {heatmap[ti].map((val, di) => (
                    <div key={di} style={{
                      height: 36, borderRadius: 6, cursor: "pointer",
                      background: val === 0 ? T.surfaceHigh : val <= 2 ? T.green + "40" : val <= 4 ? T.green + "80" : T.green,
                      border: val === 5 ? `1px solid ${T.green}` : "none",
                    }} />
                  ))}
                </>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}><div style={{ width: 14, height: 14, borderRadius: 3, background: T.surfaceHigh }} /><span style={{ fontSize: 11, color: T.textDim }}>Busy</span></div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}><div style={{ width: 14, height: 14, borderRadius: 3, background: T.green + "60" }} /><span style={{ fontSize: 11, color: T.textDim }}>Some free</span></div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}><div style={{ width: 14, height: 14, borderRadius: 3, background: T.green }} /><span style={{ fontSize: 11, color: T.textDim }}>Everyone free</span></div>
          </div>

          <div style={{ marginTop: 24 }}>
            <Btn onPress={() => go("create-event")}>Use Saturday 8PM →</Btn>
            <div style={{ marginTop: 10 }}><Btn variant="secondary" onPress={() => {}}>Poll Squad on Time Options</Btn></div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// S21: Squad Settings
function SquadSettingsScreen({ go }) {
  const [notifs, setNotifs] = useState(true);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: "0 0 10px" }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white }}>Squad Settings</div>
        <div style={{ fontSize: 13, color: T.textSub }}>The Usual Suspects</div>
      </div>
      <ScrollArea>
        <div style={{ padding: "20px" }}>
          {/* Squad profile */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: 24, background: T.accent + "22", border: `2px solid ${T.accent}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 12px", cursor: "pointer" }}>🔥</div>
            <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.accent, cursor: "pointer" }}>Change Emoji</div>
          </div>
          <div style={{ marginBottom: 20 }}><Input placeholder="Squad name" icon="✏️" /></div>

          {[
            { label: "Members", items: [
              { icon: "👥", label: "Manage Members (7)", onPress: () => {} },
              { icon: "🔗", label: "Invite Link", onPress: () => {} },
              { icon: "👑", label: "Transfer Ownership", onPress: () => {} },
            ]},
            { label: "Privacy", items: [
              { icon: "🔔", label: "Notifications for this squad", toggle: notifs, onToggle: () => setNotifs(!notifs) },
              { icon: "🔒", label: "Squad Visibility: Private", onPress: () => {} },
              { icon: "📋", label: "Event Privacy: Squad Only", onPress: () => {} },
            ]},
            { label: "Danger Zone", items: [
              { icon: "🚪", label: "Leave Squad", onPress: () => go("home"), danger: true },
              { icon: "🗑️", label: "Delete Squad", onPress: () => {}, danger: true },
            ]},
          ].map(group => (
            <div key={group.label} style={{ marginBottom: 20 }}>
              <SectionLabel>{group.label}</SectionLabel>
              <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                {group.items.map((item, ii) => (
                  <div key={item.label}>
                    {ii > 0 && <Divider />}
                    <div onClick={item.onPress} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}>
                      <span style={{ fontSize: 18 }}>{item.icon}</span>
                      <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: item.danger ? "#FF4444" : T.text }}>{item.label}</div>
                      {item.toggle !== undefined ? <Switch on={item.toggle} toggle={item.onToggle} /> : <span style={{ color: T.textDim, fontSize: 18 }}>›</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// S22: Pro Paywall
function PaywallScreen({ go }) {
  const [annual, setAnnual] = useState(true);
  const proFeatures = ["Unlimited squads & members", "AI event suggestions", "Calendar sync + best time finder", "Budget ↔ Venmo/Splitwise sync", "Photo albums per event", "Squad history & streak analytics", "Priority support"];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 0", flexShrink: 0 }}>
        <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0 }}>✕</button>
      </div>
      <ScrollArea>
        <div style={{ padding: "16px 24px 40px" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ width: 64, height: 64, borderRadius: 22, background: `linear-gradient(135deg, ${T.gold}, ${T.accent})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 14px", boxShadow: `0 12px 40px ${T.gold}50` }}>⭐</div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white }}>Squadz Pro</div>
            <div style={{ fontSize: 14, color: T.textSub, marginTop: 4 }}>Plan without limits</div>
          </div>

          {/* Toggle */}
          <div style={{ background: T.surfaceUp, borderRadius: 12, padding: 4, display: "flex", marginBottom: 20 }}>
            {[["Monthly", false], ["Annual (Save 33%)", true]].map(([label, val]) => (
              <div key={label} onClick={() => setAnnual(val)} style={{
                flex: 1, padding: "9px 0", borderRadius: 10, textAlign: "center",
                background: annual === val ? T.accent : "transparent",
                color: annual === val ? "#fff" : T.textSub,
                fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all 0.2s",
              }}>{label}</div>
            ))}
          </div>

          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 36, color: T.white }}>{annual ? "$3.33" : "$4.99"}<span style={{ fontSize: 16, color: T.textSub }}>/mo</span></div>
            <div style={{ fontSize: 12, color: T.textSub }}>{annual ? "Billed $39.99/year · saves $20" : "Billed monthly"}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {proFeatures.map(f => (
              <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 20, height: 20, borderRadius: 10, background: T.gold, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#000", flexShrink: 0 }}>✓</div>
                <div style={{ fontFamily: font, fontSize: 14, color: T.text }}>{f}</div>
              </div>
            ))}
          </div>

          <Btn variant="gold" onPress={() => go("home")}>Start 14-Day Free Trial</Btn>
          <div style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: T.textDim, fontFamily: font }}>Cancel anytime. No charge until trial ends.</div>
          <div style={{ textAlign: "center", marginTop: 6 }}><span onClick={() => go("home")} style={{ fontSize: 13, color: T.textSub, cursor: "pointer" }}>Maybe later</span></div>
        </div>
      </ScrollArea>
    </div>
  );
}

// S23: Edit Profile
function EditProfileScreen({ go }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: "0 0 10px" }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white }}>Edit Profile</div>
      </div>
      <ScrollArea>
        <div style={{ padding: "24px 20px" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800, color: "#000", margin: "0 auto 10px" }}>J</div>
            <div style={{ fontSize: 13, color: T.accent, cursor: "pointer", fontFamily: font }}>📷 Change Photo</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input placeholder="First name" icon="👤" />
            <Input placeholder="Last name" />
            <Input placeholder="Username (@jordank)" icon="@" />
            <Input placeholder="Bio (optional)" />
            <Input placeholder="Email" icon="✉️" type="email" />
            <Input placeholder="Phone" icon="📱" type="tel" />
          </div>
          <div style={{ marginTop: 24 }}><Btn onPress={() => go("home")}>Save Changes</Btn></div>
        </div>
      </ScrollArea>
    </div>
  );
}

// S24: Event Settings
function EventSettingsScreen({ go }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <button onClick={() => go("event-detail")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: "0 0 10px" }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white }}>Event Settings</div>
        <div style={{ fontSize: 13, color: T.textSub }}>Rooftop BBQ 🔥</div>
      </div>
      <ScrollArea>
        <div style={{ padding: "20px" }}>
          {[
            { label: "Manage", items: [
              { icon: "✏️", label: "Edit Event Details", onPress: () => {} },
              { icon: "👥", label: "Manage Guest List", onPress: () => {} },
              { icon: "🔗", label: "Share Event Link", onPress: () => {} },
              { icon: "📋", label: "Duplicate Event", onPress: () => {} },
            ]},
            { label: "Notifications", items: [
              { icon: "📣", label: "Send Reminder to Squad", onPress: () => {} },
              { icon: "🔔", label: "Notify on RSVP changes", onPress: () => {} },
            ]},
            { label: "Danger Zone", items: [
              { icon: "🚫", label: "Cancel Event", onPress: () => go("home"), danger: true },
              { icon: "🗑️", label: "Delete Event", onPress: () => go("home"), danger: true },
            ]},
          ].map(group => (
            <div key={group.label} style={{ marginBottom: 20 }}>
              <SectionLabel>{group.label}</SectionLabel>
              <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
                {group.items.map((item, ii) => (
                  <div key={item.label}>
                    {ii > 0 && <Divider />}
                    <div onClick={item.onPress} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}>
                      <span style={{ fontSize: 18 }}>{item.icon}</span>
                      <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: item.danger ? "#FF4444" : T.text }}>{item.label}</div>
                      <span style={{ color: T.textDim, fontSize: 18 }}>›</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── NEW: Messages Inbox ───────────────────────────────────────────────────────
function MessagesInboxScreen({ go }) {
  const [tab, setTab] = useState("all");
  const dms = [
    { who: "Marcus", preview: "yo are you bringing anything extra?", time: "2m", unread: 2, online: true },
    { who: "Kira", preview: "Can we carpool? 🚗", time: "18m", unread: 1, online: false },
    { who: "Tasha", preview: "Loved last week's hangout!", time: "1h", unread: 0, online: true },
    { who: "Alex", preview: "Running 10min late", time: "3h", unread: 0, online: false },
    { who: "Rico", preview: "Next time for sure 🙏", time: "1d", unread: 0, online: false },
  ];
  const eventThreads = [
    { name: "Rooftop BBQ 🔥", squad: "The Usual Suspects", preview: "Marcus: Location confirmed!", time: "2m", unread: 5, emoji: "🔥" },
    { name: "Escape Room 🔐", squad: "Work Crew", preview: "Jordan: Who's driving?", time: "1h", unread: 1, emoji: "🔐" },
    { name: "Lake House Wknd 🏖️", squad: "College Fam", preview: "Priya: I'll bring snacks", time: "3h", unread: 0, emoji: "🏖️" },
  ];
  const allItems = [
    ...dms.map(d => ({ ...d, type: "dm" })),
    ...eventThreads.map(e => ({ ...e, type: "event" })),
  ].sort((a, b) => (b.unread - a.unread));

  const shown = tab === "all" ? allItems : tab === "dms" ? dms.map(d => ({ ...d, type: "dm" })) : eventThreads.map(e => ({ ...e, type: "event" }));
  const totalUnread = dms.reduce((s, d) => s + d.unread, 0) + eventThreads.reduce((s, e) => s + e.unread, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 0", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white }}>
            Messages {totalUnread > 0 && <span style={{ fontSize: 13, background: T.accent, color: "#fff", borderRadius: 10, padding: "2px 7px", marginLeft: 6, fontFamily: font }}>{totalUnread}</span>}
          </div>
          <button onClick={() => go("dm-chat")} style={{ width: 36, height: 36, borderRadius: 12, background: T.accentDim, border: `1px solid ${T.accent}`, color: T.accent, fontSize: 18, cursor: "pointer" }}>✏️</button>
        </div>
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15 }}>🔍</span>
          <input placeholder="Search messages…" style={{ width: "100%", background: T.surfaceHigh, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px 10px 38px", color: T.text, fontFamily: font, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
        </div>
        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {[["all", "All"], ["dms", "Direct"], ["events", "Events"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              flex: 1, background: "none", border: "none", padding: "8px 0", cursor: "pointer",
              fontFamily: font, fontWeight: 700, fontSize: 13, color: tab === k ? T.accent : T.textDim,
              borderBottom: `2px solid ${tab === k ? T.accent : "transparent"}`,
            }}>{l}</button>
          ))}
        </div>
      </div>

      <ScrollArea>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.map((item, i) => (
            <div key={i} onClick={() => go(item.type === "dm" ? "dm-chat" : "event-thread")}
              style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 20px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: item.unread > 0 ? T.accentGlow : "transparent" }}>
              {/* Avatar / icon */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                {item.type === "dm"
                  ? <Avatar name={item.who} size={48} />
                  : <div style={{ width: 48, height: 48, borderRadius: 16, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, border: `1px solid ${T.gold}40` }}>{item.emoji}</div>
                }
                {item.type === "dm" && item.online && (
                  <div style={{ position: "absolute", bottom: 1, right: 1, width: 13, height: 13, borderRadius: "50%", background: T.green, border: `2px solid ${T.bg}` }} />
                )}
                {item.type === "event" && (
                  <div style={{ position: "absolute", bottom: -3, right: -3, width: 18, height: 18, borderRadius: "50%", background: T.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700, border: `2px solid ${T.bg}` }}>E</div>
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <div style={{ fontFamily: font, fontWeight: item.unread > 0 ? 800 : 600, fontSize: 15, color: T.text }}>{item.type === "dm" ? item.who : item.name}</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>{item.time}</div>
                </div>
                {item.type === "event" && <div style={{ fontSize: 11, color: T.textDim, marginBottom: 2 }}>{item.squad}</div>}
                <div style={{ fontSize: 13, color: item.unread > 0 ? T.textSub : T.textDim, fontFamily: font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: item.unread > 0 ? 600 : 400 }}>
                  {item.preview}
                </div>
              </div>

              {/* Unread badge */}
              {item.unread > 0 && (
                <div style={{ width: 22, height: 22, borderRadius: 11, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{item.unread}</div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── NEW: DM Chat (1:1) ────────────────────────────────────────────────────────
function DMChatScreen({ go }) {
  const [msg, setMsg] = useState("");
  const [reacting, setReacting] = useState(null);
  const [reactions, setReactions] = useState({});
  const messages = [
    { id: 1, who: "Marcus", text: "yo are you bringing anything extra to the BBQ?", time: "2:14 PM", me: false },
    { id: 2, who: "Jordan", text: "Thinking maybe watermelon? Or should I grab more drinks", time: "2:15 PM", me: true },
    { id: 3, who: "Marcus", text: "watermelon would be 🔥 drinks we're covered", time: "2:16 PM", me: false },
    { id: 4, who: "Jordan", text: "Perfect I'll grab a big one. See you at 5!", time: "2:17 PM", me: true },
    { id: 5, who: "Marcus", text: "💪 rooftop is ready, got lights strung up and everything", time: "2:45 PM", me: false },
  ];
  const emojiReacts = ["❤️","😂","🔥","👍","😮","🎉"];
  const addReaction = (msgId, emoji) => {
    setReactions(r => ({ ...r, [msgId]: [...(r[msgId] || []), emoji] }));
    setReacting(null);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => go("messages")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
        <div style={{ position: "relative" }}>
          <Avatar name="Marcus" size={40} />
          <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: T.green, border: `2px solid ${T.bg}` }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: font, fontWeight: 800, fontSize: 16, color: T.white }}>Marcus</div>
          <div style={{ fontSize: 12, color: T.green }}>Active now</div>
        </div>
        <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>📞</button>
        <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>📹</button>
        <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer" }}>ℹ️</button>
      </div>

      {/* Mutual event banner */}
      <div onClick={() => go("event-detail")} style={{ margin: "10px 16px 0", background: T.gold + "18", border: `1px solid ${T.gold}40`, borderRadius: 12, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>🔥</span>
        <div style={{ flex: 1, fontSize: 12, color: T.textSub }}><span style={{ color: T.gold, fontWeight: 700 }}>Rooftop BBQ</span> · Sat Jun 7 · you're both going</div>
        <span style={{ fontSize: 14, color: T.textDim }}>›</span>
      </div>

      {/* Messages */}
      <ScrollArea style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {messages.map((m, i) => {
            const showAvatar = !m.me && (i === 0 || messages[i - 1].me);
            const msgReacts = reactions[m.id] || [];
            return (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexDirection: m.me ? "row-reverse" : "row" }}>
                  {!m.me && <div style={{ width: 28 }}>{showAvatar ? <Avatar name={m.who} size={28} /> : null}</div>}
                  <div onDoubleClick={() => setReacting(reacting === m.id ? null : m.id)} style={{ maxWidth: "72%", cursor: "pointer" }}>
                    <div style={{ background: m.me ? T.accent : T.surfaceUp, borderRadius: m.me ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "10px 14px", fontSize: 14, color: m.me ? "#fff" : T.text, fontFamily: font, lineHeight: 1.5 }}>
                      {m.text}
                    </div>
                    {msgReacts.length > 0 && (
                      <div style={{ display: "flex", gap: 3, marginTop: 3, justifyContent: m.me ? "flex-end" : "flex-start" }}>
                        {[...new Set(msgReacts)].map(e => (
                          <div key={e} style={{ background: T.surfaceHigh, borderRadius: 10, padding: "2px 6px", fontSize: 12 }}>{e} {msgReacts.filter(r => r === e).length}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: T.textDim, marginTop: 2, paddingLeft: m.me ? 0 : 36, paddingRight: m.me ? 0 : 0 }}>{m.time}</div>
                {reacting === m.id && (
                  <div style={{ display: "flex", gap: 6, background: T.surfaceUp, borderRadius: 24, padding: "6px 10px", border: `1px solid ${T.border}`, marginTop: 4 }}>
                    {emojiReacts.map(e => <span key={e} onClick={() => addReaction(m.id, e)} style={{ fontSize: 22, cursor: "pointer" }}>{e}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Input */}
      <div style={{ padding: "10px 14px 28px", background: T.surface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: T.textSub, padding: "8px 0" }}>+</button>
          <div style={{ flex: 1, background: T.surfaceUp, borderRadius: 22, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "8px 14px", gap: 8 }}>
            <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Message Marcus…" style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <button style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>😊</button>
          </div>
          <button style={{ width: 38, height: 38, borderRadius: 19, background: msg ? T.accent : T.surfaceHigh, border: "none", fontSize: 16, cursor: "pointer", color: msg ? "#fff" : T.textDim, transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center" }}>↑</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto" }}>
          {["👍 Sounds good!", "🔥 Can't wait!", "Running late", "On my way!"].map(q => (
            <div key={q} onClick={() => setMsg(q)} style={{ background: T.surfaceHigh, borderRadius: 16, padding: "5px 12px", fontSize: 12, color: T.textSub, fontFamily: font, whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 }}>{q}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── NEW: Event Thread (group chat with threads) ────────────────────────────────
function EventThreadScreen({ go }) {
  const [msg, setMsg] = useState("");
  const [pinned, setPinned] = useState(true);
  const threads = [
    { id: 1, who: "Marcus", text: "Location confirmed — 142 Oak St, rooftop access via elevator 🏙️", time: "10:00 AM", me: false, replies: 4, pinned: true, replyPreview: "Jordan: Got it! · Kira: 🔥" },
    { id: 2, who: "Jordan", text: "Poll closed — we're starting at 5 PM! 🎉", time: "11:30 AM", me: true, replies: 2, pinned: false, replyPreview: "Marcus: Perfect · Tasha: 👍" },
    { id: 3, who: "Kira", text: "I claimed veggie skewers on the food list! Anyone else still need to claim?", time: "1:15 PM", me: false, replies: 1, pinned: false, replyPreview: "Alex: I got chips" },
    { id: 4, who: "Tasha", text: "Anyone need a ride from the Eastside? I have room for 2", time: "2:00 PM", me: false, replies: 0, pinned: false },
    { id: 5, who: "Marcus", text: "Rooftop is ready 🔥 lights are up, coolers are stocked", time: "4:45 PM", me: false, replies: 3, pinned: false, replyPreview: "+3 reactions" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 0", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <button onClick={() => go("messages")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ width: 38, height: 38, borderRadius: 13, background: T.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔥</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 800, fontSize: 15, color: T.white }}>Rooftop BBQ</div>
            <div style={{ fontSize: 11, color: T.textSub }}>The Usual Suspects · 7 members</div>
          </div>
          <button onClick={() => go("event-detail")} style={{ background: T.accentDim, border: `1px solid ${T.accent}40`, borderRadius: 8, padding: "4px 10px", fontSize: 11, color: T.accent, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Event →</button>
        </div>
        {/* Sub-nav */}
        <div style={{ display: "flex", gap: 2 }}>
          {["Thread", "Members", "Media", "Links"].map((t, i) => (
            <button key={t} style={{ flex: 1, background: "none", border: "none", padding: "7px 0", cursor: "pointer", fontFamily: font, fontWeight: i === 0 ? 700 : 500, fontSize: 12, color: i === 0 ? T.accent : T.textDim, borderBottom: `2px solid ${i === 0 ? T.accent : "transparent"}` }}>{t}</button>
          ))}
        </div>
      </div>

      <ScrollArea style={{ padding: "12px 16px" }}>
        {/* Pinned message */}
        {pinned && (
          <div style={{ background: T.gold + "12", border: `1px solid ${T.gold}40`, borderRadius: 12, padding: "10px 13px", marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>📌</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: T.gold, fontWeight: 700, marginBottom: 2 }}>PINNED</div>
              <div style={{ fontSize: 13, color: T.textSub }}>Location: 142 Oak St, rooftop. Elevator access. Start time: 5 PM. Food list in event.</div>
            </div>
            <button onClick={() => setPinned(false)} style={{ background: "none", border: "none", color: T.textDim, fontSize: 14, cursor: "pointer" }}>✕</button>
          </div>
        )}

        {/* Thread messages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {threads.map(m => (
            <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Avatar name={m.who} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>{m.who}</span>
                  <span style={{ fontSize: 11, color: T.textDim }}>{m.time}</span>
                  {m.pinned && <span style={{ fontSize: 10, color: T.gold }}>📌</span>}
                </div>
                <div style={{ background: T.surfaceUp, borderRadius: "4px 16px 16px 16px", padding: "10px 13px", fontSize: 14, color: T.text, fontFamily: font, lineHeight: 1.5, border: `1px solid ${T.border}` }}>
                  {m.text}
                </div>
                {m.replies > 0 && (
                  <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                    <div style={{ display: "flex" }}>
                      {["M","J","K"].slice(0, Math.min(m.replies, 3)).map((l, li) => (
                        <div key={li} style={{ width: 18, height: 18, borderRadius: 9, background: getAvatarColor(l), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, color: "#000", marginLeft: li > 0 ? -4 : 0, border: `1.5px solid ${T.bg}` }}>{l}</div>
                      ))}
                    </div>
                    <span style={{ fontSize: 12, color: T.blue, fontWeight: 700 }}>{m.replies} {m.replies === 1 ? "reply" : "replies"}</span>
                    {m.replyPreview && <span style={{ fontSize: 11, color: T.textDim }}> · {m.replyPreview}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div style={{ padding: "10px 14px 28px", background: T.surface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, background: T.surfaceUp, borderRadius: 22, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "9px 14px", gap: 8 }}>
            <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Message the squad…" style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <span style={{ fontSize: 18, cursor: "pointer" }}>📎</span>
            <span style={{ fontSize: 18, cursor: "pointer" }}>😊</span>
          </div>
          <button style={{ width: 40, height: 40, borderRadius: 20, background: msg ? T.accent : T.surfaceHigh, border: "none", fontSize: 16, cursor: "pointer", color: msg ? "#fff" : T.textDim }}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ── NEW: Event Comments / Topic Threads ───────────────────────────────────────
function EventCommentsScreen({ go }) {
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [liked, setLiked] = useState(new Set());
  const comments = [
    {
      id: 1, who: "Marcus", text: "Just confirmed with the building — elevator goes straight to the roof! 🎉", time: "10:00 AM", likes: 5,
      replies: [
        { id: 11, who: "Kira", text: "Amazing! Are there bathrooms up there?", time: "10:05 AM", likes: 1 },
        { id: 12, who: "Marcus", text: "Yes! Full access 🙌", time: "10:08 AM", likes: 2 },
      ]
    },
    {
      id: 2, who: "Jordan", text: "Quick poll closed — majority vote was 5 PM start. Linking the updated food list below 👇", time: "11:30 AM", likes: 4,
      replies: []
    },
    {
      id: 3, who: "Alex", text: "Should we do a white elephant gift thing since Rico can't make it? Could mail him one 😄", time: "1:00 PM", likes: 3,
      replies: [
        { id: 31, who: "Tasha", text: "Omg yes! $10 limit?", time: "1:04 PM", likes: 2 },
      ]
    },
  ];

  const toggleLike = (id) => {
    const s = new Set(liked);
    s.has(id) ? s.delete(id) : s.add(id);
    setLiked(s);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 14px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => go("event-detail")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
          <div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 18, fontWeight: 700, color: T.white }}>Comments</div>
            <div style={{ fontSize: 12, color: T.textSub }}>Rooftop BBQ 🔥 · 3 topics</div>
          </div>
        </div>
      </div>

      <ScrollArea style={{ padding: "16px 16px" }}>
        {/* Topics / pinned items */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8 }}>📌 Pinned Topics</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {["📍 Location", "🍔 Food List", "💸 Budget", "🕐 Start Time"].map(tag => (
              <div key={tag} style={{ background: T.surfaceHigh, borderRadius: 20, padding: "6px 14px", fontSize: 12, color: T.textSub, fontFamily: font, whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${T.border}` }}>{tag}</div>
            ))}
          </div>
        </div>

        {/* Comments */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 10 }}>All Comments</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {comments.map(c => (
            <div key={c.id}>
              {/* Top-level comment */}
              <div style={{ display: "flex", gap: 10 }}>
                <Avatar name={c.who} size={36} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: T.text, fontFamily: font }}>{c.who}</span>
                    <span style={{ fontSize: 11, color: T.textDim }}>{c.time}</span>
                  </div>
                  <div style={{ background: T.surfaceUp, borderRadius: "4px 14px 14px 14px", padding: "10px 13px", fontSize: 14, color: T.text, fontFamily: font, lineHeight: 1.5, border: `1px solid ${T.border}` }}>
                    {c.text}
                  </div>
                  {/* Actions */}
                  <div style={{ display: "flex", gap: 14, marginTop: 7, paddingLeft: 4 }}>
                    <div onClick={() => toggleLike(c.id)} style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                      <span style={{ fontSize: 14 }}>{liked.has(c.id) ? "❤️" : "🤍"}</span>
                      <span style={{ fontSize: 12, color: liked.has(c.id) ? T.accent : T.textDim }}>{c.likes + (liked.has(c.id) ? 1 : 0)}</span>
                    </div>
                    <div onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} style={{ fontSize: 12, color: T.textDim, cursor: "pointer", fontWeight: 600 }}>↩ Reply</div>
                    <div style={{ fontSize: 12, color: T.textDim, cursor: "pointer" }}>• • •</div>
                  </div>
                  {/* Reply input */}
                  {replyTo === c.id && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                      <Avatar name="Jordan" size={26} color={T.accent} />
                      <div style={{ flex: 1, background: T.surfaceHigh, borderRadius: 16, border: `1px solid ${T.accent}40`, display: "flex", alignItems: "center", padding: "7px 12px", gap: 8 }}>
                        <input placeholder={`Reply to ${c.who}…`} style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 13, outline: "none" }} />
                        <span style={{ fontSize: 16, cursor: "pointer", color: T.accent }}>↑</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Replies */}
              {c.replies.length > 0 && (
                <div style={{ marginLeft: 46, marginTop: 8, display: "flex", flexDirection: "column", gap: 8, borderLeft: `2px solid ${T.border}`, paddingLeft: 12 }}>
                  {c.replies.map(r => (
                    <div key={r.id} style={{ display: "flex", gap: 8 }}>
                      <Avatar name={r.who} size={28} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: T.text, fontFamily: font }}>{r.who}</span>
                          <span style={{ fontSize: 10, color: T.textDim }}>{r.time}</span>
                        </div>
                        <div style={{ background: T.surfaceHigh, borderRadius: "4px 12px 12px 12px", padding: "8px 11px", fontSize: 13, color: T.text, fontFamily: font, lineHeight: 1.5 }}>
                          {r.text}
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 5 }}>
                          <div onClick={() => toggleLike(r.id)} style={{ display: "flex", gap: 3, alignItems: "center", cursor: "pointer" }}>
                            <span style={{ fontSize: 12 }}>{liked.has(r.id) ? "❤️" : "🤍"}</span>
                            <span style={{ fontSize: 11, color: T.textDim }}>{r.likes + (liked.has(r.id) ? 1 : 0)}</span>
                          </div>
                          <div style={{ fontSize: 11, color: T.textDim, cursor: "pointer" }}>Reply</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* New comment input */}
      <div style={{ padding: "10px 16px 28px", background: T.surface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Avatar name="Jordan" size={32} color={T.accent} />
          <div style={{ flex: 1, background: T.surfaceUp, borderRadius: 20, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "9px 14px", gap: 8 }}>
            <input value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a comment…" style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <span style={{ fontSize: 18, cursor: "pointer" }}>😊</span>
          </div>
          <button style={{ width: 38, height: 38, borderRadius: 19, background: newComment ? T.accent : T.surfaceHigh, border: "none", fontSize: 16, cursor: "pointer", color: newComment ? "#fff" : T.textDim }}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ── NEW: Checklist Manager (Dedicated, Standalone) ────────────────────────────
function ChecklistManagerScreen({ go }) {
  const [lists, setLists] = useState([
    {
      id: 1, title: "Event Prep", color: T.accent, icon: "🔥",
      items: [
        { id: 11, text: "Book the rooftop", done: true, assignee: "Marcus", due: "Jun 5", priority: "high" },
        { id: 12, text: "Buy drinks", done: true, assignee: "Jordan", due: "Jun 6", priority: "high" },
        { id: 13, text: "Get ice bags (3)", done: false, assignee: "Jordan", due: "Jun 7", priority: "med" },
        { id: 14, text: "Set up lighting", done: false, assignee: "Marcus", due: "Jun 7", priority: "med" },
        { id: 15, text: "Make a playlist", done: false, assignee: null, due: null, priority: "low" },
      ]
    },
    {
      id: 2, title: "Day-Of Tasks", color: T.blue, icon: "📋",
      items: [
        { id: 21, text: "Pick up Tasha (5:00 PM)", done: false, assignee: "Jordan", due: "Jun 7 5PM", priority: "high" },
        { id: 22, text: "Grab watermelon from store", done: false, assignee: "Jordan", due: "Jun 7 4PM", priority: "med" },
        { id: 23, text: "Bring speakers", done: false, assignee: "Marcus", due: null, priority: "low" },
      ]
    },
  ]);
  const [activeList, setActiveList] = useState(1);
  const [showDone, setShowDone] = useState(true);
  const list = lists.find(l => l.id === activeList);
  const toggleItem = (listId, itemId) => {
    setLists(ls => ls.map(l => l.id === listId ? { ...l, items: l.items.map(it => it.id === itemId ? { ...it, done: !it.done } : it) } : l));
  };
  const priorityColors = { high: T.accent, med: T.gold, low: T.green };
  const shown = list?.items.filter(i => showDone || !i.done) || [];
  const doneCount = list?.items.filter(i => i.done).length || 0;
  const totalCount = list?.items.length || 0;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={() => go("event-detail")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ flex: 1, fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.white }}>Checklists</div>
          <button style={{ background: T.accentDim, border: `1px solid ${T.accent}40`, borderRadius: 10, padding: "5px 12px", fontSize: 12, color: T.accent, fontWeight: 700, cursor: "pointer", fontFamily: font }}>+ New List</button>
        </div>
        {/* List tabs */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
          {lists.map(l => (
            <div key={l.id} onClick={() => setActiveList(l.id)} style={{
              display: "flex", gap: 6, alignItems: "center", padding: "7px 14px",
              borderRadius: 20, cursor: "pointer", flexShrink: 0,
              background: activeList === l.id ? l.color + "22" : T.surfaceHigh,
              border: `1.5px solid ${activeList === l.id ? l.color : T.border}`,
            }}>
              <span style={{ fontSize: 14 }}>{l.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: activeList === l.id ? l.color : T.textSub, fontFamily: font }}>{l.title}</span>
              <span style={{ fontSize: 10, background: l.color + "30", color: l.color, borderRadius: 8, padding: "1px 6px", fontFamily: fontMono }}>{l.items.filter(i => i.done).length}/{l.items.length}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      {list && (
        <div style={{ padding: "12px 16px 10px", background: T.surfaceUp, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>{doneCount} of {totalCount} complete</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: list.color, fontFamily: fontMono }}>{pct}%</div>
          </div>
          <div style={{ background: T.surfaceHigh, borderRadius: 6, height: 6 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${list.color}, ${list.color}AA)`, borderRadius: 6, transition: "width 0.4s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {[["high", "Urgent"], ["med", "Normal"], ["low", "Later"]].map(([p, label]) => (
                <div key={p} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: priorityColors[p] }} />
                  <span style={{ fontSize: 10, color: T.textDim }}>{label}</span>
                </div>
              ))}
            </div>
            <div onClick={() => setShowDone(!showDone)} style={{ fontSize: 11, color: T.textDim, cursor: "pointer", fontFamily: font }}>
              {showDone ? "Hide" : "Show"} done
            </div>
          </div>
        </div>
      )}

      <ScrollArea style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map(item => (
            <div key={item.id} style={{
              background: item.done ? T.surface : T.surfaceUp,
              border: `1px solid ${item.done ? T.border : list?.color + "30"}`,
              borderRadius: 14, padding: "12px 14px",
              display: "flex", alignItems: "flex-start", gap: 12, opacity: item.done ? 0.65 : 1,
            }}>
              {/* Checkbox */}
              <div onClick={() => toggleItem(list.id, item.id)} style={{
                width: 24, height: 24, borderRadius: 7, border: `2px solid ${item.done ? T.green : list?.color}`,
                background: item.done ? T.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, color: "#000", fontWeight: 800, cursor: "pointer", flexShrink: 0, marginTop: 1,
              }}>{item.done ? "✓" : ""}</div>

              {/* Content */}
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text, textDecoration: item.done ? "line-through" : "none", marginBottom: 4 }}>{item.text}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {item.assignee && (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <Avatar name={item.assignee} size={16} />
                      <span style={{ fontSize: 11, color: T.textDim }}>{item.assignee}</span>
                    </div>
                  )}
                  {item.due && <div style={{ fontSize: 11, color: T.textDim }}>📅 {item.due}</div>}
                  <div style={{ background: priorityColors[item.priority] + "22", color: priorityColors[item.priority], fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 8, fontFamily: fontMono }}>{item.priority.toUpperCase()}</div>
                </div>
              </div>
              <button style={{ background: "none", border: "none", color: T.textDim, fontSize: 16, cursor: "pointer" }}>⋮</button>
            </div>
          ))}

          {/* Add item */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", background: T.surface, border: `1.5px dashed ${T.border}`, borderRadius: 14, cursor: "pointer" }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, border: `2px dashed ${T.textDim}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: T.textDim }}>+</div>
            <span style={{ fontSize: 14, color: T.textDim, fontFamily: font }}>Add a task…</span>
          </div>
        </div>

        {/* Assign to member */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8 }}>Assigned To</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {MEMBERS.map(m => {
              const count = list?.items.filter(i => i.assignee === m.name).length || 0;
              return (
                <div key={m.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <div style={{ position: "relative" }}>
                    <Avatar name={m.name} size={36} />
                    {count > 0 && <div style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: 8, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff" }}>{count}</div>}
                  </div>
                  <div style={{ fontSize: 10, color: T.textDim }}>{m.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ── NEW: Free vs Paid Pricing Screen ─────────────────────────────────────────
function PricingBreakdownScreen({ go }) {
  const [view, setView] = useState("compare");

  const features = [
    { category: "Squads", icon: "👥", items: [
      { name: "Number of squads",            free: "Up to 3",          pro: "Unlimited",         teams: "Unlimited" },
      { name: "Members per squad",           free: "Up to 10",         pro: "Unlimited",         teams: "Unlimited" },
      { name: "Squad activity history",      free: "7 days",           pro: "Unlimited",         teams: "Unlimited" },
      { name: "Squad streak tracking",       free: "✓",                pro: "✓ + leaderboard",   teams: "✓ + leaderboard" },
    ]},
    { category: "Events", icon: "🎉", items: [
      { name: "Events per month",            free: "5",                pro: "Unlimited",         teams: "Unlimited" },
      { name: "Guest RSVP link",             free: "✓",                pro: "✓",                 teams: "✓ + custom branding" },
      { name: "Create event wizard",         free: "✓",                pro: "✓ + templates",     teams: "✓ + approval flow" },
      { name: "Event photo albums",          free: "10 photos/event",  pro: "Unlimited",         teams: "Unlimited + CDN" },
      { name: "Recurring events",            free: "✗",                pro: "✓",                 teams: "✓" },
    ]},
    { category: "Planning Tools", icon: "🛠️", items: [
      { name: "Food planner",                free: "10 items",         pro: "Unlimited + tags",  teams: "Unlimited + export" },
      { name: "Budget tracker",             free: "Manual only",       pro: "✓ + Venmo sync",    teams: "✓ + expense report" },
      { name: "Polls",                       free: "3 options max",    pro: "Unlimited + ranked choice", teams: "✓ + anonymous" },
      { name: "Checklist",                   free: "1 list/event",     pro: "Multiple lists",    teams: "Multiple + assign roles" },
      { name: "Schedule finder",             free: "✗",                pro: "✓ + AI best time",  teams: "✓ + calendar export" },
    ]},
    { category: "Messaging", icon: "💬", items: [
      { name: "Event group chat",            free: "✓",                pro: "✓ + threads",       teams: "✓ + threads + moderation" },
      { name: "Direct messages (DMs)",       free: "Squad members",    pro: "Anyone on Squadz",  teams: "Anyone + file sharing" },
      { name: "Event comments",              free: "✓",                pro: "✓ + reactions",     teams: "✓ + pinned topics" },
      { name: "Message history",             free: "30 days",          pro: "Unlimited",         teams: "Unlimited + export" },
      { name: "Read receipts",               free: "✗",                pro: "✓",                 teams: "✓" },
    ]},
    { category: "AI Features", icon: "✦", items: [
      { name: "Event suggestions",           free: "Basic (2/mo)",     pro: "Unlimited + smart", teams: "✓ + org templates" },
      { name: "Best time AI finder",         free: "✗",                pro: "✓",                 teams: "✓" },
      { name: "Post-event recap",            free: "✗",                pro: "✓",                 teams: "✓ + custom branding" },
      { name: "Weather nudges",              free: "✗",                pro: "✓",                 teams: "✓" },
    ]},
    { category: "Account & Settings", icon: "⚙️", items: [
      { name: "Calendar sync",               free: "View only",        pro: "Full read + write", teams: "Full + SSO" },
      { name: "Notification controls",       free: "Basic",            pro: "Granular",          teams: "Granular + digest" },
      { name: "Custom squad themes",         free: "✗",                pro: "✓",                 teams: "✓ + org branding" },
      { name: "Support",                     free: "Community forum",  pro: "Email (48h SLA)",   teams: "Priority (4h SLA)" },
      { name: "Admin dashboard",             free: "✗",                pro: "✗",                 teams: "✓" },
      { name: "SSO / SAML",                  free: "✗",                pro: "✗",                 teams: "✓" },
    ]},
  ];

  const colColors = { Free: T.textSub, Pro: T.accent, Teams: T.blue };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button onClick={() => go("home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.white }}>Plans & Pricing</div>
            <div style={{ fontSize: 12, color: T.textSub }}>See what's included in each tier</div>
          </div>
        </div>

        {/* Plan cards summary */}
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { name: "Free", price: "$0", color: T.textSub, sub: "Forever" },
            { name: "Pro", price: "$4.99", color: T.accent, sub: "/month", badge: "⭐ Popular" },
            { name: "Teams", price: "$12", color: T.blue, sub: "/seat/mo" },
          ].map(p => (
            <div key={p.name} style={{ flex: 1, background: p.color + "14", border: `1.5px solid ${p.color}50`, borderRadius: 14, padding: "10px 10px", textAlign: "center", position: "relative" }}>
              {p.badge && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: T.accent, borderRadius: 8, padding: "1px 7px", fontSize: 9, fontWeight: 700, color: "#fff", fontFamily: font, whiteSpace: "nowrap" }}>{p.badge}</div>}
              <div style={{ fontFamily: font, fontWeight: 800, fontSize: 13, color: p.color, marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 16, color: T.white }}>{p.price}</div>
              <div style={{ fontSize: 10, color: T.textDim }}>{p.sub}</div>
              {p.name !== "Free" && <div onClick={() => go("paywall")} style={{ marginTop: 6, background: p.color, borderRadius: 8, padding: "5px 0", fontSize: 11, color: "#000", fontWeight: 700, cursor: "pointer" }}>Try Free →</div>}
            </div>
          ))}
        </div>
      </div>

      <ScrollArea>
        <div style={{ padding: "0 0 32px" }}>
          {/* Sticky column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 72px", gap: 4, padding: "10px 16px 8px", background: T.surfaceUp, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ fontSize: 11, color: T.textDim, fontFamily: fontMono, fontWeight: 700 }}>FEATURE</div>
            {["Free", "Pro", "Teams"].map(col => (
              <div key={col} style={{ fontSize: 11, fontWeight: 800, color: colColors[col], fontFamily: fontMono, textAlign: "center" }}>{col}</div>
            ))}
          </div>

          {features.map(group => (
            <div key={group.category}>
              {/* Category header */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px 6px", background: T.surface }}>
                <span style={{ fontSize: 16 }}>{group.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: font }}>{group.category}</span>
              </div>

              {group.items.map((item, ii) => (
                <div key={item.name} style={{
                  display: "grid", gridTemplateColumns: "1fr 72px 72px 72px", gap: 4,
                  padding: "9px 16px", background: ii % 2 === 0 ? T.bg : T.surface,
                  borderBottom: `1px solid ${T.border}30`,
                }}>
                  <div style={{ fontSize: 12, color: T.textSub, fontFamily: font, display: "flex", alignItems: "center" }}>{item.name}</div>
                  {[item.free, item.pro, item.teams].map((val, vi) => {
                    const col = ["Free", "Pro", "Teams"][vi];
                    const isNo = val === "✗";
                    const isYes = val === "✓" || val.startsWith("✓");
                    return (
                      <div key={col} style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ fontSize: isNo || isYes ? 14 : 10, fontWeight: 600, color: isNo ? T.textDim : isYes ? colColors[col] : colColors[col], fontFamily: isNo || isYes ? font : fontMono, lineHeight: 1.3, textAlign: "center" }}>
                          {val}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}

          {/* CTA footer */}
          <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ textAlign: "center", fontSize: 13, color: T.textSub, fontFamily: font, marginBottom: 4 }}>14-day free trial on Pro · Cancel anytime</div>
            <div onClick={() => go("paywall")} style={{ background: T.accent, borderRadius: 14, padding: "13px", textAlign: "center", fontFamily: font, fontWeight: 700, fontSize: 15, color: "#fff", cursor: "pointer" }}>Start Free Pro Trial ⭐</div>
            <div style={{ background: T.blue + "15", border: `1px solid ${T.blue}40`, borderRadius: 14, padding: "13px", textAlign: "center", fontFamily: font, fontWeight: 700, fontSize: 15, color: T.blue, cursor: "pointer" }}>Contact Us for Teams →</div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

/* ─── SCREEN MAP ─────────────────────────────────────────────────────────────── */
const SCREENS = {
  "splash": SplashScreen,
  "signup-options": SignupOptionsScreen,
  "signup-email": SignupEmailScreen,
  "signup-phone": SignupPhoneScreen,
  "verify-otp": VerifyOTPScreen,
  "login": LoginScreen,
  "onboarding-name": OnboardingNameScreen,
  "onboarding-avatar": OnboardingAvatarScreen,
  "onboarding-interests": OnboardingInterestsScreen,
  "create-first-squad": CreateFirstSquadScreen,
  "invite-members": InviteMembersScreen,
  "home": HomeScreen,
  "squad-detail": SquadDetailScreen,
  "create-event": CreateEventScreen,
  "event-detail": EventDetailScreen,
  "guest-rsvp": GuestRSVPScreen,
  "join-invite": JoinInviteScreen,
  "post-event": PostEventScreen,
  "new-event-suggestion": NewEventSuggestionScreen,
  "schedule-finder": ScheduleFinderScreen,
  "squad-settings": SquadSettingsScreen,
  "paywall": PaywallScreen,
  "edit-profile": EditProfileScreen,
  "event-settings": EventSettingsScreen,
  "messages": MessagesInboxScreen,
  "dm-chat": DMChatScreen,
  "event-thread": EventThreadScreen,
  "event-comments": EventCommentsScreen,
  "checklist-detail": ChecklistManagerScreen,
  "pricing": PricingBreakdownScreen,
};

const SCREEN_NAV = [
  { key: "splash", label: "Splash" },
  { key: "signup-options", label: "Sign Up Options" },
  { key: "signup-email", label: "Email Sign Up" },
  { key: "signup-phone", label: "Phone Sign Up" },
  { key: "verify-otp", label: "Verify OTP" },
  { key: "login", label: "Login" },
  { key: "onboarding-name", label: "Name Setup" },
  { key: "onboarding-avatar", label: "Pick Avatar" },
  { key: "onboarding-interests", label: "Interests" },
  { key: "create-first-squad", label: "Create Squad" },
  { key: "invite-members", label: "Invite Members" },
  { key: "home", label: "Home" },
  { key: "squad-detail", label: "Squad Detail" },
  { key: "create-event", label: "Create Event" },
  { key: "event-detail", label: "Event Detail" },
  { key: "guest-rsvp", label: "Guest RSVP" },
  { key: "join-invite", label: "Join via Invite" },
  { key: "schedule-finder", label: "Schedule Finder" },
  { key: "post-event", label: "Post-Event" },
  { key: "new-event-suggestion", label: "AI Suggestions" },
  { key: "squad-settings", label: "Squad Settings" },
  { key: "event-settings", label: "Event Settings" },
  { key: "paywall", label: "Pro Upgrade" },
  { key: "edit-profile", label: "Edit Profile" },
  { key: "messages", label: "Messages Inbox" },
  { key: "dm-chat", label: "DM · 1:1 Chat" },
  { key: "event-thread", label: "Event Group Thread" },
  { key: "event-comments", label: "Event Comments" },
  { key: "checklist-detail", label: "Checklist Manager" },
  { key: "pricing", label: "Free vs Paid" },
];

const GROUPS = [
  { label: "Onboarding", keys: ["splash","signup-options","signup-email","signup-phone","verify-otp","login"] },
  { label: "Setup", keys: ["onboarding-name","onboarding-avatar","onboarding-interests","create-first-squad","invite-members","join-invite"] },
  { label: "Core", keys: ["home","squad-detail","create-event"] },
  { label: "Event", keys: ["event-detail","guest-rsvp","schedule-finder","event-settings"] },
  { label: "Messaging", keys: ["messages","dm-chat","event-thread","event-comments"] },
  { label: "Planning", keys: ["checklist-detail"] },
  { label: "Post-Event", keys: ["post-event","new-event-suggestion"] },
  { label: "Settings", keys: ["squad-settings","paywall","edit-profile","pricing"] },
];

/* ─── ROOT APP ───────────────────────────────────────────────────────────────── */
export default function App() {
  const [screen, setScreen] = useState("splash");
  const [history, setHistory] = useState(["splash"]);
  const [navOpen, setNavOpen] = useState(false);

  const go = (s) => {
    setScreen(s);
    setHistory(h => [...h.slice(-20), s]);
    setNavOpen(false);
  };

  const ActiveScreen = SCREENS[screen] || SplashScreen;
  const groupColors = { Onboarding: T.accent, Setup: T.blue, Core: T.green, Event: T.gold, Messaging: T.purple, Planning: T.pink, "Post-Event": "#FF8C42", Settings: T.textSub };

  return (
    <div style={{ minHeight: "100vh", background: "#050508", display: "flex", fontFamily: font }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Left nav */}
      <div style={{
        width: 220, background: "#080810", borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0, overflowY: "auto", flexShrink: 0,
      }}>
        <div style={{ padding: "20px 16px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.accent }}>squadz</div>
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: fontMono, marginTop: 2, letterSpacing: "0.1em" }}>FULL APP MOCKUP</div>
          <div style={{ fontSize: 10, color: T.textDim, marginTop: 4 }}>{SCREEN_NAV.length} screens documented</div>
        </div>
        <div style={{ padding: "10px 0", flex: 1 }}>
          {GROUPS.map(group => (
            <div key={group.label}>
              <div style={{ padding: "8px 16px 4px", fontSize: 9, fontWeight: 700, color: groupColors[group.label], letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: fontMono }}>{group.label}</div>
              {group.keys.map(key => {
                const nav = SCREEN_NAV.find(n => n.key === key);
                return (
                  <button key={key} onClick={() => go(key)} style={{
                    width: "100%", background: screen === key ? groupColors[group.label] + "18" : "transparent",
                    border: "none", borderLeft: `2px solid ${screen === key ? groupColors[group.label] : "transparent"}`,
                    padding: "8px 14px", cursor: "pointer", textAlign: "left",
                    fontFamily: font, fontWeight: screen === key ? 700 : 500,
                    fontSize: 12, color: screen === key ? T.text : T.textDim,
                    transition: "all 0.1s",
                  }}>{nav?.label}</button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, fontSize: 10, color: T.textDim, lineHeight: 1.5 }}>
          For Dev Team · Click any screen to preview
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", gap: 40 }}>
        {/* Phone */}
        <div style={{ position: "sticky", top: 40 }}>
          <PhoneShell screen={screen}>
            <ActiveScreen go={go} />
          </PhoneShell>

          {/* History breadcrumb */}
          <div style={{ marginTop: 16, display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 390, justifyContent: "center" }}>
            {history.slice(-5).map((h, i) => (
              <span key={i} style={{ fontSize: 10, color: i === history.slice(-5).length - 1 ? T.accent : T.textDim, fontFamily: fontMono, cursor: "pointer" }} onClick={() => go(h)}>
                {SCREEN_NAV.find(n => n.key === h)?.label}{i < history.slice(-5).length - 1 ? " →" : ""}
              </span>
            ))}
          </div>
        </div>

        {/* Right panel: screen notes */}
        <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 16, paddingTop: 0 }}>
          {/* Current screen info */}
          <div style={{ background: "#080810", border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 10, color: T.textDim, fontFamily: fontMono, marginBottom: 8, letterSpacing: "0.08em", textTransform: "uppercase" }}>Current Screen</div>
            <div style={{ fontFamily: font, fontWeight: 800, fontSize: 16, color: T.text, marginBottom: 4 }}>
              {SCREEN_NAV.find(n => n.key === screen)?.label}
            </div>
            <div style={{ fontSize: 12, color: T.textDim, fontFamily: fontMono }}>{screen}</div>
          </div>

          {/* Dev notes per screen */}
          <div style={{ background: "#080810", border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 10, color: T.textDim, fontFamily: fontMono, marginBottom: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>Dev Notes</div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.8, fontFamily: font }}>
              {screen === "splash" && "Lottie animation for logo reveal. A/B test hero copy. Store deep link for badge."}
              {screen === "signup-options" && "Firebase Auth for Google + Apple. Expo AuthSession. Must have Apple auth if Google is present (App Store rule)."}
              {screen === "signup-email" && "Zod validation for email format. bcrypt for passwords server-side. Firebase Auth email/password provider."}
              {screen === "signup-phone" && "Twilio Verify API for SMS OTP. Rate limit: 3 attempts per phone number per hour."}
              {screen === "verify-otp" && "Auto-submit when all 6 digits entered. 30s resend cooldown. Allow paste from clipboard."}
              {screen === "login" && "Support biometric auth (FaceID / fingerprint) on return visits via Expo LocalAuthentication."}
              {screen === "onboarding-name" && "3-step progress bar. Name stored in Firestore user profile. firstName required, lastName optional."}
              {screen === "onboarding-avatar" && "Grid of emoji options OR native image picker (expo-image-picker). Upload to Firebase Storage."}
              {screen === "onboarding-interests" && "Stored in user profile for AI suggestions engine. Min 3 required to proceed. Used for event discovery."}
              {screen === "create-first-squad" && "Creates Firestore squad document. Generates unique invite code (6-char alphanumeric). Branch.io deep link."}
              {screen === "invite-members" && "Expo Contacts for native contact picker. SMS via Twilio. Share sheet for link. All contacts need consent."}
              {screen === "home" && "Real-time Firestore listener. Push notifications via FCM. Skeleton loading state. FAB triggers create-event."}
              {screen === "squad-detail" && "3 tabs: Events, Memories (Firebase Storage), Polls. Member avatars show RSVP status via colored dots."}
              {screen === "create-event" && "6-step wizard. Each step persisted in AsyncStorage for crash recovery. Google Places API for location step."}
              {screen === "event-detail" && "5 tabs: Overview, Food, Budget, Polls, Chat. Real-time listeners on each. Firestore transactions for claims."}
              {screen === "guest-rsvp" && "Web-only route (Next.js). Anonymous Firestore session. No auth required. App install CTA post-RSVP."}
              {screen === "join-invite" && "Deep link via Branch.io. Works when app not installed (deferred deep link). Squad preview from Firestore."}
              {screen === "schedule-finder" && "Google Calendar API + Apple EventKit. Heatmap computed from overlap. AI pick = highest density slot."}
              {screen === "post-event" && "Triggered by Cloud Function 24h after event end. Venmo deep link for settlement. Firebase Storage for photos."}
              {screen === "new-event-suggestion" && "v1: Rule-based (frequency analysis, weather API, time-since-last). v2: ML ranking model per squad."}
              {screen === "squad-settings" && "Owner-only actions (transfer, delete). Admin/member roles. Firestore security rules enforce ownership."}
              {screen === "paywall" && "RevenueCat SDK for iOS/Android IAP. Stripe for web. LaunchDarkly for A/B testing pricing and trial length."}
              {screen === "edit-profile" && "Debounced username availability check. Image upload to Firebase Storage with CDN. Email change triggers re-auth."}
              {screen === "event-settings" && "Host-only actions enforced via Firestore security rules. Cancel event triggers push to all RSVPed members."}
              {screen === "messages" && "Unified inbox combining DMs + event group threads. Firestore fan-out for unread counts. Real-time badge on tab. Search via Algolia or Firestore full-text."}
              {screen === "dm-chat" && "1:1 messaging stored in /conversations/{userId}_{userId2}. Double-tap message to react. Quick reply suggestions from NLP. Push via FCM on new message. Link to shared events via banner."}
              {screen === "event-thread" && "Group thread scoped per event. Reply threads (top-level + replies). Pinned messages via host. Media tab shows all images sent. Read receipts for Pro users."}
              {screen === "event-comments" && "Comment model: { eventId, userId, text, timestamp, likes[], parentId? }. Threaded replies (1 level deep). Like = Firestore array union. Pinned topics are host-editable tags."}
              {screen === "checklist-detail" && "Multiple lists per event (Pro). Items: { text, done, assigneeId, dueDate, priority }. Progress bar computed client-side. Assignee filter updates in real-time. Priority colors drive visual hierarchy."}
              {screen === "pricing" && "Sticky column headers for scroll UX. Feature flags via LaunchDarkly control what free users see. CTA buttons deep link to RevenueCat paywall. Teams CTA sends lead to Intercom/sales."}
            </div>
          </div>

          {/* Unique features */}
          <div style={{ background: "#080810", border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 10, color: T.textDim, fontFamily: fontMono, marginBottom: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>✦ Unique Ideas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { icon: "🔥", text: "Squad Streaks — weekly hang counter builds habit & retention" },
                { icon: "✦", text: "AI Event Suggestions — learns from history, weather, trends" },
                { icon: "🎵", text: "Spotify Event Playlist — collaborative music for the event" },
                { icon: "📸", text: "Memory Vault — auto-albums from past events per squad" },
                { icon: "⚡", text: "No-Download RSVP — guests respond via web link, no app" },
                { icon: "🗳️", text: "Ranked Choice Polls — Pro feature for group decisions" },
                { icon: "🌦️", text: "Weather Integration — nudge when weekend looks perfect" },
                { icon: "🧾", text: "Event Recap — auto-generated summary sent to squad" },
              ].map(f => (
                <div key={f.text} style={{ display: "flex", gap: 8 }}>
                  <span style={{ flexShrink: 0 }}>{f.icon}</span>
                  <span style={{ fontSize: 12, color: T.textSub, lineHeight: 1.5 }}>{f.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick jump */}
          <div style={{ background: "#080810", border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
            <div style={{ fontSize: 10, color: T.textDim, fontFamily: fontMono, marginBottom: 12, letterSpacing: "0.08em", textTransform: "uppercase" }}>Quick Jump</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[["splash","Start"], ["home","Home"], ["messages","Messages"], ["dm-chat","DM"], ["event-thread","Thread"], ["event-comments","Comments"], ["checklist-detail","Checklist"], ["pricing","Pricing"], ["paywall","Pro"]].map(([k, l]) => (
                <div key={k} onClick={() => go(k)} style={{ padding: "5px 10px", borderRadius: 8, background: screen === k ? T.accent : T.surfaceHigh, fontSize: 11, color: screen === k ? "#fff" : T.textSub, cursor: "pointer", fontFamily: font, fontWeight: 600 }}>{l}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
