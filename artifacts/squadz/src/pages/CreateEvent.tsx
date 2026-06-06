import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Btn, Input, SectionLabel, Card, SwitchToggle } from "@/components/shared";
import { T, font, fontMono, SQUADS } from "@/lib/data";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useProStatus } from "@/hooks/useProStatus";

const FREE_EVENT_LIMIT = 3;

export default function CreateEvent() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sections, setSections] = useState(new Set(["food", "budget"]));
  const [upgradeModal, setUpgradeModal] = useState<"calendar" | "events" | null>(null);
  const [calendarSynced, setCalendarSynced] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [eventCount, setEventCount] = useState<number | null>(null);

  const { isPro, loading: proLoading } = useProStatus();

  useEffect(() => {
    fetch("/api/events/count")
      .then(r => r.ok ? r.json() : null)
      .then((data: { count: number } | null) => { if (data) setEventCount(data.count); })
      .catch(() => {});
  }, []);

  const totalEventCount = eventCount ?? 0;
  const atLimit = !isPro && totalEventCount >= FREE_EVENT_LIMIT;

  const steps = ["Type", "When", "Where", "Who", "Sections", "Review"];
  const types = [
    { e: "🍔", n: "Food Hangout" }, { e: "🏠", n: "House Party" }, { e: "🌴", n: "Day Trip" },
    { e: "🎮", n: "Game Night" }, { e: "🍕", n: "Dinner Out" }, { e: "🏋️", n: "Active" },
    { e: "🎬", n: "Movie" }, { e: "🎵", n: "Music" }, { e: "✈️", n: "Weekend Away" }, { e: "🎉", n: "Celebration" },
    { e: "📚", n: "Study" }, { e: "🍷", n: "Wine Night" },
  ];
  const sectionOpts = [
    { id: "rsvp", icon: "✅", label: "RSVP Tracker", desc: "See who's in, maybe, or out" },
    { id: "food", icon: "🍔", label: "Food Plan", desc: "Coordinate who brings what" },
    { id: "budget", icon: "💸", label: "Budget & Expenses", desc: "Split costs, track spending" },
    { id: "polls", icon: "🗳️", label: "Polls & Voting", desc: "Decide on time, place, music" },
    { id: "tasks", icon: "✅", label: "Checklist", desc: "Assign and track to-dos" },
    { id: "chat", icon: "💬", label: "Event Chat", desc: "A thread just for this event" },
  ];
  const toggleSection = (id: string) => {
    const s = new Set(sections);
    s.has(id) ? s.delete(id) : s.add(id);
    setSections(s);
  };

  async function handleCalendarSync() {
    if (!isPro) {
      setUpgradeModal("calendar");
      return;
    }
    setCalendarLoading(true);
    try {
      const res = await fetch("/api/calendar-sync");
      if (res.ok) {
        setCalendarSynced(true);
      } else if (res.status === 403) {
        setUpgradeModal("calendar");
      } else {
        setCalendarSynced(true);
      }
    } catch {
      setCalendarSynced(true);
    } finally {
      setCalendarLoading(false);
    }
  }

  async function handlePublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: name.trim() || "New Event",
          emoji: "🎉",
          date: "Date TBD",
          location: "Location TBD",
          description: "",
        }),
      });
      if (res.status === 403) {
        const body = await res.json() as { requiresPro?: boolean };
        if (body.requiresPro) setUpgradeModal("events");
        return;
      }
      if (!res.ok) return;
      const created = await res.json() as { id: string };
      setEventCount(c => (c ?? 0) + 1);
      setLocation(`/event?id=${created.id}`);
    } catch {
      setLocation("/event");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px 12px", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <button onClick={() => step > 0 ? setStep(step - 1) : setLocation("/home")} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, cursor: "pointer", padding: 0 }}>←</button>
            <div style={{ flex: 1, fontFamily: "'Georgia', serif", fontSize: 18, fontWeight: 700, color: T.white }}>New Event</div>
            <span style={{ fontSize: 13, color: T.textSub, fontFamily: fontMono }}>{step + 1}/{steps.length}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {steps.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? T.accent : T.surfaceHigh, transition: "background 0.3s" }} />)}
          </div>
        </div>

        {!isPro && !proLoading && (
          <div style={{ background: `linear-gradient(90deg, ${T.gold}22, ${T.accent}18)`, borderBottom: `1px solid ${T.gold}40`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 14 }}>⚡</span>
            <div style={{ flex: 1, fontSize: 12, color: T.gold, fontFamily: font }}>
              <strong>Free plan:</strong> {totalEventCount}/{FREE_EVENT_LIMIT} events used this year
            </div>
            <button onClick={() => setUpgradeModal("events")} style={{ background: "none", border: `1px solid ${T.gold}60`, borderRadius: 8, padding: "3px 10px", color: T.gold, fontFamily: font, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
              Upgrade
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "20px 20px" }}>
            {step === 0 && (
              <>
                <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>What kind of event?</div>
                <div style={{ marginBottom: 16 }}><Input placeholder="Give it a name…" icon="✏️" value={name} onChange={setName} /></div>
                <SectionLabel>Or pick a type</SectionLabel>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {types.map(t => (
                    <div key={t.n} onClick={() => setName(t.n)} style={{ background: name === t.n ? T.accentDim : T.surface, border: `2px solid ${name === t.n ? T.accent : T.border}`, borderRadius: 14, padding: "12px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 22 }}>{t.e}</div>
                      <div style={{ fontSize: 10, color: T.textSub, fontFamily: font, textAlign: "center" }}>{t.n}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>When is it?</div>
                <div style={{ marginBottom: 12 }}><Input placeholder="Select date" icon="📅" /></div>
                <div style={{ marginBottom: 20 }}><Input placeholder="Start time" icon="🕐" /></div>
                <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 8 }}>⚡ AI Best Time Finder</div>
                  <div style={{ fontSize: 12, color: T.textSub, marginBottom: 12 }}>Sync calendars to find when everyone is free</div>
                  {calendarSynced ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: T.greenDim, border: `1px solid ${T.green}40`, borderRadius: 10, padding: "9px 14px" }}>
                      <span style={{ fontSize: 14 }}>✅</span>
                      <span style={{ fontSize: 13, color: T.green, fontFamily: font, fontWeight: 700 }}>Google Calendar synced!</span>
                    </div>
                  ) : (
                    <Btn small variant="ghost" onPress={handleCalendarSync} style={{ opacity: calendarLoading ? 0.6 : 1 }}>
                      {calendarLoading ? "Connecting…" : isPro ? "Sync Google Calendar" : "🔒 Sync Google Calendar (Pro)"}
                    </Btn>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}><Btn small variant="secondary" onPress={() => {}}>Add End Time</Btn></div>
                  <div style={{ flex: 1 }}><Btn small variant="secondary" onPress={() => {}}>Recurring?</Btn></div>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>Where is it?</div>
                <div style={{ marginBottom: 12 }}><Input placeholder="Search for a place or address" icon="📍" /></div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {["My Location", "Add a Link", "TBD"].map(b => (
                    <div key={b} style={{ flex: 1, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 6px", textAlign: "center", fontSize: 11, color: T.textSub, fontFamily: font, cursor: "pointer" }}>{b}</div>
                  ))}
                </div>
                <div style={{ background: T.surfaceUp, borderRadius: 14, height: 160, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.border}` }}>
                  <div style={{ textAlign: "center", color: T.textDim, fontSize: 14 }}>🗺️<br />Map Preview</div>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 16 }}>Who's invited?</div>
                {SQUADS.map(s => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 22 }}>{s.emoji}</div>
                    <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{s.name} ({s.members})</div>
                    <SwitchToggle on={s.id === 1} toggle={() => {}} />
                  </div>
                ))}
                <div style={{ marginTop: 16 }}><Btn small variant="ghost" onPress={() => {}}>+ Invite Individuals</Btn></div>
              </>
            )}
            {step === 4 && (
              <>
                <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 8 }}>Add Sections</div>
                <div style={{ fontSize: 14, color: T.textSub, marginBottom: 20 }}>Customize your event with tools</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sectionOpts.map(opt => (
                    <div key={opt.id} onClick={() => toggleSection(opt.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: sections.has(opt.id) ? T.accentDim : T.surface, border: `1.5px solid ${sections.has(opt.id) ? T.accent : T.border}`, borderRadius: 14, cursor: "pointer" }}>
                      <span style={{ fontSize: 24 }}>{opt.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>{opt.label}</div>
                        <div style={{ fontSize: 12, color: T.textSub }}>{opt.desc}</div>
                      </div>
                      <div style={{ width: 22, height: 22, borderRadius: 11, background: sections.has(opt.id) ? T.accent : T.surfaceHigh, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#000", fontWeight: 800 }}>
                        {sections.has(opt.id) ? "✓" : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {step === 5 && (
              <>
                <div style={{ fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, color: T.white, marginBottom: 20 }}>Review & Publish</div>
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: font, fontWeight: 800, fontSize: 18, color: T.text, marginBottom: 4 }}>{name || "Rooftop BBQ"}</div>
                  {[["📅", "Sat, Jun 7 · 5:00 PM"], ["📍", "Marcus's Place, 142 Oak St"], ["👥", "The Usual Suspects (7 invited)"], ["⚡", "Food, Budget, Polls added"]].map(([icon, val]) => (
                    <div key={val} style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 13, color: T.textSub, fontFamily: font }}>
                      <span>{icon}</span><span>{val}</span>
                    </div>
                  ))}
                </Card>
                {atLimit && (
                  <div style={{ background: `${T.accent}18`, border: `1px solid ${T.accent}50`, borderRadius: 14, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 18 }}>🎉</span>
                    <div>
                      <div style={{ fontFamily: font, fontWeight: 700, fontSize: 13, color: T.accent, marginBottom: 3 }}>You've hit the free limit</div>
                      <div style={{ fontSize: 12, color: T.textSub }}>You've planned {totalEventCount} events this year. Upgrade to Pro to publish this event.</div>
                    </div>
                  </div>
                )}
                <SectionLabel>Notify via</SectionLabel>
                <div style={{ display: "flex", gap: 8 }}>
                  {["Push", "iMessage", "Email"].map(b => (
                    <div key={b} style={{ flex: 1, background: T.accentDim, border: `1px solid ${T.accent}`, borderRadius: 10, padding: "8px 6px", textAlign: "center", fontSize: 12, color: T.accent, fontWeight: 700, cursor: "pointer", fontFamily: font }}>{b}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 20px 32px", flexShrink: 0, borderTop: `1px solid ${T.border}` }}>
          {step < steps.length - 1
            ? <Btn onPress={() => setStep(step + 1)}>Next →</Btn>
            : (
              <Btn
                onPress={handlePublish}
                style={{
                  background: atLimit
                    ? `linear-gradient(135deg, ${T.accent}, #FF8050)`
                    : T.green,
                  opacity: publishing ? 0.7 : 1,
                }}
              >
                {publishing ? "Publishing…" : atLimit ? "Upgrade to Publish →" : "Publish Event"}
              </Btn>
            )
          }
        </div>

        {upgradeModal && (
          <UpgradeModal
            trigger={upgradeModal}
            onClose={() => setUpgradeModal(null)}
            onUpgrade={() => setUpgradeModal(null)}
          />
        )}
      </div>
    </PhoneShell>
  );
}
