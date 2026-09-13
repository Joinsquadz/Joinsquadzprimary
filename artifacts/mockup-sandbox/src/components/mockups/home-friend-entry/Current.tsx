import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Home,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Share2,
  Sparkles,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";

type Variant = "quick" | "header" | "module";

const orange = "#F26B3A";
const green = "#39C98A";
const bg = "#101113";
const panel = "#191B1F";
const line = "#2B2E34";
const muted = "#9297A2";

function Avatar({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-[#101113] ring-2 ring-[#191B1F]"
      style={{ background: color }}
    >
      {label}
    </span>
  );
}

function BottomNav() {
  const items = [
    { icon: Home, label: "Home", active: true },
    { icon: UsersRound, label: "Squadz" },
    { icon: CalendarDays, label: "Events" },
    { icon: MessageCircle, label: "Messages", badge: "2" },
    { icon: Sparkles, label: "Vibe" },
  ];
  return (
    <nav className="absolute bottom-0 left-0 right-0 z-10 flex h-[76px] items-center justify-around border-t border-[#2B2E34] bg-[#141619]/95 px-2 backdrop-blur">
      {items.map(({ icon: Icon, label, active, badge }) => (
        <button key={label} className="relative flex min-h-[52px] min-w-[54px] flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold" style={{ color: active ? orange : muted }}>
          <Icon size={20} strokeWidth={active ? 2.6 : 1.8} />
          <span>{label}</span>
          {badge && <span className="absolute right-1 top-0 rounded-full bg-[#E85D4A] px-1.5 text-[9px] font-bold text-white">{badge}</span>}
        </button>
      ))}
    </nav>
  );
}

function HomeHeader({ variant, onAdd }: { variant: Variant; onAdd: () => void }) {
  return (
    <header className="flex items-start justify-between px-5 pb-4 pt-7">
      <div>
        <p className="text-[13px] font-medium text-[#9297A2]">Tuesday, June 17</p>
        <h2 className="mt-1 text-[25px] font-extrabold tracking-[-0.04em] text-[#F6F2EA]">Hey, Maya</h2>
        <p className="mt-1 text-[12px] text-[#9297A2]">2 squads · 1 plan this week</p>
      </div>
      <div className="flex items-center gap-2">
        <button aria-label="Activity" className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[#2B2E34] bg-[#191B1F] text-[#E9E5DC]">
          <Bell size={19} />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#F26B3A]" />
        </button>
        <button aria-label="Open profile" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#D6A76B] text-[12px] font-extrabold text-[#151617]">MA</button>
      </div>
      {variant === "header" && (
        <button onClick={onAdd} aria-label="Add friend" className="absolute right-5 top-[112px] flex min-h-[44px] items-center gap-2 rounded-full border border-[#F26B3A]/40 bg-[#F26B3A]/10 px-3.5 text-[12px] font-bold text-[#FF946F]">
          <UserPlus size={16} /> Add friend
        </button>
      )}
    </header>
  );
}

function QuickActions({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-5">
      <button className="flex min-h-[76px] flex-col items-start justify-center rounded-2xl border border-[#F26B3A]/30 bg-[#F26B3A]/10 px-4 text-left">
        <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F26B3A]/20 text-[#FF946F]"><Clock3 size={16} /></span>
        <span className="text-[13px] font-extrabold text-[#F6F2EA]">Find a time</span>
        <span className="text-[10px] text-[#AAAEB6]">When&apos;s everyone free?</span>
      </button>
      <button onClick={onInvite} className="flex min-h-[76px] flex-col items-start justify-center rounded-2xl border border-[#39C98A]/30 bg-[#39C98A]/10 px-4 text-left">
        <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-lg bg-[#39C98A]/20 text-[#65DCA8]"><Send size={15} /></span>
        <span className="text-[13px] font-extrabold text-[#F6F2EA]">Invite crew</span>
        <span className="text-[10px] text-[#AAAEB6]">Share a plan invite</span>
      </button>
    </div>
  );
}

function UpNext() {
  return (
    <section className="mx-5 mt-4 rounded-[22px] bg-gradient-to-br from-[#F26B3A] to-[#D9513B] p-5 text-[#fff7f1] shadow-[0_14px_34px_rgba(242,107,58,0.14)]">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]">Up next</span>
        <MoreHorizontal size={19} className="opacity-70" />
      </div>
      <h3 className="mt-5 text-[21px] font-extrabold tracking-[-0.03em]">Rooftop tacos</h3>
      <p className="mt-1 text-[12px] text-white/75">Friday · 7:30 PM · Mission District</p>
      <div className="mt-5 flex items-center">
        <div className="flex -space-x-2">
          <Avatar label="MA" color="#D6A76B" /><Avatar label="JL" color="#8FD0C0" /><Avatar label="RK" color="#F0B85C" />
        </div>
        <span className="ml-3 text-[11px] font-semibold text-white/80">3 going</span>
        <button className="ml-auto flex min-h-[40px] items-center gap-1 rounded-full bg-white/15 px-3 text-[11px] font-bold"><ChevronRight size={14} /> View</button>
      </div>
    </section>
  );
}

function FriendModule({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="mx-5 mt-4 rounded-2xl border border-[#2B2E34] bg-[#191B1F] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[15px] font-extrabold text-[#F6F2EA]">Your people</p>
          <p className="mt-0.5 text-[11px] text-[#9297A2]">3 friends on SquadZ</p>
        </div>
        <button onClick={onAdd} className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#F26B3A]/12 px-3 text-[12px] font-bold text-[#FF946F]"><UserPlus size={16} /> Add friend</button>
      </div>
      <div className="mt-4 flex items-center">
        <div className="flex -space-x-2"><Avatar label="JL" color="#8FD0C0" /><Avatar label="RK" color="#F0B85C" /><Avatar label="TS" color="#B89AE6" /></div>
        <button onClick={onAdd} className="ml-auto flex min-h-[44px] items-center gap-1 text-[12px] font-bold text-[#9297A2]">Manage friends <ChevronRight size={15} /></button>
      </div>
    </section>
  );
}

function EmptyPeople({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="mx-5 mt-4 rounded-2xl border border-dashed border-[#3D4149] bg-[#17191C] p-4">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#39C98A]/12 text-[#65DCA8]"><Users size={19} /></div>
        <div className="flex-1">
          <p className="text-[14px] font-extrabold text-[#F6F2EA]">Bring your people in</p>
          <p className="mt-1 text-[11px] leading-4 text-[#9297A2]">Add friends by code, then plan around the people who matter.</p>
        </div>
      </div>
      <button onClick={onAdd} className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#39C98A] text-[12px] font-extrabold text-[#10231C]"><UserPlus size={16} /> Add your first friend</button>
    </section>
  );
}

function FriendScreen({ onBack, empty }: { onBack: () => void; empty?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-[#101113]">
      <header className="flex items-center gap-3 border-b border-[#2B2E34] px-4 pb-4 pt-7">
        <button onClick={onBack} aria-label="Back to home" className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2B2E34] bg-[#191B1F] text-[#F6F2EA]"><ArrowLeft size={19} /></button>
        <div><p className="text-[17px] font-extrabold text-[#F6F2EA]">Friends</p><p className="text-[11px] text-[#9297A2]">{empty ? "Start your circle" : "Your SquadZ people"}</p></div>
      </header>
      <main className="px-5 pb-8 pt-5">
        <section className="rounded-2xl border border-[#2B2E34] bg-[#191B1F] p-5">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#9297A2]">My friend code</p>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[28px] font-extrabold tracking-[0.12em] text-[#F6F2EA]">SQ-7K4M</p>
            <button onClick={() => setCopied(true)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F26B3A]/15 text-[#FF946F]" aria-label="Copy friend code">{copied ? <Check size={18} /> : <Copy size={18} />}</button>
          </div>
          <p className="mt-1 text-[12px] text-[#9297A2]">Share this code so friends can add you.</p>
          <button className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#F26B3A] text-[13px] font-extrabold text-white"><Share2 size={17} /> Share My Code</button>
        </section>
        <div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-[#2B2E34]" /><span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#656A74]">Connect</span><span className="h-px flex-1 bg-[#2B2E34]" /></div>
        <section>
          <p className="mb-2 text-[13px] font-extrabold text-[#F6F2EA]">Enter friend code</p>
          <div className="flex min-h-[54px] items-center rounded-xl border border-[#3B3F47] bg-[#191B1F] px-4">
            <Search size={17} className="text-[#777D88]" /><span className="ml-3 flex-1 text-[13px] text-[#777D88]">SQ-XXXX</span><button className="flex min-h-[44px] items-center rounded-lg bg-[#2A2D33] px-4 text-[12px] font-bold text-[#BFC3CB]">Add</button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-[#777D88]">Ask a friend for their code, or send them yours above.</p>
        </section>
        <section className="mt-7">
          <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#9297A2]">Friends · {empty ? "0" : "3"}</p>
          {empty ? <div className="rounded-2xl border border-dashed border-[#3D4149] p-6 text-center"><Users size={25} className="mx-auto text-[#656A74]" /><p className="mt-3 text-[14px] font-bold text-[#D8D5CD]">No friends yet</p><p className="mt-1 text-[11px] text-[#9297A2]">Your new connections will show up here.</p></div> : <div className="space-y-2">{[["JL", "Jordan Lee", "#8FD0C0"], ["RK", "Riley Kim", "#F0B85C"], ["TS", "Theo Singh", "#B89AE6"]].map(([initials, name, color]) => <div key={name} className="flex min-h-[62px] items-center gap-3 rounded-xl border border-[#2B2E34] bg-[#191B1F] px-3"><Avatar label={initials} color={color} /><div className="flex-1"><p className="text-[13px] font-bold text-[#F6F2EA]">{name}</p><p className="text-[11px] text-[#9297A2]">SquadZ friend</p></div><MessageCircle size={18} className="text-[#9297A2]" /></div>)}</div>}
        </section>
      </main>
    </div>
  );
}

function Phone({ variant, onInvite }: { variant: Variant; onInvite: () => void }) {
  const [friendsOpen, setFriendsOpen] = useState(false);
  const empty = variant === "header";
  return (
    <div className="relative h-[844px] w-[390px] shrink-0 overflow-hidden rounded-[34px] border-[7px] border-[#25272B] bg-[#101113] shadow-2xl shadow-black/40">
      <div className="h-full overflow-y-auto pb-24">
        <HomeHeader variant={variant} onAdd={() => setFriendsOpen(true)} />
        {variant === "quick" && <div className="relative"><QuickActions onInvite={onInvite} /><button onClick={() => setFriendsOpen(true)} aria-label="Add friend" className="absolute right-5 top-[91px] flex h-11 w-11 items-center justify-center rounded-full border border-[#F26B3A]/40 bg-[#F26B3A]/15 text-[#FF946F] shadow-lg"><UserPlus size={18} /></button></div>}
        {variant !== "quick" && <QuickActions onInvite={onInvite} />}
        <UpNext />
        {variant === "module" ? <FriendModule onAdd={() => setFriendsOpen(true)} /> : empty ? <EmptyPeople onAdd={() => setFriendsOpen(true)} /> : <button onClick={() => setFriendsOpen(true)} className="mx-5 mt-4 flex min-h-[48px] w-[calc(100%-40px)] items-center justify-center gap-2 rounded-xl border border-[#2B2E34] text-[12px] font-bold text-[#AEB2BA]"><Users size={16} /> Manage friends</button>}
        <div className="mx-5 mt-5 flex items-center gap-3 rounded-2xl border border-[#2B2E34] bg-[#191B1F] p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F26B3A]/12 text-[#FF946F]"><Plus size={19} /></div><div className="flex-1"><p className="text-[14px] font-extrabold text-[#F6F2EA]">Make a plan</p><p className="text-[11px] text-[#9297A2]">Turn a free night into something real.</p></div><ChevronRight size={18} className="text-[#656A74]" /></div>
      </div>
      <BottomNav />
      {friendsOpen && <FriendScreen empty={empty} onBack={() => setFriendsOpen(false)} />}
    </div>
  );
}

function Notes({ title, body, recommended }: { title: string; body: string; recommended?: boolean }) {
  return <div className={`w-[390px] rounded-2xl border p-4 ${recommended ? "border-[#F26B3A]/60 bg-[#F26B3A]/10" : "border-[#2B2E34] bg-[#17191C]"}`}><div className="flex items-center justify-between"><p className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-[#D9D6CE]">{title}</p>{recommended && <span className="rounded-full bg-[#F26B3A] px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider text-white">Recommended</span>}</div><p className="mt-2 text-[12px] leading-5 text-[#9DA1AA]">{body}</p></div>;
}

export function QuickActionOption() {
  return <div className="flex flex-col gap-4"><Phone variant="quick" onInvite={() => undefined} /><Notes title="Quick-action treatment" body="Best for a populated home: the small orange people button keeps the canvas compact and preserves the familiar action rhythm. Visibility is lower and the icon needs a moment of discovery." /></div>;
}

export function HeaderLevelOption() {
  return <div className="flex flex-col gap-4"><Phone variant="header" onInvite={() => undefined} /><Notes title="Header-level treatment" body="The clearest first-use path: Add friend sits beside the greeting while the empty-state card explains why. It adds a little header crowding and competes with profile controls." /></div>;
}

export function PeopleModuleOption() {
  return <div className="flex flex-col gap-4"><Phone variant="module" onInvite={() => undefined} /><Notes title="Dedicated people module" recommended body="Recommended for Squadz: a calm, scalable home module gives friends a durable place without turning Home into a control panel. It distinguishes managing people from inviting a crew." /></div>;
}

export function HomeFriendEntry() {
  return (
    <main className="min-h-screen overflow-x-auto bg-[#0B0C0E] px-8 py-10 text-[#F6F2EA]">
      <div className="mx-auto w-fit">
        <div className="mb-8 flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#F26B3A]">Squadz · Home exploration</p><h1 className="mt-2 text-[30px] font-extrabold tracking-[-0.05em]">Three ways to find your people</h1><p className="mt-2 max-w-[640px] text-[13px] text-[#9297A2]">Add friend opens Friends management. Invite crew remains the social share action — never a shortcut to the friend form.</p></div><div className="hidden rounded-xl border border-[#2B2E34] bg-[#17191C] px-4 py-3 text-right md:block"><p className="text-[10px] font-bold uppercase tracking-widest text-[#656A74]">Tap test</p><p className="mt-1 text-[12px] font-semibold text-[#BFC3CB]">Every Add friend opens a companion screen</p></div></div>
        <div className="flex gap-6"><QuickActionOption /><HeaderLevelOption /><PeopleModuleOption /></div>
        <div className="mt-6 flex w-[390px] items-start gap-3 rounded-xl border border-[#2B2E34] bg-[#141619] p-4"><div className="mt-0.5 h-2 w-2 rounded-full bg-[#39C98A]" /><p className="text-[11px] leading-5 text-[#9297A2]"><span className="font-bold text-[#D9D6CE]">Shared rule:</span> Find a time creates a plan; Invite crew shares an invitation; Add friend manages connections. The companion screen includes My Friend Code, Share My Code, and Enter friend code in a lightweight Friends representation.</p></div>
      </div>
    </main>
  );
}

export default HomeFriendEntry;