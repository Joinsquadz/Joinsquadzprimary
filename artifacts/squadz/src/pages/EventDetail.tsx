import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { Avatar, Tag, SectionLabel, Card, SwitchToggle, Btn } from "@/components/shared";
import { T, font, fontMono, MEMBERS, FOOD_ITEMS as INIT_FOOD, EXPENSES } from "@/lib/data";

function EventOverviewTab() {
  const initTasks = [
    { id: 1, label: "Book the rooftop", done: true, owner: "Marcus" as string | null },
    { id: 2, label: "Buy drinks ($38)", done: true, owner: "Jordan" as string | null },
    { id: 3, label: "Get ice", done: false, owner: "Jordan" as string | null },
    { id: 4, label: "Make a playlist", done: false, owner: null as string | null },
  ];
  const [tasks, setTasks] = useState(initTasks);
  const [done, setDone] = useState(new Set(initTasks.filter(t => t.done).map(t => t.id)));
  const [newTask, setNewTask] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const addTask = () => {
    if (!newTask.trim()) return;
    const id = Math.max(...tasks.map(t => t.id)) + 1;
    setTasks([...tasks, { id, label: newTask.trim(), done: false, owner: "Jordan" }]);
    setNewTask(""); setShowAdd(false);
  };

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
        {showAdd && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input autoFocus value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Task name…" style={{ flex: 1, background: T.surfaceUp, border: `1.5px solid ${T.accent}`, borderRadius: 12, padding: "10px 12px", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <button onClick={addTask} style={{ background: T.accent, border: "none", borderRadius: 10, color: "#fff", padding: "10px 14px", fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add</button>
            <button onClick={() => { setShowAdd(false); setNewTask(""); }} style={{ background: "none", border: "none", color: T.textDim, fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
        )}
        {!showAdd && <Btn small variant="ghost" onPress={() => setShowAdd(true)}>+ Add Task</Btn>}
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
  const [newItem, setNewItem] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  const claim = (id: number) => setItems(items.map(i => i.id === id ? { ...i, who: "You", claimed: true } : i));
  const addItem = () => {
    if (!newItem.trim()) return;
    setItems([...items, { id: Date.now(), emoji: "🍽️", item: newItem.trim(), claimed: false, who: null }]);
    setNewItem(""); setShowAdd(false);
  };
  const handleShare = () => { setShareToast(true); setTimeout(() => setShareToast(false), 2500); };

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
        {showAdd && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input autoFocus value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} placeholder="e.g. Veggie burgers" style={{ flex: 1, background: T.surfaceUp, border: `1.5px solid ${T.accent}`, borderRadius: 12, padding: "10px 12px", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <button onClick={addItem} style={{ background: T.accent, border: "none", borderRadius: 10, color: "#fff", padding: "10px 14px", fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add</button>
            <button onClick={() => { setShowAdd(false); setNewItem(""); }} style={{ background: "none", border: "none", color: T.textDim, fontSize: 18, cursor: "pointer" }}>✕</button>
          </div>
        )}
      </div>
      {!showAdd && <Btn variant="secondary" onPress={() => setShowAdd(true)}>+ Add Item</Btn>}
      <div style={{ marginTop: 10, position: "relative" }}>
        {shareToast && (
          <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.text, fontFamily: font, marginBottom: 6, textAlign: "center" }}>
            📋 Food list copied — share it with your squad!
          </div>
        )}
        <Btn variant="ghost" onPress={handleShare}>Share Food List</Btn>
      </div>
    </div>
  );
}

