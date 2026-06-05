import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { T } from "@/lib/data";
import { PhoneShell } from "@/components/PhoneShell";

export default function Splash() {
  const [visible, setVisible] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);

  return (
    <PhoneShell>
      <div className="flex-1 bg-squadz-bg flex flex-col items-center justify-center p-8 gap-0 relative overflow-hidden">
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
          <div style={{ fontSize: 16, color: T.textSub, marginTop: 8, letterSpacing: "0.02em" }}>Stop texting. Start planning.</div>
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", margin: "28px 0 48px", opacity: visible ? 1 : 0, transition: "opacity 0.7s 0.3s" }}>
          {["🗓️ Events", "🍔 Food Plans", "💸 Split Costs", "🗳️ Polls", "📅 Schedules"].map(pill => (
            <div key={pill} style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 20, padding: "6px 14px", fontSize: 13, color: T.textSub }}>
              {pill}
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, opacity: visible ? 1 : 0, transition: "opacity 0.7s 0.5s" }}>
          <button onClick={() => setLocation('/home')} className="w-full rounded-2xl bg-squadz-accent text-white font-bold py-3.5 hover:scale-95 transition-transform">
            Get Started — It's Free
          </button>
          <button onClick={() => setLocation('/home')} className="w-full rounded-2xl bg-squadz-surfaceUp border border-squadz-border text-squadz-text font-bold py-3.5 hover:scale-95 transition-transform">
            I Already Have an Account
          </button>
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: T.textDim, textAlign: "center", opacity: visible ? 1 : 0, transition: "opacity 0.7s 0.7s" }}>
          50,000+ squads planning smarter 🎉
        </div>
      </div>
    </PhoneShell>
  );
}