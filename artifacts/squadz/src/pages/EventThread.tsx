import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar } from "@/components/shared";
import { T, font, getAvatarColor } from "@/lib/data";

export default function EventThread() {
  const [, setLocation] = useLocation();
  const [msg, setMsg] = useState("");
  const [pinned, setPinned] = useState(true);
  const threads = [
    { id: 1, who: "Marcus", text: "Location confirmed — 142 Oak St, rooftop access via elevator", time: "10:00 AM", me: false, replies: 4, pinned: true, replyPreview: "Jordan: Got it! · Kira: nice" },
    { id: 2, who: "Jordan", text: "Poll closed — we're starting at 5 PM!", time: "11:30 AM", me: true, replies: 2, pinned: false, replyPreview: "Marcus: Perfect · Tasha: 👍" },
    { id: 3, who: "Kira", text: "I claimed veggie skewers on the food list! Anyone else still need to claim?", time: "1:15 PM", me: false, replies: 1, pinned: false, replyPreview: "Alex: I got chips" },
    { id: 4, who: "Tasha", text: "Anyone need a ride from the Eastside? I have room for 2", time: "2:00 PM", me: false, replies: 0, pinned: false },
    { id: 5, who: "Marcus", text: "Rooftop is ready! Lights are up, coolers are stocked", time: "4:45 PM", me: false, replies: 3, pinned: false, replyPreview: "+3 reactions" },
  ];

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px 0", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <button onClick={() => setLocation("/home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
            <div style={{ width: 38, height: 38, borderRadius: 13, background: T.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔥</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: font, fontWeight: 800, fontSize: 15, color: T.white }}>Rooftop BBQ</div>
              <div style={{ fontSize: 11, color: T.textSub }}>The Usual Suspects · 7 members</div>
            </div>
            <button onClick={() => setLocation("/event")} style={{ background: T.accentDim, border: `1px solid ${T.accent}40`, borderRadius: 8, padding: "4px 10px", fontSize: 11, color: T.accent, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Event →</button>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            {["Thread", "Members", "Media", "Links"].map((t, i) => (
              <button key={t} style={{ flex: 1, background: "none", border: "none", padding: "7px 0", cursor: "pointer", fontFamily: font, fontWeight: i === 0 ? 700 : 500, fontSize: 12, color: i === 0 ? T.accent : T.textDim, borderBottom: `2px solid ${i === 0 ? T.accent : "transparent"}` }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
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
                  <div style={{ background: T.surfaceUp, borderRadius: "4px 16px 16px 16px", padding: "10px 13px", fontSize: 14, color: T.text, fontFamily: font, lineHeight: 1.5, border: `1px solid ${T.border}` }}>{m.text}</div>
                  {m.replies > 0 && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                      <div style={{ display: "flex" }}>
                        {["M", "J", "K"].slice(0, Math.min(m.replies, 3)).map((l, li) => (
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
        </div>

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
    </PhoneShell>
  );
}
