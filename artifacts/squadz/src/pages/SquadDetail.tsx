import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar, Tag, SectionLabel, Btn } from "@/components/shared";
import { T, font, fontMono, MEMBERS, EVENT_PHOTOS } from "@/lib/data";
import { useProStatus } from "@/hooks/useProStatus";

const SQUAD_TAB_KEY = "squadz:squad-detail-tab";
const SQUAD_PHOTOS_SCROLL_KEY = "squadz:photos-scroll-y";
const VALID_TABS = ["events", "photos", "members", "polls", "settings"];

const skeletonKeyframes = `
@keyframes skeletonPulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}
`;

function SkeletonBlock({ width, height, borderRadius = 8, style = {} }: { width?: number | string; height: number; borderRadius?: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      width: width ?? "100%",
      height,
      borderRadius,
      background: `linear-gradient(90deg, ${T.surfaceHigh}, ${T.surfaceUp}, ${T.surfaceHigh})`,
      animation: "skeletonPulse 1.4s ease-in-out infinite",
      flexShrink: 0,
      ...style,
    }} />
  );
}

function SquadHeaderSkeleton() {
  return (
    <div style={{ textAlign: "center", paddingBottom: 20 }}>
      <style>{skeletonKeyframes}</style>
      <div style={{ width: 48, height: 48, borderRadius: 24, background: `linear-gradient(90deg, rgba(255,255,255,0.15), rgba(255,255,255,0.3), rgba(255,255,255,0.15))`, animation: "skeletonPulse 1.4s ease-in-out infinite", margin: "0 auto 12px" }} />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <SkeletonBlock width="60%" height={26} borderRadius={10} style={{ background: `linear-gradient(90deg, rgba(255,255,255,0.15), rgba(255,255,255,0.3), rgba(255,255,255,0.15))` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <SkeletonBlock width="40%" height={13} borderRadius={8} style={{ background: `linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.22), rgba(255,255,255,0.1))` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 0 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ width: 30, height: 30, borderRadius: 15, background: `rgba(255,255,255,0.2)`, animation: "skeletonPulse 1.4s ease-in-out infinite", border: `2px solid rgba(255,255,255,0.3)`, marginLeft: i > 0 ? -8 : 0 }} />
        ))}
      </div>
    </div>
  );
}

function SquadMembersSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <style>{skeletonKeyframes}</style>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
          <SkeletonBlock width={44} height={44} borderRadius={22} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <SkeletonBlock width="50%" height={14} borderRadius={8} />
            <SkeletonBlock width="30%" height={11} borderRadius={6} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SquadDetail() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SQUAD_TAB_KEY);
      if (saved && VALID_TABS.includes(saved)) return saved;
    } catch {}
    return "events";
  });
  const { isPro } = useProStatus();
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const contentRef = useRef<HTMLDivElement>(null);
  const prevTabRef = useRef(tab);

  const switchTab = useCallback((next: string) => {
    if (prevTabRef.current === "photos" && contentRef.current) {
      try { localStorage.setItem(SQUAD_PHOTOS_SCROLL_KEY, String(contentRef.current.scrollTop)); } catch {}
    }
    prevTabRef.current = next;
    setTab(next);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SQUAD_TAB_KEY, tab); } catch {}
    if (tab === "photos" && contentRef.current) {
      try {
        const saved = localStorage.getItem(SQUAD_PHOTOS_SCROLL_KEY);
        if (saved) {
          const y = parseFloat(saved);
          if (!isNaN(y)) contentRef.current.scrollTop = y;
        }
      } catch {}
    }
  }, [tab]);

  const copyLink = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
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
            <button onClick={() => switchTab("settings")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>⚙️</button>
          </div>
          {isLoading ? <SquadHeaderSkeleton /> : (
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
          )}
          <div style={{ display: "flex", overflowX: "auto" }}>
            {["events", "photos", "members", "polls", "settings"].map(t => (
              <button key={t} onClick={() => switchTab(t)} style={{ flex: 1, background: "none", border: "none", padding: "10px 0", cursor: "pointer", fontFamily: font, fontWeight: 700, fontSize: 12, color: tab === t ? "#fff" : "rgba(255,255,255,0.6)", borderBottom: `2px solid ${tab === t ? "#fff" : "transparent"}`, textTransform: "capitalize", flexShrink: 0, minWidth: 60 }}>{t}</button>
            ))}
          </div>
        </div>

        <div ref={contentRef} style={{ flex: 1, overflowY: "auto" }}>
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
            {tab === "photos" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <SectionLabel>📸 Squad Photos</SectionLabel>
                  {isPro
                    ? <Tag color={T.green}>🔒 Vault · Forever</Tag>
                    : <Tag color={T.gold}>30-day limit · Free</Tag>
                  }
                </div>
                {isPro ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
                      {EVENT_PHOTOS.map((photo, i) => {
                        const bgColors = [T.accent, T.purple, T.gold, T.blue, T.green, T.accent];
                        const bgColors2 = [T.accent, T.purple, T.gold, T.blue, T.green, T.purple];
                        return (
                          <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: 12, background: `linear-gradient(135deg, ${bgColors[i % bgColors.length]}22, ${bgColors2[i % bgColors2.length]}44)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, border: `1px solid ${T.border}` }}>
                            <span>{photo.em}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ background: `${T.green}18`, border: `1px solid ${T.green}40`, borderRadius: 14, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>✅</span>
                      <div style={{ flex: 1, fontSize: 13, color: T.green, fontFamily: font, fontWeight: 700 }}>Photos saved to your permanent vault</div>
                    </div>
                    <Btn variant="ghost" onPress={() => {}}>+ Add Photos</Btn>
                  </>
                ) : (
                  <>
                    <div style={{ background: T.surface, borderRadius: 20, border: `1px solid ${T.border}`, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
                      <div style={{ fontFamily: font, fontWeight: 700, fontSize: 17, color: T.text, textAlign: "center", marginBottom: 8 }}>Photo Vault is a Pro feature</div>
                      <div style={{ fontSize: 13, color: T.textSub, fontFamily: font, textAlign: "center", lineHeight: 1.5, marginBottom: 16 }}>
                        Upload unlimited squad photos. Private, organized by event, and stored forever — only visible to squad members.
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, justifyContent: "center", marginBottom: 0 }}>
                        {["🖼️ Private gallery", "📁 By event", "🔐 Members only"].map(f => (
                          <div key={f} style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 20, padding: "4px 12px", fontSize: 12, color: T.textSub, fontFamily: font }}>{f}</div>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14, opacity: 0.3 }}>
                      {EVENT_PHOTOS.map((photo, i) => {
                        const bgColors = [T.accent, T.purple, T.gold, T.blue, T.green, T.accent];
                        return (
                          <div key={i} style={{ aspectRatio: "1", borderRadius: 12, background: `${bgColors[i % bgColors.length]}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, border: `1px solid ${T.border}` }}>
                            <span style={{ filter: "blur(3px)" }}>{photo.em}</span>
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={() => setLocation("/subscription")} style={{ width: "100%", borderRadius: 14, border: "none", background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`, color: "#fff", fontFamily: font, fontWeight: 800, fontSize: 14, padding: "14px 16px", cursor: "pointer" }}>
                      ⚡ Upgrade to Pro — $20/year
                    </button>
                  </>
                )}
              </>
            )}
            {tab === "members" && (
              <>
                {isLoading ? (
                  <>
                    <SkeletonBlock width="35%" height={12} borderRadius={6} style={{ marginBottom: 14 }} />
                    <SquadMembersSkeleton />
                  </>
                ) : (
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
                  </>
                )}
                <div style={{ marginTop: 16 }}>
                  <Btn variant="ghost" onPress={() => setShowInvite(!showInvite)}>+ Invite Members</Btn>
                  {showInvite && (
                    <div style={{ marginTop: 10, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: "14px 16px" }}>
                      <div style={{ fontSize: 12, color: T.textSub, fontFamily: font, marginBottom: 8 }}>Share this link to invite people:</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ flex: 1, background: T.surface, borderRadius: 10, padding: "9px 12px", fontFamily: "'DM Mono', monospace", fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>getsquadz.com/join/abc123</div>
                        <button onClick={copyLink} style={{ background: copied ? T.green + "22" : T.accent + "22", border: `1px solid ${copied ? T.green : T.accent}`, color: copied ? T.green : T.accent, borderRadius: 10, padding: "8px 14px", fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" as const }}>
                          {copied ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
                <div style={{ marginTop: 24, position: "relative" }}>
                  {confirmLeave && (
                    <div style={{ background: T.surfaceUp, border: `1px solid #FF4444`, borderRadius: 14, padding: "16px", marginBottom: 10 }}>
                      <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 4 }}>Leave The Usual Suspects?</div>
                      <div style={{ fontSize: 13, color: T.textSub, marginBottom: 12 }}>You'll need a new invite link to rejoin.</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setLocation("/home")} style={{ flex: 1, background: "#FF4444", border: "none", borderRadius: 10, color: "#fff", padding: "10px 0", fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Leave</button>
                        <button onClick={() => setConfirmLeave(false)} style={{ flex: 1, background: T.surfaceHigh, border: "none", borderRadius: 10, color: T.textSub, padding: "10px 0", fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  <Btn variant="danger" onPress={() => setConfirmLeave(!confirmLeave)}>Leave Squad</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
