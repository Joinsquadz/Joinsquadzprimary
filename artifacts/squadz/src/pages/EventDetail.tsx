import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar, Tag, SectionLabel, Card, Btn } from "@/components/shared";
import { T, font, fontMono, MEMBERS, FOOD_ITEMS as INIT_FOOD, EXPENSES, getAvatarColor } from "@/lib/data";

function EventOverviewTab() {
  const tasks = [
    { id: 1, label: "Book the rooftop", done: true, owner: "Marcus" },
    { id: 2, label: "Buy drinks ($38)", done: true, owner: "Jordan" },
    { id: 3, label: "Get ice", done: false, owner: "Jordan" },
    { id: 4, label: "Make a playlist", done: false, owner: null },
  ];
  const [done, setDone] = useState(new Set(tasks.filter(t => t.done).map(t => t.id)));
  return (
    <div>
      <SectionLabel>Members</SectionLabel>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, overflowX: "auto" }}>
        {MEMBERS.map(m => (
          <div key={m.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <Avatar name={m.name} size={40} />
              <div style={{ position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, background: m.status === "going" ? T.green : m.status === "maybe" ? T.gold : "#FF4444", border: `2px solid ${T.bg}` }} />
            </div>
            <div style={{ fontSize: 10, color: T.textDim, fontFamily: font }}>{m.name}</div>
          </div>
        ))}
      </div>
      <SectionLabel>Checklist</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {tasks.map(t => (
          <div key={t.id} onClick={() => { const s = new Set(done); s.has(t.id) ? s.delete(t.id) : s.add(t.id); setDone(s); }} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 12, padding: "11px 14px", border: `1px solid ${T.border}`, cursor: "pointer" }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: done.has(t.id) ? T.green : "transparent", border: done.has(t.id) ? "none" : `2px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#000", fontWeight: 800, flexShrink: 0 }}>
              {done.has(t.id) ? "✓" : ""}
            </div>
            <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: done.has(t.id) ? T.textDim : T.text, textDecoration: done.has(t.id) ? "line-through" : "none" }}>{t.label}</div>
            {t.owner && <Avatar name={t.owner} size={24} />}
          </div>
        ))}
        <Btn small variant="ghost" onPress={() => {}}>+ Add Task</Btn>
      </div>
      <SectionLabel>Event Details</SectionLabel>
      <Card>
        {[["📅", "Sat, Jun 7 · 5:00 PM – 10:00 PM"], ["📍", "Marcus's Place, 142 Oak St"], ["👥", "The Usual Suspects"], ["🔗", "getsquadz.com/event/xyz"]].map(([icon, val]) => (
          <div key={val} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.border}`, fontSize: 13, color: T.textSub, fontFamily: font }}>
            <span>{icon}</span><span style={{ flex: 1 }}>{val}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

function EventFoodTab() {
  const [items, setItems] = useState(INIT_FOOD);
  const claim = (id: number) => setItems(items.map(i => i.id === id ? { ...i, who: "You", claimed: true } : i));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionLabel>Who's Bringing What</SectionLabel>
        <div style={{ fontSize: 12, color: T.textSub }}>{items.filter(i => i.claimed).length}/{items.length} claimed</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {items.map(item => (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 14, padding: "12px 14px", border: `1px solid ${item.claimed ? T.border : T.gold + "50"}` }}>
            <span style={{ fontSize: 22 }}>{item.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{item.item}</div>
              <div style={{ fontSize: 12, marginTop: 2, color: item.claimed ? T.green : T.gold }}>{item.claimed ? `✓ ${item.who}` : "Unclaimed"}</div>
            </div>
            {!item.claimed && <Btn small variant="ghost" onPress={() => claim(item.id)} style={{ width: "auto", padding: "5px 12px" }}>Claim</Btn>}
          </div>
        ))}
      </div>
      <Btn variant="secondary" onPress={() => {}}>+ Add Item</Btn>
      <div style={{ marginTop: 10 }}><Btn variant="ghost" onPress={() => {}}>Share Food List</Btn></div>
    </div>
  );
}

