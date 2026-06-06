import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { T, font, fontMono } from "@/lib/data";
import { inviteStore } from "@/lib/inviteStore";

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          height: 4, borderRadius: 2, transition: "all 0.3s ease",
          background: i === current ? T.accent : i < current ? T.accent + "70" : T.surfaceHigh,
          width: i === current ? 24 : 14,
        }} />
      ))}
    </div>
  );
}

function PrimaryBtn({ children, onPress, disabled = false }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  const [p, setP] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onPress}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onMouseLeave={() => setP(false)}
      style={{
        width: "100%", borderRadius: 15, border: "none",
        background: disabled ? T.surfaceHigh : `linear-gradient(135deg, ${T.accent}, #FF8050)`,
        color: disabled ? T.textDim : "#fff",
        fontFamily: font, fontWeight: 800, fontSize: 15,
        padding: "14px 20px", cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : `0 8px 26px ${T.accent}44`,
        transform: p && !disabled ? "scale(0.97)" : "scale(1)",
        transition: "all 0.12s",
      }}
    >{children}</button>
  );
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [interests, setInterests] = useState(new Set<string>());
  const [squadName, setSquadName] = useState("");
  const [squadEmoji, setSquadEmoji] = useState("🔥");
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);

  const TOTAL_STEPS = 5;

  const goTo = (n: number) => {
    setVisible(false);
    setTimeout(() => { setStep(n); setTimeout(() => setVisible(true), 50); }, 200);
  };
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);

  const anim: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(18px)",
    transition: "all 0.5s cubic-bezier(0.34, 1.4, 0.64, 1)",
  };

  const avatars = ["🐶", "🦊", "🐻", "🐼", "🦁", "🐯", "🦝", "🐸", "🐙", "🦋", "🌈", "⚡"];
  const interestList = [
    { icon: "🍕", label: "Food" }, { icon: "🏖️", label: "Outdoors" }, { icon: "🎮", label: "Gaming" },
    { icon: "🎬", label: "Movies" }, { icon: "🎵", label: "Music" }, { icon: "🏋️", label: "Fitness" },
    { icon: "🎨", label: "Arts" }, { icon: "✈️", label: "Travel" }, { icon: "🍺", label: "Bars" },
    { icon: "🎤", label: "Live Events" }, { icon: "🧩", label: "Board Games" }, { icon: "🍳", label: "Cooking" },
  ];
  const emojis = ["🔥", "💼", "🎓", "🏡", "✈️", "🎮", "🍕", "🎉", "💪", "🌊", "🎵", "🦄"];
  const glowColors = [T.accent, T.purple, T.gold, T.green, T.blue];

  const stepIcons = ["👋", avatar || "😊", "✨", squadEmoji, "⚡"];
  const stepTitles = ["What should we call you?", "Pick your vibe", "What do you love?", "Name your squad", "Choose your plan"];
  const stepDescs = [
    "How your squad will see you",
    "Express yourself with an avatar",
    "Helps us suggest the best events (pick 3+)",
    "Create your first group to start planning",
    "You can upgrade or downgrade anytime",
  ];

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -60, right: -40, width: 240, height: 240, borderRadius: "50%", background: glowColors[step], opacity: 0.13, filter: "blur(65px)", pointerEvents: "none", transition: "background 0.6s" }} />
        <div style={{ position: "absolute", bottom: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: step % 2 === 0 ? T.purple : T.blue, opacity: 0.08, filter: "blur(55px)", pointerEvents: "none" }} />

        <div style={{ padding: "16px 22px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button onClick={() => step > 0 ? goTo(step - 1) : setLocation("/signup")} style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 10, padding: "7px 12px", color: T.textSub, fontSize: 16, cursor: "pointer", fontFamily: font }}>←</button>
            <StepDots total={TOTAL_STEPS} current={step} />
            <div style={{ marginLeft: "auto", fontSize: 12, color: T.textDim, fontFamily: font, fontWeight: 700 }}>{step + 1} of {TOTAL_STEPS}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 22px" }}>
          <div style={anim}>
            <div style={{
              width: 64, height: 64, borderRadius: 20,
              background: glowColors[step] + "22", border: `1px solid ${glowColors[step]}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 30, marginBottom: 14,
              boxShadow: `0 6px 28px ${glowColors[step]}28`,
              transition: "background 0.4s",
            }}>
              {stepIcons[step]}
            </div>

            <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4, lineHeight: 1.2 }}>
              {stepTitles[step]}
            </div>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>
              {stepDescs[step]}
            </div>

            {/* Step 0 — Name */}
            {step === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input type="text" placeholder="First name" value={name} onChange={e => setName(e.target.value)}
                  style={{ width: "100%", background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 16px", color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box" as const }} />
                <input type="text" placeholder="Last name (optional)"
                  style={{ width: "100%", background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 16px", color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box" as const }} />
                <div style={{ background: T.surfaceUp, borderRadius: 13, padding: "12px 14px", border: `1px solid ${T.border}`, display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 20 }}>📷</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: font }}>Upload a photo</div>
                    <div style={{ fontSize: 11, color: T.textDim }}>Optional · JPG, PNG</div>
                  </div>
                  <div style={{ padding: "5px 12px", background: T.surfaceHigh, borderRadius: 8, fontSize: 12, color: T.textSub, fontFamily: font, cursor: "pointer" }}>Choose</div>
                </div>
              </div>
            )}

            {/* Step 1 — Avatar */}
            {step === 1 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {avatars.map(a => (
                  <div key={a} onClick={() => setAvatar(a)} style={{ height: 66, borderRadius: 18, background: avatar === a ? T.purple + "25" : T.surfaceUp, border: `2px solid ${avatar === a ? T.purple : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, cursor: "pointer", transition: "all 0.15s", boxShadow: avatar === a ? `0 4px 20px ${T.purple}30` : "none" }}>{a}</div>
                ))}
              </div>
            )}

            {/* Step 2 — Interests */}
            {step === 2 && (
              <div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {interestList.map(i => {
                    const on = interests.has(i.label);
                    return (
                      <div key={i.label} onClick={() => {
                        const s = new Set(interests);
                        s.has(i.label) ? s.delete(i.label) : s.add(i.label);
                        setInterests(s);
                      }} style={{ padding: "8px 14px", borderRadius: 22, border: `1.5px solid ${on ? T.gold : T.border}`, background: on ? T.gold + "18" : T.surfaceUp, fontSize: 13, color: on ? T.gold : T.textSub, fontFamily: font, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 5 }}>
                        <span>{i.icon}</span>{i.label}
                      </div>
                    );
                  })}
                </div>
                {interests.size > 0 && interests.size < 3 && (
                  <div style={{ fontSize: 12, color: T.gold, fontFamily: font }}>{3 - interests.size} more to go!</div>
                )}
                {interests.size >= 3 && (
                  <div style={{ fontSize: 12, color: T.green, fontFamily: font }}>Nice picks! You're all set.</div>
                )}
              </div>
            )}

            {/* Step 3 — Squad */}
            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                  {emojis.map(e => (
                    <div key={e} onClick={() => setSquadEmoji(e)} style={{ height: 46, borderRadius: 13, background: squadEmoji === e ? T.green + "22" : T.surfaceUp, border: `2px solid ${squadEmoji === e ? T.green : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, cursor: "pointer", transition: "all 0.15s" }}>{e}</div>
                  ))}
                </div>
                <input type="text" placeholder="Squad name, e.g. The Usual Suspects" value={squadName} onChange={e => setSquadName(e.target.value)}
                  style={{ width: "100%", background: T.surfaceUp, border: `1.5px solid ${T.border}`, borderRadius: 13, padding: "13px 16px", color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box" as const }} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {["Friend Group", "Coworkers", "Family", "College", "Roommates", "Sports"].map(u => (
                    <div key={u} onClick={() => setSquadName(u + " Squad")} style={{ padding: "6px 12px", borderRadius: 20, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, fontFamily: font, cursor: "pointer", background: T.surfaceUp }}>{u}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 4 — Plan Selection */}
            {step === 4 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Free plan */}
                <div
                  onClick={() => setPlan("free")}
                  style={{
                    background: plan === "free" ? T.surfaceUp : T.surface,
                    border: `2px solid ${plan === "free" ? T.accent : T.border}`,
                    borderRadius: 18, padding: "18px 20px", cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: font, fontWeight: 800, fontSize: 16, color: T.white }}>Free</div>
                    <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 18, color: T.textSub }}>$0</div>
                  </div>
                  {["Up to 3 events per year", "30-day photo storage", "Basic squad features", "In-app messaging"].map(f => (
                    <div key={f} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
                      <span style={{ color: T.textDim, fontSize: 12 }}>·</span>
                      <span style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>{f}</span>
                    </div>
                  ))}
                  {plan === "free" && (
                    <div style={{ marginTop: 10, fontSize: 12, color: T.accent, fontFamily: font, fontWeight: 700 }}>✓ Selected</div>
                  )}
                </div>

                {/* Pro plan */}
                <div
                  onClick={() => setPlan("pro")}
                  style={{
                    background: plan === "pro" ? `linear-gradient(135deg, ${T.accent}22, ${T.gold}16)` : T.surface,
                    border: `2px solid ${plan === "pro" ? T.accent : T.border}`,
                    borderRadius: 18, padding: "18px 20px", cursor: "pointer",
                    position: "relative", overflow: "hidden", transition: "all 0.15s",
                  }}
                >
                  <div style={{ position: "absolute", top: 14, right: 14, background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`, borderRadius: 20, padding: "3px 10px", fontSize: 10, color: "#fff", fontFamily: font, fontWeight: 800, letterSpacing: "0.05em" }}>BEST VALUE</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: font, fontWeight: 800, fontSize: 16, color: T.white }}>Pro ⚡</div>
                    <div>
                      <span style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 18, color: T.white }}>$20</span>
                      <span style={{ fontSize: 12, color: T.textSub, fontFamily: font }}>/year</span>
                    </div>
                  </div>
                  {["Unlimited events per year", "Permanent photo vault", "Calendar sync & AI scheduling", "Custom invite codes", "Priority support"].map(f => (
                    <div key={f} style={{ display: "flex", gap: 8, marginBottom: 5 }}>
                      <span style={{ color: T.green, fontWeight: 700, fontSize: 12 }}>✓</span>
                      <span style={{ fontSize: 13, color: T.text, fontFamily: font }}>{f}</span>
                    </div>
                  ))}
                  {plan === "pro" && (
                    <div style={{ marginTop: 10, fontSize: 12, color: T.accent, fontFamily: font, fontWeight: 700 }}>✓ Selected</div>
                  )}
                </div>

                <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, textAlign: "center" }}>
                  No credit card required for free plan · Cancel Pro anytime
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "14px 22px 28px", flexShrink: 0, borderTop: `1px solid ${T.border + "80"}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {step < 3 ? (
            <PrimaryBtn
              disabled={step === 0 ? !name.trim() : step === 2 ? interests.size < 3 : false}
              onPress={() => goTo(step + 1)}
            >
              {step === 0 ? (name ? `Nice to meet you, ${name}! →` : "Enter your name to continue") :
               step === 1 ? "Looking good! Next →" :
               "Perfect picks! Next →"}
            </PrimaryBtn>
          ) : step === 3 ? (
            <>
              <PrimaryBtn disabled={!squadName.trim()} onPress={() => goTo(4)}>
                {squadName.trim() ? "Next: Choose Your Plan →" : "Name your squad first"}
              </PrimaryBtn>
              <button onClick={() => goTo(4)} style={{ background: "none", border: "none", color: T.textDim, fontFamily: font, fontSize: 13, cursor: "pointer", padding: "4px" }}>
                Skip squad for now
              </button>
            </>
          ) : (
            <>
              <PrimaryBtn disabled={!plan} onPress={() => { const dest = inviteStore.get()?.dest; inviteStore.clear(); setLocation(dest ?? "/home"); }}>
                {plan === "pro" ? "Start Pro — $20/year →" : plan === "free" ? "Start Free →" : "Choose a plan to continue"}
              </PrimaryBtn>
              {plan === "pro" && (
                <div style={{ fontSize: 11, color: T.textDim, fontFamily: font, textAlign: "center" }}>
                  You'll be asked for payment on the next screen
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PhoneShell>
  );
}
