import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar } from "@/components/shared";
import { T, font } from "@/lib/data";

export default function DMChat() {
  const [, setLocation] = useLocation();
  const [msg, setMsg] = useState("");
  const [reacting, setReacting] = useState<number | null>(null);
  const [reactions, setReactions] = useState<Record<number, string[]>>({});
  const messages = [
    { id: 1, who: "Marcus", text: "yo are you bringing anything extra to the BBQ?", time: "2:14 PM", me: false },
    { id: 2, who: "Jordan", text: "Thinking maybe watermelon? Or should I grab more drinks", time: "2:15 PM", me: true },
    { id: 3, who: "Marcus", text: "watermelon would be fire, drinks we're covered", time: "2:16 PM", me: false },
    { id: 4, who: "Jordan", text: "Perfect I'll grab a big one. See you at 5!", time: "2:17 PM", me: true },
    { id: 5, who: "Marcus", text: "rooftop is ready, got lights strung up and everything", time: "2:45 PM", me: false },
  ];
  const emojiReacts = ["❤️", "😂", "🔥", "👍", "😮", "🎉"];
  const addReaction = (msgId: number, emoji: string) => {
    setReactions(r => ({ ...r, [msgId]: [...(r[msgId] || []), emoji] }));
    setReacting(null);
  };

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setLocation("/home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
          <div style={{ position: "relative" }}>
            <Avatar name="Marcus" size={40} />
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, background: T.green, border: `2px solid ${T.bg}` }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 800, fontSize: 16, color: T.white }}>Marcus</div>
            <div style={{ fontSize: 12, color: T.green }}>Active now</div>
          </div>
          <button style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>📞</button>
          <button style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>📹</button>
        </div>

        <div onClick={() => setLocation("/event")} style={{ margin: "10px 16px 0", background: T.gold + "18", border: `1px solid ${T.gold}40`, borderRadius: 12, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexShrink: 0 }}>
          <span style={{ fontSize: 18 }}>🔥</span>
          <div style={{ flex: 1, fontSize: 12, color: T.textSub }}><span style={{ color: T.gold, fontWeight: 700 }}>Rooftop BBQ</span> · Sat Jun 7 · you're both going</div>
          <span style={{ fontSize: 14, color: T.textDim }}>›</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {messages.map((m, i) => {
              const showAvatar = !m.me && (i === 0 || messages[i - 1].me);
              const msgReacts = reactions[m.id] || [];
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start", marginBottom: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexDirection: m.me ? "row-reverse" : "row" }}>
                    {!m.me && <div style={{ width: 28 }}>{showAvatar ? <Avatar name={m.who} size={28} /> : null}</div>}
                    <div onDoubleClick={() => setReacting(reacting === m.id ? null : m.id)} style={{ maxWidth: "72%", cursor: "pointer" }}>
                      <div style={{ background: m.me ? T.accent : T.surfaceUp, borderRadius: m.me ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "10px 14px", fontSize: 14, color: m.me ? "#fff" : T.text, fontFamily: font, lineHeight: 1.5 }}>{m.text}</div>
                      {msgReacts.length > 0 && (
                        <div style={{ display: "flex", gap: 3, marginTop: 3, justifyContent: m.me ? "flex-end" : "flex-start" }}>
                          {[...new Set(msgReacts)].map(e => (
                            <div key={e} style={{ background: T.surfaceHigh, borderRadius: 10, padding: "2px 6px", fontSize: 12 }}>{e} {msgReacts.filter(r => r === e).length}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: T.textDim, marginTop: 2, paddingLeft: m.me ? 0 : 36 }}>{m.time}</div>
                  {reacting === m.id && (
                    <div style={{ display: "flex", gap: 6, background: T.surfaceUp, borderRadius: 24, padding: "6px 10px", border: `1px solid ${T.border}`, marginTop: 4 }}>
                      {emojiReacts.map(e => <span key={e} onClick={() => addReaction(m.id, e)} style={{ fontSize: 22, cursor: "pointer" }}>{e}</span>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: "10px 14px 28px", background: T.surface, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <button style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: T.textSub }}>+</button>
            <div style={{ flex: 1, background: T.surfaceUp, borderRadius: 22, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "8px 14px", gap: 8 }}>
              <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Message Marcus…" style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
              <span style={{ fontSize: 18, cursor: "pointer" }}>😊</span>
            </div>
            <button style={{ width: 38, height: 38, borderRadius: 19, background: msg ? T.accent : T.surfaceHigh, border: "none", fontSize: 16, cursor: "pointer", color: msg ? "#fff" : T.textDim, transition: "all 0.2s" }}>↑</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto" }}>
            {["Sounds good!", "Can't wait!", "Running late", "On my way!"].map(q => (
              <div key={q} onClick={() => setMsg(q)} style={{ background: T.surfaceHigh, borderRadius: 16, padding: "5px 12px", fontSize: 12, color: T.textSub, fontFamily: font, whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 }}>{q}</div>
            ))}
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
