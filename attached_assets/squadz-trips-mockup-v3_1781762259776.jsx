import React, { useState } from "react";
import {
  ChevronLeft, Plus, MapPin, Clock, Calendar, Users, Lock,
  DollarSign, Check, Home, Compass, MessageCircle, User,
  Sparkles, Utensils, Mountain, Bed, Car, Navigation, ChevronRight
} from "lucide-react";

// ── Brand tokens ───────────────────────────────────────────
const BG = "#0F0F14";
const SURFACE = "#17171F";
const SURFACE_2 = "#1F1F2A";
const LINE = "#2A2A36";
const TEXT = "#F4F2EE";
const MUTE = "#8B8B98";
const ORANGE = "#FF6B2C";
const GOLD = "#FFB23E";
const GREEN = "#5BD08A";
const GRAD = `linear-gradient(135deg, ${ORANGE} 0%, ${GOLD} 100%)`;
const display = { fontFamily: "'Syne', sans-serif" };
const body = { fontFamily: "'Inter', system-ui, sans-serif" };

const CAT = {
  food: { Icon: Utensils, c: "#FF8A5B" },
  activity: { Icon: Mountain, c: "#5BD08A" },
  stay: { Icon: Bed, c: "#7FA8FF" },
  travel: { Icon: Car, c: GOLD },
};

