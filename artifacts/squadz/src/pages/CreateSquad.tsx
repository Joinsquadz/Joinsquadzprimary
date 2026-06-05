import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn, Input, Avatar } from "@/components/shared";
import { T, font } from "@/lib/data";

export default function CreateSquad() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔥");
  const [search, setSearch] = useState("");
  const [invited, setInvited] = useState(new Set<string>());
  const emojis = ["🔥", "💼", "🎓", "🏡", "✈️", "🎮", "🍕", "🎉", "💪", "🌊", "🎵", "🦄"];
  const contacts = ["Alex Chen", "Tasha Williams", "Marcus Lee", "Kira Patel", "Rico Santos", "Priya Kumar", "Sam Johnson"];

  if (step === 1) {
    const filtered = contacts.filter(c => c.toLowerCase().includes(search.toLowerCase()));
    const toggle = (c: string) => { const s = new Set(invited); s.has(c) ? s.delete(c) : s.add(c); setInvited(s); };
    return (
      <PhoneShell>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px 16px" }}>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Invite Your Squad</div>
            <div style={{ fontSize: 14, color: T.textSub, marginBottom: 16, fontFamily: font }}>Add friends to "{name || "New Squad"}"</div>
            <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 20 }}>🔗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: T.textDim, fontFamily: font }}>Squad invite link</div>
                <div style={{ fontSize: 13, color: T.textSub, fontFamily: "'DM Mono', monospace" }}>getsquadz.com/join/abc123</div>
              </div>
              <div style={{ background: T.accentDim, borderRadius: 8, padding: "5px 10px", fontSize: 12, color: T.accent, fontWeight: 700, cursor: "pointer" }}>Copy</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[["💬 iMessage", T.green], ["📱 SMS", T.blue], ["📸 Instagram", T.pink]].map(([l, c]) => (
                <div key={l} style={{ flex: 1, background: c + "18", border: `1px solid ${c}40`, borderRadius: 10, padding: "8px 4px", textAlign: "center", fontSize: 10, color: c, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{l}</div>
              ))}
            </div>
            <Input placeholder="Search contacts…" icon="🔍" value={search} onChange={setSearch} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
            {filtered.map(c => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
                <Avatar name={c} size={40} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: font, fontWeight: 600, color: T.text, fontSize: 15 }}>{c}</div>
                  <div style={{ fontSize: 12, color: T.textDim }}>On Squadz</div>
                </div>
                <div onClick={() => toggle(c)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: font, background: invited.has(c) ? T.accentDim : T.surfaceHigh, border: `1px solid ${invited.has(c) ? T.accent : T.border}`, color: invited.has(c) ? T.accent : T.textSub }}>{invited.has(c) ? "✓ Added" : "+ Add"}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "16px 24px 32px", flexShrink: 0 }}>
            <Btn onPress={() => setLocation("/home")}>Done ({invited.size} invited) →</Btn>
          </div>
        </div>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "28px 24px 40px", overflowY: "auto" }}>
        <button onClick={() => setLocation("/home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", marginBottom: 20, padding: 0 }}>←</button>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white, marginBottom: 4 }}>Create a Squad</div>
        <div style={{ fontSize: 14, color: T.textSub, marginBottom: 28, fontFamily: font }}>Name your crew and pick an emoji</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 20 }}>
          {emojis.map(e => (
            <div key={e} onClick={() => setEmoji(e)} style={{ height: 50, borderRadius: 14, background: emoji === e ? T.accentDim : T.surfaceUp, border: `2px solid ${emoji === e ? T.accent : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer" }}>{e}</div>
          ))}
        </div>
        <Input placeholder="Squad name (e.g. The Usual Suspects)" icon={emoji} value={name} onChange={setName} />
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>Type</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["Friend Group", "Coworkers", "Family", "Sports Team", "Roommates", "College Friends"].map(u => (
              <div key={u} style={{ padding: "7px 14px", borderRadius: 20, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, fontFamily: font, cursor: "pointer" }}>{u}</div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn onPress={() => setStep(1)} style={{ opacity: name ? 1 : 0.5 }}>Create Squad & Invite Friends →</Btn>
          <Btn variant="ghost" onPress={() => setLocation("/home")}>I'll invite later</Btn>
        </div>
      </div>
    </PhoneShell>
  );
}
