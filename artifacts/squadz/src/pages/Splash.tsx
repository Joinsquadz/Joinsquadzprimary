import { useLocation } from "wouter";
import { T, font } from "@/lib/data";
import { PhoneShell } from "@/components/PhoneShell";

const avatarFaces = [
  { letter: "M", color: T.accent }, { letter: "K", color: T.purple },
  { letter: "T", color: T.green }, { letter: "A", color: T.gold }, { letter: "R", color: T.blue },
];

const pills = [
  { icon: "🗓️", label: "Events", color: T.accent },
  { icon: "🍔", label: "Food Plans", color: T.gold },
  { icon: "💸", label: "Split Costs", color: T.green },
  { icon: "🗳️", label: "Polls", color: T.blue },
  { icon: "💬", label: "Group Chat", color: T.purple },
];

import { useState } from "react";

function PressBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary: boolean }) {
  const [p, setP] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onMouseLeave={() => setP(false)}
      style={{
        width: "100%", borderRadius: 15, border: primary ? "none" : `1.5px solid ${T.border}`,
        background: primary ? `linear-gradient(135deg, ${T.accent} 0%, #FF8050 100%)` : "transparent",
        color: primary ? "#fff" : T.textSub,
        fontFamily: font, fontWeight: 800, fontSize: 15,
        padding: "14px 20px", cursor: "pointer",
        boxShadow: primary ? `0 8px 28px ${T.accent}45` : "none",
        transform: p ? "scale(0.97)" : "scale(1)",
        transition: "transform 0.12s",
      }}
    >{children}</button>
  );
}

export default function Splash() {
  const [, setLocation] = useLocation();

  return (
    <PhoneShell>
      <style>{`
        @keyframes splashFadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .splash-a1 { animation: splashFadeUp 0.55s cubic-bezier(0.34,1.4,0.64,1) 0.06s both; }
        .splash-a2 { animation: splashFadeUp 0.55s cubic-bezier(0.34,1.4,0.64,1) 0.22s both; }
        .splash-a3 { animation: splashFadeUp 0.55s cubic-bezier(0.34,1.4,0.64,1) 0.38s both; }
        .splash-a4 { animation: splashFadeUp 0.55s cubic-bezier(0.34,1.4,0.64,1) 0.52s both; }
      `}</style>
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        background: T.bg, position: "relative", overflow: "hidden",
        padding: "20px 24px 24px",
      }}>
        {/* Ambient glows */}
        <div style={{ position: "absolute", top: -60, right: -40, width: 260, height: 260, borderRadius: "50%", background: T.accent, opacity: 0.13, filter: "blur(65px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 140, left: -70, width: 200, height: 200, borderRadius: "50%", background: T.purple, opacity: 0.09, filter: "blur(55px)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 120, right: 0, width: 160, height: 160, borderRadius: "50%", background: T.gold, opacity: 0.08, filter: "blur(50px)", pointerEvents: "none" }} />

        {/* Logo */}
        <div className="splash-a1" style={{ textAlign: "center", marginBottom: 18, paddingTop: 30 }}>
          <div style={{
            width: 88, height: 88, borderRadius: 28,
            background: `linear-gradient(145deg, ${T.accent} 0%, #FF8040 65%, ${T.gold} 100%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 18px",
            boxShadow: `0 0 0 1px rgba(255,255,255,0.10) inset, 0 20px 60px ${T.accent}55`,
          }}>
            <span style={{ fontSize: 44 }}>⚡</span>
          </div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 48, fontWeight: 700, color: T.white, letterSpacing: "-0.05em", lineHeight: 0.95 }}>squadz</div>
          <div style={{ fontSize: 15, color: T.textSub, marginTop: 9, fontFamily: font }}>Stop texting. Start actually hanging.</div>
        </div>

        {/* Social proof */}
        <div className="splash-a2" style={{ display: "flex", alignItems: "center", gap: 10, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 28, padding: "8px 16px", marginBottom: 16, alignSelf: "center" }}>
          <div style={{ display: "flex" }}>
            {avatarFaces.map((a, i) => (
              <div key={a.letter} style={{ width: 26, height: 26, borderRadius: 13, background: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#000", marginLeft: i > 0 ? -8 : 0, border: `2px solid ${T.surfaceUp}` }}>{a.letter}</div>
            ))}
          </div>
          <span style={{ fontSize: 13, color: T.textSub, fontFamily: font, whiteSpace: "nowrap" }}>
            <span style={{ color: T.white, fontWeight: 700 }}>50k+ squads</span> planning smarter
          </span>
        </div>

        {/* Feature pills */}
        <div className="splash-a2" style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginBottom: 28 }}>
          {pills.map(p => (
            <div key={p.label} style={{ background: p.color + "15", border: `1px solid ${p.color}35`, borderRadius: 20, padding: "6px 13px", fontSize: 12, color: p.color, fontFamily: font, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <span>{p.icon}</span>{p.label}
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className="splash-a3" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PressBtn onClick={() => setLocation("/signup")} primary>
            Get Started — It&apos;s Free ✨
          </PressBtn>
          <PressBtn onClick={() => setLocation("/login")} primary={false}>
            I already have an account
          </PressBtn>
        </div>
        <div className="splash-a4" style={{ textAlign: "center", fontSize: 11, color: T.textDim, fontFamily: font, marginTop: 10 }}>
          Free forever · No credit card needed
        </div>
      </div>
    </PhoneShell>
  );
}