// ── Shared ─────────────────────────────────────────────────
function StatusBar({ dark }) {
  const col = dark ? "#1A1206" : TEXT;
  return (
    <div className="flex justify-between items-center px-6 pt-3 pb-1 text-xs" style={{ color: col }}>
      <span style={{ ...display, fontWeight: 700 }}>9:41</span>
      <div className="flex gap-1 items-center"><span>●●●</span><span>Wifi</span><span>100%</span></div>
    </div>
  );
}
function Tag({ children, accent }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
      style={accent ? { background: GRAD, color: "#1A1206" } : { background: SURFACE_2, color: MUTE, border: `1px solid ${LINE}` }}>{children}</span>
  );
}
function PlusTag() {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold inline-flex items-center gap-0.5"
      style={{ background: "rgba(255,178,62,0.14)", color: GOLD }}><Lock size={9} /> Squadz+</span>
  );
}
function BottomNav() {
  const items = [
    { label: "Home", Icon: Home }, { label: "Vibe", Icon: Compass },
    { label: "SquadZ", Icon: Users, on: true }, { label: "Chat", Icon: MessageCircle }, { label: "Me", Icon: User },
  ];
  return (
    <div className="flex justify-around items-center pt-2 pb-5 px-2" style={{ borderTop: `1px solid ${LINE}`, background: BG }}>
      {items.map(({ label, Icon, on }) => (
        <div key={label} className="flex flex-col items-center gap-1" style={{ width: 56 }}>
          <Icon size={20} color={on ? ORANGE : MUTE} strokeWidth={on ? 2.4 : 2} />
          <span className="text-[10px]" style={{ ...body, color: on ? TEXT : MUTE, fontWeight: on ? 600 : 400 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}
function Field({ label, value, Icon, hint }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider mb-2" style={{ ...body, color: MUTE }}>{label}</div>
      <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
        {Icon && <Icon size={15} color={ORANGE} />}
        <span className="text-sm" style={{ ...body, color: value ? TEXT : MUTE }}>{value || hint}</span>
      </div>
    </div>
  );
}

// ── 1. Trips list ──────────────────────────────────────────
function TripsList({ go }) {
  const trips = [
    { name: "Tahoe Cabin Weekend", squad: "The Usual Suspects", dates: "Jul 18 – 20", stops: 9, people: 6, cover: GRAD, live: true },
    { name: "Lisbon in October", squad: "Travel Crew", dates: "Oct 3 – 10", stops: 14, people: 4, cover: "linear-gradient(135deg,#3A6EA5,#6FB1FC)" },
  ];
  return (
    <div className="flex flex-col h-full" style={{ background: BG }}>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest" style={{ ...body, color: MUTE }}>SquadZ</div>
          <h1 className="text-2xl" style={{ ...display, color: TEXT, fontWeight: 800 }}>Trips</h1>
        </div>
        <button onClick={() => go("start")} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: GRAD }}>
          <Plus size={20} color="#1A1206" strokeWidth={2.6} />
        </button>
      </div>
      <div className="px-5 flex gap-2 mb-4">
        {["Trips", "Events", "Past"].map((t, i) => (
          <span key={t} className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={i === 0 ? { background: SURFACE_2, color: TEXT, border: `1px solid ${ORANGE}` } : { color: MUTE, border: `1px solid ${LINE}` }}>{t}</span>
        ))}
      </div>
      <div className="px-5 flex flex-col gap-3 overflow-y-auto flex-1">
        {trips.map((t) => (
          <button key={t.name} onClick={() => go("detail")} className="text-left rounded-2xl overflow-hidden" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
            <div className="h-20 w-full relative" style={{ background: t.cover }}>
              <div className="absolute top-2 right-2"><Tag>{t.dates}</Tag></div>
              {t.live && <div className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1" style={{ background: "#1A1206", color: GREEN }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: GREEN }} />Happening now</div>}
            </div>
            <div className="p-3.5">
              <div className="text-base" style={{ ...display, color: TEXT, fontWeight: 700 }}>{t.name}</div>
              <div className="text-xs mt-0.5" style={{ ...body, color: MUTE }}>{t.squad}</div>
              <div className="flex gap-4 mt-3 text-xs" style={{ ...body, color: MUTE }}>
                <span className="flex items-center gap-1"><MapPin size={13} color={ORANGE} /> {t.stops} stops</span>
                <span className="flex items-center gap-1"><Users size={13} color={ORANGE} /> {t.people} going</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <BottomNav />
    </div>
  );
}

// ── 2. Start: blank or template ────────────────────────────
function StartChoice({ go }) {
  const templates = [
    { name: "Ski trip", stops: 11, grad: "linear-gradient(135deg,#7FA8FF,#C9DBFF)", Icon: Mountain },
    { name: "Beach week", stops: 9, grad: "linear-gradient(135deg,#FFB23E,#FFE3A1)", Icon: Sparkles },
    { name: "City break", stops: 13, grad: "linear-gradient(135deg,#B07BFF,#E0C9FF)", Icon: MapPin },
    { name: "Road trip", stops: 8, grad: "linear-gradient(135deg,#FF6B2C,#FFA15B)", Icon: Car },
  ];
  return (
    <div className="flex flex-col h-full" style={{ background: BG }}>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 flex items-center gap-3">
        <button onClick={() => go("list")}><ChevronLeft size={24} color={TEXT} /></button>
        <h1 className="text-lg" style={{ ...display, color: TEXT, fontWeight: 700 }}>Start a plan</h1>
      </div>
      <div className="px-5 flex flex-col gap-3 overflow-y-auto flex-1">
        <button onClick={() => go("create")} className="rounded-2xl p-4 flex items-center justify-between" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: GRAD }}><Plus size={20} color="#1A1206" strokeWidth={2.6} /></div>
            <div className="text-left">
              <div className="text-sm" style={{ ...display, color: TEXT, fontWeight: 700 }}>Start blank</div>
              <div className="text-[11px]" style={{ ...body, color: MUTE }}>Build it stop by stop</div>
            </div>
          </div>
          <ChevronRight size={18} color={MUTE} />
        </button>
        <div className="flex items-center justify-between mt-2 mb-1">
          <span className="text-[11px] uppercase tracking-widest" style={{ ...body, color: MUTE }}>Templates</span>
          <PlusTag />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {templates.map((t) => (
            <button key={t.name} onClick={() => go("create")} className="rounded-2xl overflow-hidden text-left relative" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
              <div className="h-16 flex items-center justify-center" style={{ background: t.grad }}><t.Icon size={22} color="#1A1206" /></div>
              <div className="p-2.5">
                <div className="text-xs" style={{ ...display, color: TEXT, fontWeight: 700 }}>{t.name}</div>
                <div className="text-[10px]" style={{ ...body, color: MUTE }}>{t.stops} stops preloaded</div>
              </div>
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}><Lock size={10} color={GOLD} /></div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-center mt-1" style={{ ...body, color: MUTE }}>Templates fill the itinerary so you only edit, not start from scratch.</p>
      </div>
    </div>
  );
}

// ── 3. Create trip (date range) ────────────────────────────
function CreateTrip({ go }) {
  return (
    <div className="flex flex-col h-full" style={{ background: BG }}>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 flex items-center gap-3">
        <button onClick={() => go("start")}><ChevronLeft size={24} color={TEXT} /></button>
        <h1 className="text-lg" style={{ ...display, color: TEXT, fontWeight: 700 }}>New plan</h1>
      </div>
      <div className="px-5 mb-5">
        <div className="flex rounded-xl p-1" style={{ background: SURFACE }}>
          {[{ t: "Event", s: "One day + time" }, { t: "Trip", s: "Multiple days", on: true }].map((o) => (
            <div key={o.t} className="flex-1 rounded-lg py-2.5 text-center" style={o.on ? { background: GRAD } : {}}>
              <div className="text-sm" style={{ ...display, fontWeight: 700, color: o.on ? "#1A1206" : TEXT }}>{o.t}</div>
              <div className="text-[10px]" style={{ ...body, color: o.on ? "#3A2A0C" : MUTE }}>{o.s}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 flex flex-col gap-3 flex-1 overflow-y-auto">
        <Field label="Trip name" value="Tahoe Cabin Weekend" />
        <Field label="Squad" value="The Usual Suspects" Icon={Users} />
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-2" style={{ ...body, color: MUTE }}>Dates</div>
          <div className="flex gap-2">
            {[{ l: "Starts", v: "Fri, Jul 18" }, { l: "Ends", v: "Sun, Jul 20" }].map((d) => (
              <div key={d.l} className="flex-1 rounded-xl p-3" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
                <div className="text-[10px]" style={{ ...body, color: MUTE }}>{d.l}</div>
                <div className="flex items-center gap-1.5 mt-1"><Calendar size={14} color={ORANGE} /><span className="text-sm" style={{ ...display, color: TEXT, fontWeight: 600 }}>{d.v}</span></div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs" style={{ ...body, color: MUTE }}>
            <span className="w-9 h-5 rounded-full flex items-center px-0.5" style={{ background: SURFACE_2 }}><span className="w-4 h-4 rounded-full" style={{ background: MUTE }} /></span>
            All-day · set times on each stop
          </div>
        </div>
        <Field label="Where" value="South Lake Tahoe, CA" Icon={MapPin} />
      </div>
      <div className="px-5 pb-6 pt-2">
        <button onClick={() => go("detail")} className="w-full py-3.5 rounded-xl text-center" style={{ background: GRAD, ...display, fontWeight: 700, color: "#1A1206" }}>Create trip</button>
      </div>
    </div>
  );
}

// ── 4. Itinerary detail (no map) ───────────────────────────
function TripDetail({ go }) {
  const days = [
    { label: "Friday, Jul 18", stops: [
      { time: "4:00 PM", title: "Arrive + check in", place: "Lakeside Cabin", addr: "1100 Ski Run Blvd, South Lake Tahoe", cat: "stay", status: "set", who: "All" },
      { time: "7:30 PM", title: "Group dinner", place: "Riva Grill", addr: "900 Ski Run Blvd", cat: "food", status: "set", cost: "$38", who: "Maya booked", details: "Reservation under Maya, table for 6" },
    ]},
    { label: "Saturday, Jul 19", stops: [
      { time: "9:00 AM", range: "9:00 – 11:30 AM", title: "Kayak rental", place: "Tahoe Watersports", addr: "3411 Lake Tahoe Blvd", cat: "activity", status: "vote", votes: 4, cost: "$25", details: "Bring water shoes · deposit due on arrival" },
      { time: "1:00 PM", title: "Lunch on the beach", place: "Pack a cooler", cat: "food", status: "set", who: "Devon" },
    ]},
  ];
  return (
    <div className="flex flex-col h-full" style={{ background: BG }}>
      <StatusBar dark />
      <div className="relative h-24" style={{ background: GRAD, marginTop: -28 }}>
        <div style={{ height: 28 }} />
        <button onClick={() => go("list")} className="absolute top-8 left-4"><ChevronLeft size={24} color="#1A1206" /></button>
        <button onClick={() => go("today")} className="absolute top-8 right-4 text-[11px] px-2.5 py-1 rounded-full font-bold" style={{ background: "#1A1206", color: GREEN }}>Today ›</button>
        <div className="absolute bottom-3 left-5">
          <h1 className="text-xl" style={{ ...display, color: "#1A1206", fontWeight: 800 }}>Tahoe Cabin Weekend</h1>
          <div className="text-xs" style={{ ...body, color: "#3A2A0C", fontWeight: 600 }}>Jul 18 – 20 · 6 going · The Usual Suspects</div>
        </div>
      </div>
      <div className="flex px-5 gap-5 pt-3 items-center" style={{ borderBottom: `1px solid ${LINE}` }}>
        {["Itinerary", "Budget", "Packing"].map((t, i) => (
          <span key={t} className="text-sm pb-2.5" style={{ ...display, fontWeight: 700, color: i === 0 ? TEXT : MUTE, borderBottom: i === 0 ? `2px solid ${ORANGE}` : "2px solid transparent" }}>{t}</span>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-5 pt-4">
        {days.map((d) => (
          <div key={d.label} className="mb-5">
            <div className="text-[11px] uppercase tracking-widest mb-3" style={{ ...body, color: MUTE, fontWeight: 600 }}>{d.label}</div>
            <div className="flex flex-col gap-2.5">
              {d.stops.map((s, idx) => {
                const cat = CAT[s.cat];
                return (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center pt-1" style={{ width: 46 }}>
                      <span className="text-[11px]" style={{ ...display, color: TEXT, fontWeight: 700 }}>{s.time.split(" ")[0]}</span>
                      <span className="text-[9px]" style={{ ...body, color: MUTE }}>{s.time.split(" ")[1]}</span>
                      {idx < d.stops.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: LINE }} />}
                    </div>
                    <div className="flex-1 rounded-xl p-3 mb-1" style={{ background: SURFACE, border: `1px solid ${s.status === "vote" ? "rgba(255,178,62,0.4)" : LINE}` }}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center mt-0.5" style={{ background: SURFACE_2 }}><cat.Icon size={14} color={cat.c} /></div>
                          <div>
                            <div className="text-sm" style={{ ...display, color: TEXT, fontWeight: 700 }}>{s.title}</div>
                            <div className="flex items-center gap-1 mt-0.5 text-xs" style={{ ...body, color: MUTE }}><MapPin size={11} color={MUTE} />{s.place}</div>
                            {s.addr && <div className="text-[11px] mt-0.5 pl-4" style={{ ...body, color: MUTE, opacity: 0.75 }}>{s.addr}</div>}
                          </div>
                        </div>
                        {s.status === "set"
                          ? <span className="flex items-center gap-1 text-[10px]" style={{ color: GREEN }}><Check size={12} />Set</span>
                          : <Tag accent>Voting</Tag>}
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 text-[11px] pl-9" style={{ ...body, color: MUTE }}>
                        {s.range && <span className="flex items-center gap-1"><Clock size={11} color={MUTE} />{s.range}</span>}
                        {s.cost && <span className="flex items-center gap-1"><DollarSign size={11} color={GOLD} />{s.cost}/person</span>}
                        {s.who && <span className="flex items-center gap-1"><User size={11} />{s.who}</span>}
                        {s.votes && <span className="flex items-center gap-1" style={{ color: GOLD }}><Check size={11} />{s.votes} in</span>}
                      </div>
                      {s.details && <div className="text-[11px] mt-1.5 pl-9 leading-snug" style={{ ...body, color: MUTE }}>{s.details}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-6 pt-1">
        <button onClick={() => go("addstop")} className="w-full py-3 rounded-xl flex items-center justify-center gap-2" style={{ background: SURFACE_2, border: `1px solid ${LINE}`, ...display, fontWeight: 700, color: TEXT }}>
          <Plus size={18} color={ORANGE} /> Add stop
        </button>
      </div>
    </div>
  );
}

// ── 5. Add stop (category, optional end time, vote toggle off) ─
function AddStop({ go }) {
  const [cat, setCat] = useState("activity");
  const [vote, setVote] = useState(false);
  const cats = [["activity", "Activity"], ["food", "Food"], ["stay", "Stay"], ["travel", "Travel"]];
  return (
    <div className="flex flex-col h-full relative" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="flex-1" onClick={() => go("detail")} />
      <div className="rounded-t-3xl pt-2 pb-6 px-5 overflow-y-auto" style={{ background: SURFACE, border: `1px solid ${LINE}`, maxHeight: "92%" }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: LINE }} />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg" style={{ ...display, color: TEXT, fontWeight: 800 }}>Add a stop</h2>
          <span className="text-xs" style={{ ...body, color: MUTE }}>Saturday, Jul 19</span>
        </div>
        <div className="flex gap-2 mb-4">
          {cats.map(([k, label]) => {
            const C = CAT[k]; const on = cat === k;
            return (
              <button key={k} onClick={() => setCat(k)} className="flex-1 rounded-xl py-2.5 flex flex-col items-center gap-1"
                style={{ background: on ? SURFACE_2 : "transparent", border: `1px solid ${on ? C.c : LINE}` }}>
                <C.Icon size={16} color={on ? C.c : MUTE} />
                <span className="text-[10px]" style={{ ...body, color: on ? TEXT : MUTE, fontWeight: on ? 600 : 400 }}>{label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3">
          <Field label="What" value="Sunset hike at Eagle Falls" />
          {/* start + optional end time */}
          <div className="flex gap-2">
            <div className="flex-1"><Field label="Starts" value="5:30 PM" Icon={Clock} /></div>
            <div className="flex-1"><Field label="Ends · optional" value="7:00 PM" Icon={Clock} /></div>
          </div>
          <Field label="Place" value="Eagle Falls Trailhead" Icon={MapPin} />
          <Field label="Address · optional" value="Emerald Bay Rd, South Lake Tahoe, CA" />
          <div>
            <div className="text-[11px] uppercase tracking-wider mb-2" style={{ ...body, color: MUTE }}>Details · optional</div>
            <div className="rounded-xl p-3" style={{ background: SURFACE, border: `1px solid ${LINE}`, minHeight: 60 }}>
              <span className="text-sm" style={{ ...body, color: TEXT }}>Park before 9am · 2 mi round trip · bring water shoes</span>
            </div>
          </div>
          <Field label="Cost / person · optional" hint="Free" Icon={DollarSign} />
          {/* creator's choice — defaults OFF (add directly) */}
          <button onClick={() => setVote(!vote)} className="rounded-xl p-3 flex items-center justify-between mt-1 text-left"
            style={{ background: SURFACE_2, border: `1px solid ${vote ? "rgba(255,178,62,0.4)" : LINE}` }}>
            <div>
              <div className="text-sm" style={{ ...display, color: TEXT, fontWeight: 600 }}>Let the squad vote</div>
              <div className="text-[11px]" style={{ ...body, color: MUTE }}>{vote ? "On — adds as a proposed stop" : "Off — adds it directly as confirmed"}</div>
            </div>
            <span className="w-11 h-6 rounded-full flex items-center px-0.5" style={{ background: vote ? GRAD : LINE, justifyContent: vote ? "flex-end" : "flex-start" }}>
              <span className="w-5 h-5 rounded-full" style={{ background: vote ? "#fff" : MUTE }} />
            </span>
          </button>
        </div>
        <button onClick={() => go("detail")} className="w-full py-3.5 rounded-xl text-center mt-5" style={{ background: GRAD, ...display, fontWeight: 700, color: "#1A1206" }}>
          {vote ? "Propose to squad" : "Add to itinerary"}
        </button>
      </div>
    </div>
  );
}

// ── 6. Today / live view ───────────────────────────────────
function TodayView({ go }) {
  const rest = [
    { time: "1:00 PM", title: "Lunch on the beach", cat: "food", place: "Cooler — Devon" },
    { time: "5:30 PM", title: "Sunset hike", cat: "activity", place: "Eagle Falls · 5:30 – 7:00 PM" },
    { time: "8:00 PM", title: "Dinner reservation", cat: "food", place: "Riva Grill" },
  ];
  return (
    <div className="flex flex-col h-full" style={{ background: BG }}>
      <StatusBar />
      <div className="px-5 pt-2 pb-3 flex items-center gap-3">
        <button onClick={() => go("detail")}><ChevronLeft size={24} color={TEXT} /></button>
        <div>
          <div className="text-[11px] uppercase tracking-widest" style={{ ...body, color: GREEN }}>Today · Saturday</div>
          <h1 className="text-lg" style={{ ...display, color: TEXT, fontWeight: 800 }}>Tahoe, day 2</h1>
        </div>
      </div>
      <div className="px-5">
        <div className="rounded-2xl p-4" style={{ background: GRAD }}>
          <div className="text-[10px] uppercase tracking-widest" style={{ ...body, color: "#3A2A0C", fontWeight: 700 }}>Up next · 9:00 – 11:30 AM</div>
          <div className="text-lg mt-1" style={{ ...display, color: "#1A1206", fontWeight: 800 }}>Kayak rental</div>
          <div className="flex items-center gap-1 text-xs" style={{ ...body, color: "#3A2A0C", fontWeight: 600 }}><MapPin size={12} /> Tahoe Watersports · $25/person</div>
          <div className="flex gap-2 mt-3">
            <button className="flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5" style={{ background: "#1A1206", color: GOLD, ...display, fontWeight: 700, fontSize: 13 }}><Navigation size={14} /> Directions</button>
            <button className="flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5" style={{ background: "rgba(26,18,6,0.18)", color: "#1A1206", ...display, fontWeight: 700, fontSize: 13 }}><Check size={14} /> We're here</button>
          </div>
        </div>
      </div>
      <div className="px-5 pt-4 flex-1 overflow-y-auto">
        <div className="text-[11px] uppercase tracking-widest mb-2" style={{ ...body, color: MUTE }}>Later today</div>
        <div className="flex flex-col gap-2">
          {rest.map((s) => {
            const cat = CAT[s.cat];
            return (
              <div key={s.title} className="flex items-center gap-3 rounded-xl p-3" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
                <div className="text-right" style={{ width: 52 }}>
                  <div className="text-[11px]" style={{ ...display, color: TEXT, fontWeight: 700 }}>{s.time.split(" ")[0]}</div>
                  <div className="text-[9px]" style={{ ...body, color: MUTE }}>{s.time.split(" ")[1]}</div>
                </div>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: SURFACE_2 }}><cat.Icon size={14} color={cat.c} /></div>
                <div className="flex-1">
                  <div className="text-sm" style={{ ...display, color: TEXT, fontWeight: 700 }}>{s.title}</div>
                  <div className="text-[11px]" style={{ ...body, color: MUTE }}>{s.place}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-xl p-3 mt-3 flex items-center justify-between" style={{ background: "rgba(255,178,62,0.07)", border: `1px solid ${LINE}` }}>
          <span className="text-xs flex items-center gap-1.5" style={{ ...body, color: MUTE }}><DollarSign size={13} color={GOLD} /> Spent so far today</span>
          <span className="text-sm" style={{ ...display, color: TEXT, fontWeight: 700 }}>$25 / person</span>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

// ── Shell ──────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("list");
  const screens = [
    ["list", "1 · Trips"], ["start", "2 · Start"], ["create", "3 · Create"],
    ["detail", "4 · Itinerary"], ["addstop", "5 · Add stop"], ["today", "6 · Today"],
  ];
  const render = {
    list: <TripsList go={setScreen} />, start: <StartChoice go={setScreen} />, create: <CreateTrip go={setScreen} />,
    detail: <TripDetail go={setScreen} />, addstop: <AddStop go={setScreen} />, today: <TodayView go={setScreen} />,
  }[screen];

  return (
    <div className="min-h-screen w-full flex flex-col items-center py-8 px-4" style={{ background: "#08080C", ...body }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      <div className="mb-1 text-center">
        <span style={{ ...display, fontWeight: 800, color: TEXT, fontSize: 22 }}>squad</span>
        <span style={{ ...display, fontWeight: 800, fontSize: 22, color: ORANGE }}>Z</span>
        <span className="ml-2 text-sm" style={{ color: MUTE }}>· Trips flow</span>
      </div>
      <div className="flex flex-wrap gap-2 justify-center mb-5 mt-3" style={{ maxWidth: 360 }}>
        {screens.map(([id, label]) => (
          <button key={id} onClick={() => setScreen(id)} className="text-xs px-3 py-1.5 rounded-full font-semibold"
            style={screen === id ? { background: GRAD, color: "#1A1206" } : { background: SURFACE, color: MUTE, border: `1px solid ${LINE}` }}>{label}</button>
        ))}
      </div>
      <div className="rounded-[2.5rem] p-2.5 shadow-2xl" style={{ background: "#000", border: `1px solid ${LINE}`, width: 340 }}>
        <div className="rounded-[2rem] overflow-hidden" style={{ height: 700, background: BG }}>{render}</div>
      </div>
      <p className="text-xs mt-5 max-w-xs text-center" style={{ color: MUTE }}>Six screens in flow order. On Add stop, tap the toggle to see the propose-to-vote choice. No map — locations are text.</p>
    </div>
  );
}