function EventBudgetTab() {
  const [expenses, setExpenses] = useState(EXPENSES);
  const [showLog, setShowLog] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newAmt, setNewAmt] = useState("");
  const [venmoToast, setVenmoToast] = useState(false);
  const total = 120;
  const spent = expenses.reduce((sum, e) => sum + e.amt, 0);
  const pct = Math.min((spent / total) * 100, 100);

  const logExpense = () => {
    if (!newLabel.trim() || !newAmt) return;
    setExpenses([...expenses, { id: Date.now(), label: newLabel.trim(), amt: parseFloat(newAmt), who: "Jordan" }]);
    setNewLabel(""); setNewAmt(""); setShowLog(false);
  };
  const handleVenmo = () => { setVenmoToast(true); setTimeout(() => setVenmoToast(false), 2500); };

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
        {expenses.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 12, padding: "12px 14px", border: `1px solid ${T.border}` }}>
            {e.who ? <Avatar name={e.who} size={32} /> : <div style={{ width: 32, height: 32, borderRadius: 16, background: T.surfaceHigh, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>?</div>}
            <div style={{ flex: 1, fontFamily: font, fontWeight: 600, fontSize: 14, color: T.text }}>{e.label}</div>
            <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 16, color: T.gold }}>${e.amt}</div>
          </div>
        ))}
        {showLog && (
          <div style={{ background: T.surfaceUp, borderRadius: 14, border: `1px solid ${T.border}`, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontFamily: font, fontWeight: 700, color: T.text }}>Log an expense</div>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="What was it for?" style={{ background: T.surface, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <input type="number" value={newAmt} onChange={e => setNewAmt(e.target.value)} placeholder="Amount ($)" style={{ background: T.surface, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={logExpense} style={{ flex: 1, background: T.accent, border: "none", borderRadius: 10, color: "#fff", padding: "10px 0", fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Save</button>
              <button onClick={() => { setShowLog(false); setNewLabel(""); setNewAmt(""); }} style={{ flex: 1, background: T.surfaceHigh, border: "none", borderRadius: 10, color: T.textSub, padding: "10px 0", fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {!showLog && <Btn onPress={() => setShowLog(true)}>+ Log Expense</Btn>}
      <div style={{ marginTop: 10, position: "relative" }}>
        {venmoToast && (
          <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.text, fontFamily: font, marginBottom: 6, textAlign: "center" }}>
            💰 Venmo request link copied!
          </div>
        )}
        <Btn variant="secondary" onPress={handleVenmo}>Settle via Venmo</Btn>
      </div>
    </div>
  );
}

function EventPollsTab() {
  const initPolls = [
    { id: "p1", q: "What time should we start?", opts: [{ o: "4 PM", v: 2 }, { o: "5 PM", v: 4 }, { o: "6 PM", v: 1 }] },
    { id: "p2", q: "Music vibe?", opts: [{ o: "Hip-Hop", v: 3 }, { o: "House", v: 3 }, { o: "R&B", v: 1 }] },
  ];
  const [polls, setPolls] = useState(initPolls);
  const [votes, setVotes] = useState<Record<string, number | null>>({ p1: null, p2: null });
  const [showCreate, setShowCreate] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newOpts, setNewOpts] = useState(["", ""]);

  const createPoll = () => {
    const validOpts = newOpts.filter(o => o.trim()).map(o => ({ o: o.trim(), v: 0 }));
    if (!newQ.trim() || validOpts.length < 2) return;
    const id = `p${Date.now()}`;
    setPolls([...polls, { id, q: newQ.trim(), opts: validOpts }]);
    setVotes(v => ({ ...v, [id]: null }));
    setNewQ(""); setNewOpts(["", ""]); setShowCreate(false);
  };

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {polls.map(poll => {
          const total = poll.opts.reduce((a, o) => a + o.v, 0) || 1;
          const myVote = votes[poll.id] ?? null;
          const maxV = Math.max(...poll.opts.map(o => o.v));
          return (
            <Card key={poll.id}>
              <div style={{ fontFamily: font, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 12 }}>{poll.q}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {poll.opts.map((opt, oi) => {
                  const pct = Math.round((opt.v / total) * 100);
                  const isVoted = myVote === oi;
                  const isWinner = opt.v === maxV && maxV > 0;
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
        {showCreate && (
          <div style={{ background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16 }}>
            <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 12 }}>New Poll</div>
            <input value={newQ} onChange={e => setNewQ(e.target.value)} placeholder="Ask the squad something…" style={{ width: "100%", background: T.surface, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", color: T.text, fontFamily: font, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
            {newOpts.map((o, i) => (
              <input key={i} value={o} onChange={e => { const opts = [...newOpts]; opts[i] = e.target.value; setNewOpts(opts); }} placeholder={`Option ${i + 1}`} style={{ width: "100%", background: T.surface, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", color: T.text, fontFamily: font, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
            ))}
            {newOpts.length < 4 && (
              <button onClick={() => setNewOpts([...newOpts, ""])} style={{ background: "none", border: "none", color: T.accent, fontFamily: font, fontSize: 13, cursor: "pointer", marginBottom: 12, padding: 0 }}>+ Add option</button>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={createPoll} style={{ flex: 1, background: T.accent, border: "none", borderRadius: 10, color: "#fff", padding: "10px 0", fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Create Poll</button>
              <button onClick={() => { setShowCreate(false); setNewQ(""); setNewOpts(["", ""]); }} style={{ flex: 1, background: T.surfaceHigh, border: "none", borderRadius: 10, color: T.textSub, padding: "10px 0", fontFamily: font, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}
        {!showCreate && <Btn variant="secondary" onPress={() => setShowCreate(true)}>+ Create Poll</Btn>}
      </div>
    </div>
  );
}

function EventChatTab() {
  const [msg, setMsg] = useState("");
  const [chats, setChats] = useState([
    { who: "Marcus", text: "Excited for Saturday!", time: "2h ago", me: false },
    { who: "Kira", text: "Me too! I'll bring the veggie skewers", time: "1h ago", me: false },
    { who: "Jordan", text: "Can't wait! Anyone need a ride?", time: "45m ago", me: true },
    { who: "Tasha", text: "Yes please! I live on Oak St", time: "30m ago", me: false },
  ]);
  const send = () => {
    if (!msg.trim()) return;
    setChats([...chats, { who: "Jordan", text: msg.trim(), time: "now", me: true }]);
    setMsg("");
  };
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
          <input value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Say something…" style={{ flex: 1, background: "none", border: "none", color: T.text, fontFamily: font, fontSize: 14, outline: "none" }} />
        </div>
        <button onClick={send} style={{ width: 44, height: 44, borderRadius: 14, background: T.accent, border: "none", fontSize: 18, cursor: "pointer", color: "#fff" }}>↑</button>
      </div>
    </div>
  );
}

function EventAdminTab() {
  const [coAdmins, setCoAdmins] = useState<string[]>(["Marcus"]);
  const [showPicker, setShowPicker] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [hiddenFrom, setHiddenFrom] = useState<string[]>([]);
  const [showHidePicker, setShowHidePicker] = useState(false);
  const maxCo = 5;
  const eligible = MEMBERS.filter(m => m.name !== "Jordan" && !coAdmins.includes(m.name));

  return (
    <div>
      <div style={{ background: T.goldDim, border: `1px solid ${T.gold}40`, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Avatar name="Jordan" size={42} color={T.accent} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.gold }}>Jordan Kim</div>
          <div style={{ fontSize: 12, color: T.textSub }}>Event Creator</div>
        </div>
        <Tag color={T.gold}>👑 Admin</Tag>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <SectionLabel>Co-Admins ({coAdmins.length}/{maxCo})</SectionLabel>
        {coAdmins.length < maxCo && (
          <button onClick={() => { setShowPicker(!showPicker); setShowHidePicker(false); }} style={{ background: T.accent + "22", border: "none", color: T.accent, borderRadius: 10, padding: "4px 12px", fontFamily: font, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>+ Add</button>
        )}
      </div>
      {coAdmins.length === 0 && !showPicker && (
        <div style={{ fontSize: 13, color: T.textDim, fontFamily: font, marginBottom: 12 }}>No co-admins yet. Add up to {maxCo}.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
        {coAdmins.map(name => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, background: T.surface, borderRadius: 12, padding: "10px 14px", border: `1px solid ${T.border}` }}>
            <Avatar name={name} size={36} />
            <div style={{ flex: 1, fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>{name}</div>
            <Tag color={T.blue}>Co-Admin</Tag>
            <button onClick={() => setCoAdmins(coAdmins.filter(c => c !== name))} style={{ background: "none", border: "none", color: "#FF4444", fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>
      {showPicker && (
        <div style={{ background: T.surfaceUp, borderRadius: 14, border: `1px solid ${T.border}`, padding: "10px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: T.textSub, fontFamily: font, marginBottom: 8 }}>Select member to promote:</div>
          {eligible.length === 0
            ? <div style={{ fontSize: 13, color: T.textDim, fontFamily: font }}>All eligible members are co-admins.</div>
            : eligible.map((m, i) => (
              <div key={m.name} onClick={() => { setCoAdmins([...coAdmins, m.name]); setShowPicker(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i > 0 ? `1px solid ${T.border}` : "none", cursor: "pointer" }}>
                <Avatar name={m.name} size={32} />
                <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.text }}>{m.name}</div>
                <span style={{ fontSize: 13, color: T.accent, fontFamily: font, fontWeight: 700 }}>+ Add</span>
              </div>
            ))}
        </div>
      )}

      <div style={{ marginTop: 8, marginBottom: 8 }}><SectionLabel>Discovery</SectionLabel></div>
      <div style={{ background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`, padding: "14px 16px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: font, fontWeight: 700, fontSize: 14, color: T.text }}>Post to Public Discovery</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, lineHeight: 1.4 }}>Friends outside your squad can find and request to join</div>
          </div>
          <SwitchToggle on={isPublic} toggle={() => setIsPublic(p => !p)} />
        </div>
      </div>
      {isPublic && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 13, color: T.textSub, fontFamily: font, fontWeight: 600 }}>Hidden From ({hiddenFrom.length})</div>
            <button onClick={() => { setShowHidePicker(!showHidePicker); setShowPicker(false); }} style={{ background: "none", border: "none", color: T.textDim, fontSize: 12, fontFamily: font, cursor: "pointer" }}>+ Block user</button>
          </div>
          {hiddenFrom.length === 0 && !showHidePicker && (
            <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, marginBottom: 8 }}>Visible to all mutual friends</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: hiddenFrom.length ? 10 : 0 }}>
            {hiddenFrom.map(name => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 5, background: T.surfaceUp, borderRadius: 20, padding: "4px 10px 4px 6px", border: `1px solid ${T.border}` }}>
                <Avatar name={name} size={18} />
                <span style={{ fontFamily: font, fontSize: 12, color: T.text }}>{name}</span>
                <button onClick={() => setHiddenFrom(hiddenFrom.filter(h => h !== name))} style={{ background: "none", border: "none", color: T.textDim, fontSize: 12, cursor: "pointer", padding: 0, marginLeft: 2 }}>✕</button>
              </div>
            ))}
          </div>
          {showHidePicker && (
            <div style={{ background: T.surfaceUp, borderRadius: 14, border: `1px solid ${T.border}`, padding: "10px 14px", marginBottom: 12 }}>
              {MEMBERS.filter(m => m.name !== "Jordan" && !hiddenFrom.includes(m.name)).map((m, i) => (
                <div key={m.name} onClick={() => { setHiddenFrom([...hiddenFrom, m.name]); setShowHidePicker(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i > 0 ? `1px solid ${T.border}` : "none", cursor: "pointer" }}>
                  <Avatar name={m.name} size={32} />
                  <div style={{ flex: 1, fontFamily: font, fontSize: 14, color: T.text }}>{m.name}</div>
                  <span style={{ fontSize: 12, color: "#FF6B6B", fontFamily: font, fontWeight: 700 }}>Hide</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionLabel>Danger Zone</SectionLabel>
        <Btn variant="danger" onPress={() => {}}>Cancel Event</Btn>
      </div>
    </div>
  );
}

export default function EventDetail() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState("overview");
  const [myRsvp, setMyRsvp] = useState("going");
  const [shareToast, setShareToast] = useState(false);
  const tabs = ["overview", "food", "budget", "polls", "chat", "admin"];

  const handleShare = () => { setShareToast(true); setTimeout(() => setShareToast(false), 2500); };

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: `linear-gradient(160deg, ${T.accent}, #C83E22)`, padding: "16px 20px 18px", flexShrink: 0, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -40, top: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setLocation("/home")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>←</button>
            <div style={{ flex: 1 }} />
            <button onClick={() => setTab("admin")} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>⚙️</button>
            <button onClick={handleShare} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 10, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>↗</button>
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

        {shareToast && (
          <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 18px", fontSize: 13, color: T.text, fontFamily: font, zIndex: 999, whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
            🔗 Event link copied!
          </div>
        )}

        <div style={{ display: "flex", gap: 8, padding: "10px 16px", background: T.surfaceUp, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {[["✓ Going", "going", T.green], ["? Maybe", "maybe", T.gold], ["✕ Can't", "cant", "#FF4444"]].map(([l, v, c]) => (
            <button key={v} onClick={() => setMyRsvp(v)} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1.5px solid ${myRsvp === v ? c : T.border}`, background: myRsvp === v ? c + "22" : "transparent", color: myRsvp === v ? c : T.textSub, fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>
          ))}
        </div>

        <div style={{ display: "flex", background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0, overflowX: "auto" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", padding: "10px 12px", color: tab === t ? T.accent : T.textDim, fontFamily: font, fontWeight: 700, fontSize: 12, cursor: "pointer", textTransform: "capitalize", flexShrink: 0, borderBottom: `2px solid ${tab === t ? T.accent : "transparent"}` }}>
              {t === "admin" ? "👑 Admin" : t}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "16px 18px 24px" }}>
            {tab === "overview" && <EventOverviewTab />}
            {tab === "food" && <EventFoodTab />}
            {tab === "budget" && <EventBudgetTab />}
            {tab === "polls" && <EventPollsTab />}
            {tab === "chat" && <EventChatTab />}
            {tab === "admin" && <EventAdminTab />}
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
