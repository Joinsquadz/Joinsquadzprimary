import React, { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar, Tag, SectionLabel, Card, SwitchToggle, Btn } from "@/components/shared";
import { T, font, fontMono, MEMBERS, ACTIVITY_FEED, SUGGESTIONS, MESSAGES, getAvatarColor } from "@/lib/data";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEvents, type ApiEvent } from "@/hooks/useEvents";
import { useSquads, type ApiSquad } from "@/hooks/useSquads";

function BottomTab({ active, setActive }: { active: string; setActive: (t: string) => void }) {
  const tabs = [
    { key: "home", icon: "⊞", label: "Home" },
    { key: "squads", icon: "👥", label: "SquadZ" },
    { key: "messages", icon: "💬", label: "Messages" },
    { key: "discover", icon: "✦", label: "Discover" },
    { key: "vault", icon: "📷", label: "Vault" },
    { key: "activity", icon: "◎", label: "Activity", badge: 4 },
    { key: "profile", icon: "◉", label: "You" },
  ];
  return (
    <div style={{ display: "flex", background: T.surface, borderTop: `1px solid ${T.border}`, padding: "8px 0 28px", flexShrink: 0 }}>
      {tabs.map(tab => (
        <button key={tab.key} onClick={() => setActive(tab.key)} style={{
          flex: 1, background: "none", border: "none", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          color: active === tab.key ? T.accent : T.textDim, transition: "color 0.15s",
        }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <div style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</div>
            {"badge" in tab && (tab as { badge: number }).badge > 0 && (
              <div style={{ position: "absolute", top: -4, right: -6, width: 15, height: 15, borderRadius: 8, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#fff", fontWeight: 900, fontFamily: font, border: `2px solid ${T.surface}` }}>
                {(tab as { badge: number }).badge}
              </div>
            )}
          </div>
          <div style={{ fontSize: 9, fontFamily: font, fontWeight: 600, letterSpacing: "0.03em" }}>{tab.label}</div>
        </button>
      ))}
    </div>
  );
}

function HomeTab({ go, onBellPress, firstName, squads, events }: { go: (s: string) => void; onBellPress: () => void; firstName?: string | null; squads: ApiSquad[]; events: ApiEvent[] }) {
  const [showBanner, setShowBanner] = useState(true);
  const nextEvent = events[0] ?? null;
  const goingCount = nextEvent ? Object.values(nextEvent.rsvps).filter(v => v === "going").length : 0;
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {showBanner && (
        <div style={{ background: `linear-gradient(135deg, ${T.purple}22, ${T.blue}18)`, borderBottom: `1px solid ${T.purple}30`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔔</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.text }}>Enable push reminders</div>
            <div style={{ fontSize: 11, color: T.textSub }}>Get notified before your events</div>
          </div>
          <button onClick={() => setShowBanner(false)} style={{ background: T.purple, border: "none", borderRadius: 8, padding: "5px 10px", color: "#fff", fontFamily: font, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>Allow</button>
          <button onClick={() => setShowBanner(false)} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
      )}
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white }}>{firstName ? `Hey, ${firstName} 👋` : "Hey there 👋"}</div>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>{squads.length} SquadZ · {events.length} event{events.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div onClick={onBellPress} style={{ position: "relative", cursor: "pointer", width: 38, height: 38, borderRadius: 13, background: T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 18 }}>🔔</span>
              <div style={{ position: "absolute", top: -3, right: -3, width: 15, height: 15, borderRadius: 8, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 900, fontFamily: font, border: `2px solid ${T.bg}` }}>4</div>
            </div>
            <div style={{ position: "relative", cursor: "pointer" }} onClick={() => go("profile")}>
              <Avatar name={firstName ?? "You"} size={44} color={T.accent} />
              <div style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, background: T.green, borderRadius: "50%", border: `2px solid ${T.bg}` }} />
            </div>
          </div>
        </div>

        {nextEvent ? (
          <div onClick={() => go("event")} style={{ background: `linear-gradient(135deg, ${T.accent}, #FF8C3A)`, borderRadius: 22, padding: 20, marginBottom: 20, cursor: "pointer", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -30, top: -30, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
            <Tag color="#fff">⚡ Up Next · {nextEvent.date}</Tag>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: "#fff", margin: "8px 0 4px" }}>{nextEvent.emoji} {nextEvent.title}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14 }}>{nextEvent.location}</div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ marginLeft: 0, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{goingCount} going</div>
            </div>
          </div>
        ) : (
          <div onClick={() => go("create-event")} style={{ background: T.surfaceUp, border: `1.5px dashed ${T.border}`, borderRadius: 22, padding: 20, marginBottom: 20, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 100 }}>
            <div style={{ fontSize: 32 }}>🗓</div>
            <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.textSub }}>No events yet</div>
            <div style={{ fontSize: 12, color: T.textDim }}>Tap to create your first event</div>
          </div>
        )}

        <div style={{ background: T.goldDim, border: `1px solid ${T.gold}40`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <span style={{ fontSize: 28 }}>🔥</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 700, color: T.gold, fontSize: 14 }}>12-week squad streak!</div>
            <div style={{ fontSize: 12, color: T.textSub }}>The Usual Suspects has hung out every week</div>
          </div>
          <Tag color={T.gold}>🏆</Tag>
        </div>

        <div style={{ marginBottom: 12 }}>
          <SectionLabel>My SquadZ</SectionLabel>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
          {squads.map(s => (
            <div key={s.id} onClick={() => go("squad")} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "12px 14px", minWidth: 130, cursor: "pointer", flexShrink: 0 }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{s.emoji}</div>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: T.textDim }}>{s.memberIds.length} members</div>
            </div>
          ))}
          <div onClick={() => go("create-squad")} style={{ background: T.surfaceUp, border: `1.5px dashed ${T.border}`, borderRadius: 16, padding: "12px 14px", minWidth: 100, cursor: "pointer", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <div style={{ fontSize: 24, color: T.textDim }}>+</div>
            <div style={{ fontSize: 11, color: T.textDim, fontFamily: font }}>New Squad</div>
          </div>
        </div>

        <SectionLabel>✦ AI Suggestions</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SUGGESTIONS.slice(0, 2).map(s => (
            <div key={s.title} onClick={() => go("create-event")} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{s.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{s.title}</div>
                <div style={{ fontSize: 12, color: T.textSub }}>{s.why}</div>
              </div>
              <Tag color={s.color}>{s.type}</Tag>
            </div>
          ))}
        </div>
      </div>

      <div onClick={() => go("create-event")} style={{ position: "fixed", bottom: 80, right: 24, width: 56, height: 56, background: T.accent, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, cursor: "pointer", boxShadow: `0 8px 30px ${T.accent}60`, zIndex: 100 }}>+</div>
    </div>
  );
}

