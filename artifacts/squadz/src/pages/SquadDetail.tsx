import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar, Tag, SectionLabel, Btn } from "@/components/shared";
import { T, font, fontMono, MEMBERS } from "@/lib/data";

export default function SquadDetail() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("events");
  const events = [
    { title: "Rooftop BBQ", date: "Sat Jun 7", emoji: "🔥", going: 5 },
    { title: "Game Night", date: "Sat Jun 14", emoji: "🎮", going: 4 },
  ];
  const past = [
    { title: "Escape Room", date: "May 18", emoji: "🔐" },
    { title: "Brunch Run", date: "May 4", emoji: "🍳" },
    { title: "Bowling Night", date: "Apr 20", emoji: "🎳" },
  ];
  const polls = [
    { q: "Next hangout vibe?", opts: ["Game Night", "Day Trip", "Dinner Out"], total: 6 },
    { q: "Best day to meet?", opts: ["Friday", "Saturday", "Sunday"], total: 7 },
  ];

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: `linear-gradient(160deg, ${T.accent}, #C83E22)`, padding: "16px 20px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <button onClick={() => setLocation("/home")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>←</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setLocation("/squad-settings")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>⚙️</button>
          </div>
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🔥</div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: "#fff" }}>The Usual Suspects</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>7 members · 12-week streak</div>
            <div style={{ display: "flex", justifyContent: "center", gap: -8, marginTop: 12 }}>
              {MEMBERS.slice(0, 5).map((m, i) => (
                <div key={m.name} style={{ width: 30, height: 30, borderRadius: 15, background: T.accentDim, border: `2px solid ${T.accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#000", marginLeft: i > 0 ? -8 : 0 }}>{m.name[0]}</div>
              ))}
              <div style={{ marginLeft: 8, fontSize: 12, color: "rgba(255,255,255,0.8)", alignSelf: "center" }}>+2</div>
            </div>
          </div>
          <div style={{ display: "flex" }}>
            {["events", "members", "polls", "settings"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ flex: 1, background: "none", border: "none", padding: "10px 0", cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 12, color: tab === t ? "#fff" : "rgba(255,255,255,0.6)", borderBottom: `2px solid ${tab === t ? "#fff" : "transparent"}`, textTransform: "capitalize" }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "16px 20px 24px" }}>
            {tab === "events" && (
              <>
                <SectionLabel>Upcoming</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                  {events.map(e => (
                    <div key={e.title} onClick={() => setLocation("/event")} style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, padding: 16, cursor: "pointer", display: "flex", gap: 14, alignItems: "center" }}>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: T.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{e.emoji}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{e.title}</div>
                        <div style={{ fontSize: 12, color: T.textSub }}>{e.date}</div>
                      </div>
                      <Tag color={T.green}>{e.going} going</Tag>
                    </div>
                  ))}
                </div>
                <Btn variant="ghost" onPress={() => setLocation("/create-event")}>+ Plan an Event</Btn>
                <div style={{ marginTop: 20 }}><SectionLabel>Past Events</SectionLabel></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {past.map(e => (
                    <div key={e.title} style={{ background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ fontSize: 22 }}>{e.emoji}</div>
                      <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: T.textSub }}>{e.title}</div>
                      <div style={{ fontSize: 11, color: T.textDim }}>{e.date}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {tab === "members" && (
              <>
                <SectionLabel>7 Members</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {MEMBERS.map(m => (
                    <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
                      <Avatar name={m.name} size={44} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: T.textDim }}>{m.role}</div>
                      </div>
                      <span style={{ color: T.textDim, fontSize: 16 }}>›</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}><Btn variant="ghost" onPress={() => {}}>+ Invite Members</Btn></div>
              </>
            )}
            {tab === "polls" && (
              <>
                {polls.map((p, i) => (
                  <div key={i} style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, padding: 16, marginBottom: 12 }}>
                    <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 12 }}>{p.q}</div>
                    {p.opts.map((opt, oi) => {
                      const pct = Math.round(((oi + 1) / p.total) * 100);
                      return (
                        <div key={oi} style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.text, fontFamily: font, marginBottom: 4 }}>
                            <span>{opt}</span><span style={{ color: T.textDim }}>{pct}%</span>
                          </div>
                          <div style={{ background: T.surfaceHigh, borderRadius: 4, height: 6 }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: T.accent, borderRadius: 4 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <Btn variant="secondary" onPress={() => {}}>+ Create Poll</Btn>
              </>
            )}
            {tab === "settings" && (
              <>
                <SectionLabel>Squad Settings</SectionLabel>
                {[
                  { icon: "✏️", label: "Edit Squad Name" },
                  { icon: "🔒", label: "Privacy: Invite Only" },
                  { icon: "🔔", label: "Notifications" },
                  { icon: "🔗", label: "Invite Link" },
                ].map((item, i) => (
                  <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: `1px solid ${T.border}` }}>
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                    <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.text }}>{item.label}</div>
                    <span style={{ color: T.textDim }}>›</span>
                  </div>
                ))}
                <div style={{ marginTop: 24 }}><Btn variant="danger" onPress={() => {}}>Leave Squad</Btn></div>
              </>
            )}
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