function EventBudgetTab() {
  const total = 120, spent = 74;
  const pct = (spent / total) * 100;
  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text }}>Group Budget</div>
          <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 15, color: T.text }}>${spent} / ${total}</div>
        </div>
        <div style={{ background: T.surfaceHigh, borderRadius: 6, height: 8, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${T.green}, ${T.gold})`, borderRadius: 6, transition: "width 0.6s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textDim }}>
          <span>${total - spent} remaining</span>
          <span>~${Math.ceil(total / 7)}/person</span>
        </div>
      </Card>
      <SectionLabel>Expenses</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {EXPENSES.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 12, padding: "12px 14px", border: `1px solid ${T.border}` }}>
            {e.who ? <Avatar name={e.who} size={32} /> : <div style={{ width: 32, height: 32, borderRadius: 16, background: T.surfaceHigh, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>?</div>}
            <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{e.label}</div>
            <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 16, color: T.gold }}>${e.amt}</div>
          </div>
        ))}
      </div>
      <Btn onPress={() => {}}>+ Log Expense</Btn>
      <div style={{ marginTop: 10 }}><Btn variant="secondary" onPress={() => {}}>Settle via Venmo</Btn></div>
    </div>
  );
}

function EventPollsTab() {
  const [votes, setVotes] = useState<Record<string, number | null>>({ p1: null, p2: null });
  const polls = [
    { id: "p1", q: "What time should we start?", opts: [{ o: "4 PM", v: 2 }, { o: "5 PM", v: 4 }, { o: "6 PM", v: 1 }] },
    { id: "p2", q: "Music vibe?", opts: [{ o: "Hip-Hop", v: 3 }, { o: "House", v: 3 }, { o: "R&B", v: 1 }] },
  ];
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {polls.map(poll => {
          const total = poll.opts.reduce((a, o) => a + o.v, 0);
          const myVote = votes[poll.id];
          const maxV = Math.max(...poll.opts.map(o => o.v));
          return (
            <Card key={poll.id}>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 12 }}>{poll.q}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {poll.opts.map((opt, oi) => {
                  const pct = Math.round((opt.v / total) * 100);
                  const isVoted = myVote === oi;
                  const isWinner = opt.v === maxV;
                  return (
                    <div key={oi} onClick={() => setVotes({ ...votes, [poll.id]: oi })} style={{ cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13, fontFamily: font }}>
                        <span style={{ fontWeight: isVoted ? 700 : 500, color: isVoted ? T.accent : T.text }}>
                          {isVoted && "◆ "}{opt.o}
                          {isWinner && <span style={{ marginLeft: 6, fontSize: 10, background: T.goldDim, color: T.gold, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>LEAD</span>}
                        </span>
                        <span style={{ color: T.textDim }}>{pct}%</span>
                      </div>
                      <div style={{ background: T.surfaceHigh, borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: isVoted ? T.accent : T.textDim, borderRadius: 4, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {myVote === null && <div style={{ marginTop: 8, fontSize: 12, color: T.gold, fontFamily: font }}>Tap to vote</div>}
            </Card>
          );
        })}
        <Btn variant="secondary" onPress={() => {}}>+ Create Poll</Btn>
      </div>
    </div>
  );
}

function EventChatTab() {
  const [msg, setMsg] = useState("");
  const chats = [
    { who: "Marcus", text: "Excited for Saturday!", time: "2h ago", me: false },
    { who: "Kira", text: "Me too! I'll bring the veggie skewers", time: "1h ago", me: false },
    { who: "Jordan", text: "Can't wait! Anyone need a ride?", time: "45m ago", me: true },
    { who: "Tasha", text: "Yes please! I live on Oak St", time: "30m ago", me: false },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {chats.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: c.me ? "flex-end" : "flex-start" }}>
          {!c.me && <Avatar name={c.who} size={30} />}
          <div style={{ maxWidth: "70%" }}>
            {!c.me && <div style={{ fontSize: 11, color: T.textDim, marginBottom: 3, fontFamily: font }}>{c.who}</div>}
            <div style={{ background: c.me ? T.accent : T.surfaceUp, borderRadius: 14, padding: "9px 13px", fontSize: 14, color: c.me ? "#fff" : T.text, fontFamily: font }}>{c.text}</div>
            <div style={{ fontSize: 10, color: T.textDim, marginTop: 2, textAlign: c.me ? "right" : "left" }}>{c.time}</div>
          </div>
          {c.me && <Avatar name="Jordan" size={30} color={T.accent} />}
        </div>
      ))}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, background: T.surfaceUp, borderRadius: 22, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", padding: "9px 14px" }}>
          <input value={msg} onChange={e => setMsg(e.target.value)} placeholder="Say something…" style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
        </div>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: T.accent, border: "none", fontSize: 18, cursor: "pointer", color: "#fff" }}>↑</button>
      </div>
    </div>
  );
}

export default function EventDetail() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("overview");
  const [myRsvp, setMyRsvp] = useState("going");
  const tabs = ["overview", "food", "budget", "polls", "chat"];

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: `linear-gradient(160deg, ${T.accent}, #C83E22)`, padding: "16px 20px 18px", flexShrink: 0, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -40, top: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setLocation("/home")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>←</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setLocation("/event-settings")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>⚙️</button>
            <button style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>↗</button>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono }}>The Usual Suspects</div>
          <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, color: "#fff", margin: "4px 0" }}>Rooftop BBQ 🔥</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14, fontFamily: font }}>Sat, Jun 7 · 5:00 PM · Marcus's Place</div>
          <div style={{ display: "flex", gap: 12 }}>
            {[{ label: "Going", val: 5, color: T.green }, { label: "Maybe", val: 1, color: T.gold }, { label: "Can't", val: 1, color: "rgba(255,255,255,0.4)" }].map(r => (
              <div key={r.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "6px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: r.color, fontFamily: fontMono }}>{r.val}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: font }}>{r.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "10px 16px", background: T.surfaceUp, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {[["✓ Going", "going", T.green], ["? Maybe", "maybe", T.gold], ["✕ Can't", "cant", "#FF4444"]].map(([l, v, c]) => (
            <button key={v} onClick={() => setMyRsvp(v)} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1.5px solid ${myRsvp === v ? c : T.border}`, background: myRsvp === v ? c + "22" : "transparent", color: myRsvp === v ? c : T.textSub, fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>
          ))}
        </div>

        <div style={{ display: "flex", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, overflowX: "auto" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", padding: "10px 14px", color: tab === t ? T.accent : T.textDim, fontFamily: font, fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "capitalize", flexShrink: 0, borderBottom: `2px solid ${tab === t ? T.accent : "transparent"}` }}>{t}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "16px 18px 24px" }}>
            {tab === "overview" && <EventOverviewTab />}
            {tab === "food" && <EventFoodTab />}
            {tab === "budget" && <EventBudgetTab />}
            {tab === "polls" && <EventPollsTab />}
            {tab === "chat" && <EventChatTab />}
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