function JoinWithLinkPanel() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const join = () => { if (code.trim()) setJoined(true); };
  if (joined) return (
    <div style={{ background: T.green + "18", border: `1px solid ${T.green}40`, borderRadius: 14, padding: "14px 16px", textAlign: "center", fontFamily: font }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>✅</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: T.green }}>Joined! Welcome to the squad.</div>
    </div>
  );
  return (
    <div>
      <Btn variant="secondary" onPress={() => setOpen(!open)}>Join with Invite Link</Btn>
      {open && (
        <div style={{ marginTop: 10, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: T.textSub, fontFamily: font, marginBottom: 8 }}>Paste your invite link or code:</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === "Enter" && join()} placeholder="getsquadz.com/join/…" style={{ flex: 1, background: T.surface, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "9px 12px", color: T.text, fontFamily: font, fontSize: 13, outline: "none" }} />
            <button onClick={join} style={{ background: T.accent, border: "none", borderRadius: 10, color: "#fff", padding: "9px 16px", fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Join</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SquadsTab({ go, squads }: { go: (s: string) => void; squads: ApiSquad[] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Your SquadZ</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>{squads.length} active group{squads.length !== 1 ? "s" : ""}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {squads.map(s => (
            <div key={s.id} onClick={() => go("squad")} style={{ background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`, padding: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 18, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, border: `1px solid ${s.color}40` }}>{s.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{s.name}</div>
                <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{s.memberIds.length} members</div>
              </div>
              <span style={{ color: T.textDim, fontSize: 20 }}>›</span>
            </div>
          ))}
          <Btn variant="ghost" onPress={() => go("create-squad")}>+ Create New Squad</Btn>
          <JoinWithLinkPanel />
        </div>
      </div>
    </div>
  );
}

function MessagesTab({ go }: { go: (s: string) => void }) {
  const [tab, setTab] = useState("all");
  const shown = tab === "dms" ? MESSAGES.filter(m => m.type === "dm") : tab === "events" ? MESSAGES.filter(m => m.type === "event") : MESSAGES;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 0", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 12 }}>Messages</div>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14 }}>🔍</span>
          <input placeholder="Search messages…" style={{ width: "100%", background: T.surfaceHigh, border: `1px solid ${T.border}`, borderRadius: 12, padding: "9px 12px 9px 36px", color: T.text, fontFamily: font, fontSize: 14, outline: "none", boxSizing: "border-box" as const }} />
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {[["all", "All"], ["dms", "Direct"], ["events", "Events"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: "none", border: "none", padding: "8px 0", cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 13, color: tab === k ? T.accent : T.textDim, borderBottom: `2px solid ${tab === k ? T.accent : "transparent"}` }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {shown.map((item, i) => (
          <div key={i} onClick={() => go(item.type === "dm" ? "dm-chat" : "event-thread")} style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 20px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: (item.unread ?? 0) > 0 ? T.accentGlow : "transparent" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              {item.type === "dm"
                ? <Avatar name={item.who ?? ""} size={48} />
                : <div style={{ width: 48, height: 48, borderRadius: 16, background: T.gold + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, border: `1px solid ${T.gold}40` }}>{item.emoji}</div>
              }
              {item.type === "dm" && item.online && <div style={{ position: "absolute", bottom: 1, right: 1, width: 13, height: 13, borderRadius: "50%", background: T.green, border: `2px solid ${T.bg}` }} />}
              {item.type === "event" && <div style={{ position: "absolute", bottom: -3, right: -3, width: 18, height: 18, borderRadius: "50%", background: T.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", fontWeight: 700, border: `2px solid ${T.bg}` }}>E</div>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <div style={{ fontFamily: font, fontWeight: (item.unread ?? 0) > 0 ? 800 : 600, fontSize: 15, color: T.text }}>{item.type === "dm" ? item.who : item.name}</div>
                <div style={{ fontSize: 11, color: T.textDim }}>{item.time}</div>
              </div>
              {item.type === "event" && <div style={{ fontSize: 11, color: T.textDim, marginBottom: 2 }}>{item.squad}</div>}
              <div style={{ fontSize: 13, color: (item.unread ?? 0) > 0 ? T.textSub : T.textDim, fontFamily: font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: (item.unread ?? 0) > 0 ? 600 : 400 }}>{item.preview}</div>
            </div>
            {(item.unread ?? 0) > 0 && <div style={{ width: 22, height: 22, borderRadius: 11, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{item.unread}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const PUBLIC_EVENTS = [
  { id: 1, emoji: "🎳", title: "Bowling Night", host: "Alex Chen", squad: "College Crew", date: "Sat Jun 14", going: 6, mutual: 3 },
  { id: 2, emoji: "🎬", title: "Movie Marathon", host: "Sam Rivera", squad: "Westside Fam", date: "Sun Jun 15", going: 4, mutual: 2 },
  { id: 3, emoji: "🏋️", title: "Morning Hike", host: "Priya Nair", squad: "Fitness Gang", date: "Sat Jun 21", going: 8, mutual: 5 },
  { id: 4, emoji: "🍕", title: "Pizza & Board Games", host: "Chris Lee", squad: "Work Crew", date: "Fri Jun 20", going: 5, mutual: 1 },
];

function DiscoverTab({ go }: { go: (s: string) => void }) {
  const [subTab, setSubTab] = useState("ideas");
  const [requested, setRequested] = useState<Set<number>>(new Set());

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

  const toggleRequest = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setRequested(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px 0", background: T.surface, flexShrink: 0 }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 10 }}>Discover</div>
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
          {[["ideas", "✦ Ideas"], ["events", "🗓 Events"]].map(([k, l]) => (
            <button key={k} onClick={() => setSubTab(k)} style={{ flex: 1, background: "none", border: "none", padding: "10px 0", cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 13, color: subTab === k ? T.accent : T.textDim, borderBottom: `2px solid ${subTab === k ? T.accent : "transparent"}`, marginBottom: -1 }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {subTab === "ideas" && (
          <div style={{ padding: "16px 20px 24px" }}>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 16, fontFamily: font }}>Pick a vibe and we'll help you plan it</div>
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
        )}
        {subTab === "events" && (
          <div style={{ padding: "16px 20px 24px" }}>
            <div style={{ fontSize: 13, color: T.textSub, marginBottom: 16, fontFamily: font }}>Events friends opened up — request to join</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {PUBLIC_EVENTS.map(e => (
                <div key={e.id} onClick={() => go("event")} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 18, padding: 16, cursor: "pointer" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: T.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{e.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>{e.title}</div>
                      <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{e.date} · by {e.host}</div>
                      <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{e.squad} · {e.going} going · {e.mutual} mutual friends</div>
                    </div>
                  </div>
                  <button onClick={ev => toggleRequest(ev, e.id)} style={{ width: "100%", padding: "9px 0", borderRadius: 12, border: `1.5px solid ${requested.has(e.id) ? T.green : T.accent}`, background: requested.has(e.id) ? T.green + "18" : T.accent + "18", color: requested.has(e.id) ? T.green : T.accent, fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    {requested.has(e.id) ? "✓ Requested" : "Request to Join"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const REMINDERS = [
  { id: 1, icon: "🔥", title: "Rooftop BBQ is tomorrow!", body: "Sat Jun 7 · 5:00 PM · Marcus's Place · RSVP now", time: "9:41 AM", color: T.accent, action: "RSVP" },
  { id: 2, icon: "📋", title: "2 tasks still open", body: "Get ice · Make a playlist — Rooftop BBQ", time: "2h ago", color: T.gold, action: "View" },
  { id: 3, icon: "🎮", title: "Game Night in 3 days", body: "Tue Jun 10 · 7:00 PM · The Usual Suspects", time: "Yesterday", color: T.purple, action: "View" },
  { id: 4, icon: "👋", title: "Alex Chen wants to join", body: "Bowling Night · requested to attend your event", time: "1h ago", color: T.blue, action: "Review" },
];

function ActivityTab() {
  const [subTab, setSubTab] = useState<"reminders" | "feed">("reminders");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 20px 0", flexShrink: 0 }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Activity</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 14, fontFamily: font }}>Reminders & squad updates</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["reminders", "feed"] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)} style={{ padding: "7px 16px", borderRadius: 20, border: `1.5px solid ${subTab === t ? T.accent : T.border}`, background: subTab === t ? T.accentDim : "transparent", color: subTab === t ? T.accent : T.textSub, fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer", position: "relative" }}>
              {t === "reminders" ? "🔔 Reminders" : "Feed"}
              {t === "reminders" && <span style={{ marginLeft: 6, background: T.accent, borderRadius: 8, padding: "1px 6px", fontSize: 10, color: "#fff", fontWeight: 900 }}>4</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 24px" }}>
        {subTab === "reminders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {REMINDERS.map(r => (
              <div key={r.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, background: r.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{r.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 3 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.4, marginBottom: 8 }}>{r.body}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button style={{ padding: "5px 14px", borderRadius: 8, border: `1.5px solid ${r.color}`, background: r.color + "18", color: r.color, fontFamily: font, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{r.action}</button>
                    <span style={{ fontSize: 11, color: T.textDim, fontFamily: font }}>{r.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {subTab === "feed" && (
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
        )}
      </div>
    </div>
  );
}

const PRO_FEATURES = [
  { key: "events", icon: "🗓️", label: "Unlimited Events" },
  { key: "vault", icon: "📷", label: "Photo Vault" },
] as const;

const VAULT_PLACEHOLDER_PHOTOS = [
  { id: 1, emoji: "🔥", label: "Rooftop BBQ", squad: "The Usual Suspects", date: "Jun 7", color: "#FF6B3A" },
  { id: 2, emoji: "🎳", label: "Bowling Night", squad: "College Crew", date: "May 24", color: "#7B6EF6" },
  { id: 3, emoji: "🍕", label: "Pizza Friday", squad: "Work Crew", date: "May 17", color: "#F5A623" },
  { id: 4, emoji: "🏖️", label: "Beach Day", squad: "Westside Fam", date: "Apr 30", color: "#4ECDC4" },
  { id: 5, emoji: "🎮", label: "Game Night", squad: "The Usual Suspects", date: "Apr 19", color: "#A78BFA" },
  { id: 6, emoji: "🍳", label: "Brunch Run", squad: "College Crew", date: "Apr 5", color: "#FB923C" },
];

function PhotoVaultTab({ onUpgrade }: { onUpgrade?: () => void }) {
  const [isPro, setIsPro] = React.useState<boolean | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);

  React.useEffect(() => {
    fetch('/api/subscription', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { isPro?: boolean }) => setIsPro(!!d.isPro))
      .catch(() => setIsPro(false));
  }, []);

  if (isPro === null) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 32, height: 32, borderRadius: 16, border: `3px solid ${T.accent}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (!isPro) {
    return (
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ padding: "20px 20px 40px" }}>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>📷 Photo Vault</div>
          <div style={{ fontSize: 13, color: T.textSub, marginBottom: 24, fontFamily: font }}>Private squad memories</div>

          <div style={{
            background: `linear-gradient(135deg, ${T.purple}22, ${T.blue}18)`,
            border: `1px solid ${T.purple}40`,
            borderRadius: 20,
            padding: "32px 24px",
            textAlign: "center",
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.white, marginBottom: 8 }}>
              Photo Vault is a Pro feature
            </div>
            <div style={{ fontSize: 14, color: T.textSub, fontFamily: font, lineHeight: 1.5, marginBottom: 24 }}>
              Upload unlimited squad photos. They're private, organized by event, and stored securely — only visible to squad members.
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 24 }}>
              {["🖼️ Private gallery", "📁 By event", "🔐 Members only"].map(f => (
                <div key={f} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 20, padding: "5px 12px", fontSize: 12, color: T.textSub, fontFamily: font, fontWeight: 600 }}>{f}</div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, borderRadius: 14, overflow: "hidden", filter: "blur(3px) brightness(0.5)", pointerEvents: "none", marginBottom: 24 }}>
            {VAULT_PLACEHOLDER_PHOTOS.map(p => (
              <div key={p.id} style={{ aspectRatio: "1", background: `${p.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>{p.emoji}</div>
            ))}
          </div>

          <button
            onClick={onUpgrade}
            style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 15, padding: "14px 20px", cursor: "pointer", boxShadow: `0 6px 20px ${T.accent}40` }}
          >
            ⚡ Upgrade to Pro — $20/year
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white }}>📷 Photo Vault</div>
          <div style={{ background: T.gold + "22", border: `1px solid ${T.gold}60`, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 900, color: T.gold, letterSpacing: "0.08em", fontFamily: fontMono }}>PRO</div>
        </div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>Private squad memories · 6 photos</div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
          {["All", "The Usual Suspects", "College Crew", "Work Crew"].map(f => (
            <button key={f} style={{ flexShrink: 0, background: f === "All" ? T.accent : T.surface, border: `1px solid ${f === "All" ? T.accent : T.border}`, borderRadius: 20, padding: "6px 14px", fontSize: 12, color: f === "All" ? "#fff" : T.textSub, fontFamily: font, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" as const }}>{f}</button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
          {VAULT_PLACEHOLDER_PHOTOS.map(p => (
            <div
              key={p.id}
              onClick={() => setSelected(selected === p.id ? null : p.id)}
              style={{ aspectRatio: "1", background: `${p.color}30`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 28, cursor: "pointer", position: "relative", border: selected === p.id ? `2px solid ${T.accent}` : "2px solid transparent", transition: "border-color 0.15s" }}>
              {p.emoji}
              {selected === p.id && (
                <div style={{ position: "absolute", bottom: 4, right: 4, width: 18, height: 18, background: T.accent, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff" }}>✓</div>
              )}
            </div>
          ))}
        </div>

        {selected !== null && (() => {
          const p = VAULT_PLACEHOLDER_PHOTOS.find(x => x.id === selected);
          if (!p) return null;
          return (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", marginBottom: 20 }}>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 4 }}>{p.emoji} {p.label}</div>
              <div style={{ fontSize: 12, color: T.textSub }}>{p.squad} · {p.date}</div>
            </div>
          );
        })()}

        <div style={{ border: `1.5px dashed ${T.border}`, borderRadius: 16, padding: "24px 20px", textAlign: "center", cursor: "pointer" }}
          onClick={() => {}}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>+</div>
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.textSub, marginBottom: 4 }}>Upload photos</div>
          <div style={{ fontSize: 12, color: T.textDim }}>Add memories from your last event</div>
        </div>
      </div>
    </div>
  );
}

function CheckoutSuccessBanner({ onDismiss, onFeaturePress }: { onDismiss: () => void; onFeaturePress: (key: string) => void }) {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={{
      background: `linear-gradient(135deg, ${T.green}22, ${T.green}10)`,
      border: `1px solid ${T.green}50`,
      borderRadius: 14,
      padding: "14px 16px",
      marginBottom: 20,
      animation: "fadeSlideIn 0.35s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>🎉</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: font, fontWeight: 800, fontSize: 15, color: T.green, marginBottom: 2 }}>
            Welcome to Squadz Pro!
          </div>
          <div style={{ fontSize: 13, color: T.textSub, fontFamily: font, lineHeight: 1.4 }}>
            Your upgrade is confirmed. Tap a feature below to explore what's unlocked.
          </div>
        </div>
        <button onClick={onDismiss} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PRO_FEATURES.map(f => (
          <button
            key={f.key}
            onClick={() => { onFeaturePress(f.key); onDismiss(); }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: T.green + "18", border: `1px solid ${T.green}40`,
              borderRadius: 20, padding: "5px 11px",
              cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: 700,
              color: T.green, transition: "background 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = T.green + "30")}
            onMouseLeave={e => (e.currentTarget.style.background = T.green + "18")}
          >
            <span>{f.icon}</span>
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileTab({ go, setTab, displayName, checkoutSuccess }: { go: (s: string) => void; setTab?: (t: string) => void; displayName?: string | null; checkoutSuccess?: boolean }) {
  const [notifs, setNotifs] = useState(true);
  const [calSync, setCalSync] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [isPro, setIsPro] = useState(!!checkoutSuccess);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(!!checkoutSuccess);
  const [showProFeatures, setShowProFeatures] = useState(false);
  const stats = [{ n: "24", l: "Events" }, { n: "4", l: "SquadZ" }, { n: "🔥12", l: "Streak" }];

  // Check subscription status on mount.
  // Server resolves the current user from the session cookie — no userId in the request.
  React.useEffect(() => {
    fetch('/api/subscription', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { isPro?: boolean }) => { if (d.isPro) setIsPro(true); })
      .catch(() => {});
  }, []);

  async function handleUpgrade() {
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const productsRes = await fetch('/api/products-with-prices');
      const { data: products } = await productsRes.json() as {
        data: Array<{ id: string; name: string; prices: Array<{ id: string; recurring: { interval: string } | null }> }>;
      };
      const pro = products.find(p => p.name === "Squadz Pro");
      const yearlyPrice = pro?.prices.find(p => p.recurring?.interval === "year");
      if (!yearlyPrice) { setUpgradeError("Pro plan not found. Please try again later."); return; }

      // Server resolves current user from session — only priceId sent from client
      const checkoutRes = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priceId: yearlyPrice.id }),
      });
      const { url, error: apiError } = await checkoutRes.json() as { url?: string; error?: string };
      if (apiError || !url) { setUpgradeError(apiError ?? "Failed to start checkout."); return; }
      window.location.href = url;
    } catch { setUpgradeError("Something went wrong. Please try again."); }
    finally { setUpgradeLoading(false); }
  }

  async function handlePortal() {
    try {
      // Server resolves current user from session — no userId sent from client
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const { url, error: apiError } = await res.json() as { url?: string; error?: string };
      if (apiError || !url) { alert(apiError ?? "Failed to open portal."); return; }
      window.location.href = url;
    } catch { alert("Something went wrong. Please try again."); }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 40px" }}>
        {showSuccessBanner && (
          <CheckoutSuccessBanner
            onDismiss={() => setShowSuccessBanner(false)}
            onFeaturePress={(key) => {
              if (key === "events") { go("create-event"); }
              else if (key === "vault") { setTab?.("vault"); }
            }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <div style={{ width: 80, height: 80, borderRadius: 40, background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: displayName ? 28 : 36, fontWeight: 800, color: "#000" }}>
              {displayName ? displayName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() : "?"}
            </div>
            <div onClick={() => go("edit-profile")} style={{ position: "absolute", bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13, background: T.surfaceHigh, border: `2px solid ${T.bg}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13 }}>✏️</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, fontWeight: 700, color: T.white }}>{displayName ?? "My Profile"}</div>
            {isPro && (
              <div style={{ background: T.gold + "22", border: `1px solid ${T.gold}60`, borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 900, color: T.gold, letterSpacing: "0.08em", fontFamily: fontMono }}>PRO</div>
            )}
          </div>
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

        {/* Pro section */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8, paddingLeft: 4 }}>Squadz Pro</div>
          {isPro ? (
            <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.gold, fontWeight: 700 }}>Squadz Pro — Active</div>
              </div>
              <div
                onClick={() => setShowProFeatures(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: `1px solid ${T.border}`, cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = T.surfaceHigh)}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <span style={{ fontSize: 18 }}>🎁</span>
                <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.text }}>What's included in Pro</div>
                <span style={{ color: T.textDim, fontSize: 14, transition: "transform 0.2s", display: "inline-block", transform: showProFeatures ? "rotate(90deg)" : "none" }}>›</span>
              </div>
              {showProFeatures && (
                <div style={{ padding: "12px 16px 14px", borderTop: `1px solid ${T.border}`, background: T.surfaceHigh + "80" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {PRO_FEATURES.map(f => (
                      <button
                        key={f.key}
                        onClick={() => {
                          if (f.key === "events") { go("create-event"); }
                          else if (f.key === "vault") { setTab?.("squads"); }
                          setShowProFeatures(false);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          background: T.gold + "15", border: `1px solid ${T.gold}40`,
                          borderRadius: 20, padding: "5px 11px",
                          cursor: "pointer", fontFamily: font, fontSize: 12, fontWeight: 700,
                          color: T.gold, transition: "background 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = T.gold + "28")}
                        onMouseLeave={e => (e.currentTarget.style.background = T.gold + "15")}
                      >
                        <span>{f.icon}</span>
                        <span>{f.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div onClick={handlePortal} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: `1px solid ${T.border}`, cursor: "pointer" }}>
                <span style={{ fontSize: 18 }}>⚙️</span>
                <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.text }}>Manage Subscription</div>
                <span style={{ color: T.textDim, fontSize: 16 }}>›</span>
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={() => void handleUpgrade()}
                disabled={upgradeLoading}
                style={{ width: "100%", borderRadius: 14, border: "none", background: upgradeLoading ? `${T.accent}80` : `linear-gradient(135deg, ${T.accent}, #FF8050)`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 15, padding: "14px 20px", cursor: upgradeLoading ? "not-allowed" : "pointer", boxShadow: `0 6px 20px ${T.accent}40`, marginBottom: 8 }}
              >
                {upgradeLoading ? "Opening checkout…" : "⚡ Upgrade to Pro — $20/year"}
              </button>
              {upgradeError && <div style={{ fontSize: 12, color: "#FF6B6B", fontFamily: font, textAlign: "center" }}>{upgradeError}</div>}
            </div>
          )}
        </div>

        {[
          { label: "Account", items: [
            { icon: "✏️", label: "Edit Profile", onPress: () => go("edit-profile") },
            { icon: "🔒", label: "Change Password", onPress: () => {} },
            { icon: "📧", label: "Email: jordan@email.com", onPress: () => {} },
          ]},
          { label: "Preferences", items: [
            { icon: "🔔", label: "Push Notifications", toggle: notifs, onToggle: () => setNotifs(!notifs) },
            { icon: "📅", label: "Calendar Sync", toggle: calSync, onToggle: () => setCalSync(!calSync) },
            { icon: "🌙", label: "Dark Mode", toggle: darkMode, onToggle: () => setDarkMode(!darkMode) },
          ]},
          { label: "About", items: [
            { icon: "⭐", label: "Rate Squadz", onPress: () => {} },
            { icon: "💬", label: "Send Feedback", onPress: () => {} },
            { icon: "📋", label: "Privacy Policy", onPress: () => {} },
          ]},
        ].map(group => (
          <div key={group.label} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8, paddingLeft: 4 }}>{group.label}</div>
            <div style={{ background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, overflow: "hidden" }}>
              {group.items.map((item, i) => {
                const pressable = "onPress" in item ? item.onPress as () => void : undefined;
                return (
                <div key={item.label} onClick={pressable} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: i > 0 ? `1px solid ${T.border}` : "none", cursor: pressable ? "pointer" : "default" }}>
                  <span style={{ fontSize: 18 }}>{item.icon}</span>
                  <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.text }}>{item.label}</div>
                  {"toggle" in item ? <SwitchToggle on={item.toggle as boolean} toggle={item.onToggle as () => void} /> : <span style={{ color: T.textDim, fontSize: 16 }}>›</span>}
                </div>
                );
              })}
            </div>
          </div>
        ))}

        <Btn variant="danger" onPress={() => go("/")}>Log Out</Btn>
      </div>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState("home");
  const [, setLocation] = useLocation();
  const { firstName, displayName } = useCurrentUser();
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const { events } = useEvents();
  const { squads } = useSquads();

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      setCheckoutSuccess(true);
      setTab("profile");
    }
  }, []);

  const go = (screen: string) => {
    if (screen === "/" || screen === "splash") { setLocation("/"); return; }
    if (screen === "event") { setLocation("/event"); return; }
    if (screen === "squad") { setLocation("/squad"); return; }
    if (screen === "create-event") { setLocation("/create-event"); return; }
    if (screen === "create-squad") { setLocation("/create-squad"); return; }
    if (screen === "dm-chat") { setLocation("/dm-chat"); return; }
    if (screen === "event-thread") { setLocation("/event-thread"); return; }
    if (screen === "edit-profile") { setLocation("/edit-profile"); return; }
  };

  const tabContent: Record<string, React.ReactElement> = {
    home: <HomeTab go={go} onBellPress={() => setTab("activity")} firstName={firstName} squads={squads} events={events} />,
    squads: <SquadsTab go={go} squads={squads} />,
    messages: <MessagesTab go={go} />,
    discover: <DiscoverTab go={go} />,
    vault: <PhotoVaultTab onUpgrade={() => setTab("profile")} />,
    activity: <ActivityTab />,
    profile: <ProfileTab go={go} setTab={setTab} displayName={displayName} checkoutSuccess={checkoutSuccess} />,
  };

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {tabContent[tab]}
        </div>
        <BottomTab active={tab} setActive={setTab} />
      </div>
    </PhoneShell>
  );
}
