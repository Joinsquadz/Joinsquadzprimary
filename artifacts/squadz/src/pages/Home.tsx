import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar, Tag, SectionLabel, Card, SwitchToggle, Btn } from "@/components/shared";
import { T, font, fontMono, SQUADS, MEMBERS, ACTIVITY_FEED, SUGGESTIONS, MESSAGES, getAvatarColor } from "@/lib/data";

function BottomTab({ active, setActive }: { active: string; setActive: (t: string) => void }) {
  const tabs = [
    { key: "home", icon: "⊞", label: "Home" },
    { key: "squads", icon: "👥", label: "SquadZ" },
    { key: "messages", icon: "💬", label: "Messages" },
    { key: "discover", icon: "✦", label: "Discover" },
    { key: "activity", icon: "◎", label: "Activity" },
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
          <div style={{ fontSize: 20, lineHeight: 1 }}>{tab.icon}</div>
          <div style={{ fontSize: 9, fontFamily: font, fontWeight: 600, letterSpacing: "0.03em" }}>{tab.label}</div>
        </button>
      ))}
    </div>
  );
}

function HomeTab({ go }: { go: (s: string) => void }) {
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: T.white }}>Hey, Jordan 👋</div>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font }}>4 SquadZ · 1 event this week</div>
          </div>
          <div style={{ position: "relative", cursor: "pointer" }} onClick={() => go("profile")}>
            <Avatar name="Jordan" size={44} color={T.accent} />
            <div style={{ position: "absolute", top: 0, right: 0, width: 14, height: 14, background: T.green, borderRadius: "50%", border: `2px solid ${T.bg}` }} />
          </div>
        </div>

        <div onClick={() => go("event")} style={{ background: `linear-gradient(135deg, ${T.accent}, #FF8C3A)`, borderRadius: 22, padding: 20, marginBottom: 20, cursor: "pointer", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -30, top: -30, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
          <Tag color="#fff">⚡ Up Next · Sat Jun 7</Tag>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: "#fff", margin: "8px 0 4px" }}>Rooftop BBQ 🔥</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14 }}>Marcus's Place · 5:00 PM</div>
          <div style={{ display: "flex", alignItems: "center" }}>
            {MEMBERS.slice(0, 5).map((m, i) => (
              <div key={i} style={{ width: 28, height: 28, borderRadius: 14, background: getAvatarColor(m.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#000", marginLeft: i > 0 ? -8 : 0, border: `2px solid ${T.accent}` }}>{m.name[0]}</div>
            ))}
            <div style={{ marginLeft: 8, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>5 going</div>
          </div>
        </div>

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
          {SQUADS.map(s => (
            <div key={s.id} onClick={() => go("squad")} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "12px 14px", minWidth: 130, cursor: "pointer", flexShrink: 0 }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{s.emoji}</div>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: T.textDim }}>{s.members} members</div>
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

function SquadsTab({ go }: { go: (s: string) => void }) {
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ fontFamily: "'Georgia', serif", fontSize: 24, fontWeight: 700, color: T.white, marginBottom: 4 }}>Your SquadZ</div>
        <div style={{ fontSize: 13, color: T.textSub, marginBottom: 20, fontFamily: font }}>4 active groups</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {SQUADS.map(s => (
            <div key={s.id} onClick={() => go("squad")} style={{ background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`, padding: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
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
          <Btn variant="ghost" onPress={() => go("create-squad")}>+ Create New Squad</Btn>
          <Btn variant="secondary" onPress={() => {}}>Join with Invite Link</Btn>
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

function DiscoverTab({ go }: { go: (s: string) => void }) {
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
    <div style={{ flex: 1, overflowY: "auto" }}>
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
    </div>
  );
}

function ActivityTab() {
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
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
    </div>
  );
}

function ProfileTab({ go }: { go: (s: string) => void }) {
  const [notifs, setNotifs] = useState(true);
  const [calSync, setCalSync] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const stats = [{ n: "24", l: "Events" }, { n: "4", l: "SquadZ" }, { n: "🔥12", l: "Streak" }];
  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 40px" }}>
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
    home: <HomeTab go={go} />,
    squads: <SquadsTab go={go} />,
    messages: <MessagesTab go={go} />,
    discover: <DiscoverTab go={go} />,
    activity: <ActivityTab />,
    profile: <ProfileTab go={go} />,
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
