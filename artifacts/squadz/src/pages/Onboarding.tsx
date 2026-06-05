import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn, Input } from "@/components/shared";
import { T, font } from "@/lib/data";

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [interests, setInterests] = useState(new Set<string>());
  const [squadName, setSquadName] = useState("");
  const [squadEmoji, setSquadEmoji] = useState("🔥");

  const avatars = ["🐶", "🦊", "🐻", "🐼", "🦁", "🐯", "🦝", "🐸", "🐙", "🦋", "🌈", "⚡"];
  const interestList = ["🍕 Food & Dining", "🏖️ Outdoors", "🎮 Gaming", "🎬 Movies", "🎵 Music", "🏋️ Fitness", "🎨 Arts", "✈️ Travel", "🍺 Bars", "🎤 Live Events", "🧩 Board Games", "🍳 Cooking"];
  const emojis = ["🔥", "💼", "🎓", "🏡", "✈️", "🎮", "🍕", "🎉", "💪", "🌊", "🎵", "🦄"];

  const toggleInterest = (i: string) => {
    const s = new Set(interests);
    s.has(i) ? s.delete(i) : s.add(i);
    setInterests(s);
  };

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "28px 24px 40px", flex: 1, display: "flex", flexDirection: "column" }}>
          {step < 3 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 32 }}>
              {[0,1,2].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? T.accent : T.surfaceHigh, transition: "background 0.3s" }} />)}
            </div>
          )}

          {step === 0 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>What's your name?</div>
              <div style={{ fontSize: 14, color: T.textSub, marginBottom: 32, fontFamily: font }}>How your squad will see you</div>
              <Input placeholder="First name" icon="👤" value={name} onChange={setName} />
              <div style={{ marginTop: 12 }}><Input placeholder="Last name (optional)" /></div>
              <div style={{ marginTop: "auto", paddingTop: 32 }}>
                <Btn onPress={() => setStep(1)} style={{ opacity: name ? 1 : 0.5 }}>Next →</Btn>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>Pick your vibe</div>
              <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Choose an avatar or upload a photo</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                {avatars.map(a => (
                  <div key={a} onClick={() => setAvatar(a)} style={{ height: 70, borderRadius: 18, background: avatar === a ? T.accentDim : T.surfaceUp, border: `2px solid ${avatar === a ? T.accent : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, cursor: "pointer", transition: "all 0.15s" }}>{a}</div>
                ))}
              </div>
              <Btn variant="secondary" small>Upload a Photo</Btn>
              <div style={{ marginTop: "auto", paddingTop: 24 }}>
                <Btn onPress={() => setStep(2)}>Next →</Btn>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 28, fontWeight: 700, color: T.white, marginBottom: 4 }}>What do you love?</div>
              <div style={{ fontSize: 14, color: T.textSub, marginBottom: 24, fontFamily: font }}>Helps us suggest the perfect events (pick 3+)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
                {interestList.map(i => (
                  <div key={i} onClick={() => toggleInterest(i)} style={{ padding: "9px 16px", borderRadius: 20, border: `1.5px solid ${interests.has(i) ? T.accent : T.border}`, background: interests.has(i) ? T.accentDim : T.surfaceUp, fontSize: 13, color: interests.has(i) ? T.accent : T.textSub, fontFamily: font, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>{i}</div>
                ))}
              </div>
              <div style={{ paddingTop: 24 }}>
                <Btn onPress={() => setStep(3)} style={{ opacity: interests.size >= 3 ? 1 : 0.5 }}>Let's Go!</Btn>
                <div style={{ textAlign: "center", marginTop: 12 }}><span onClick={() => setStep(3)} style={{ fontSize: 13, color: T.textDim, cursor: "pointer", fontFamily: font }}>Skip for now</span></div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4 }}>Create Your First Squad</div>
              <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Name your crew and pick an emoji</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 20 }}>
                {emojis.map(e => (
                  <div key={e} onClick={() => setSquadEmoji(e)} style={{ height: 50, borderRadius: 14, background: squadEmoji === e ? T.accentDim : T.surfaceUp, border: `2px solid ${squadEmoji === e ? T.accent : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer" }}>{e}</div>
                ))}
              </div>
              <Input placeholder="Squad name (e.g. The Usual Suspects)" icon={squadEmoji} value={squadName} onChange={setSquadName} />
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>Use case</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {["Friend Group", "Coworkers", "Family", "Sports Team", "Roommates", "College Friends"].map(u => (
                    <div key={u} style={{ padding: "7px 14px", borderRadius: 20, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, fontFamily: font, cursor: "pointer" }}>{u}</div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
                <Btn onPress={() => setLocation("/home")}>Create Squad & Invite Friends →</Btn>
                <Btn variant="ghost" onPress={() => setLocation("/home")}>I'll invite later</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </PhoneShell>
  );
}
