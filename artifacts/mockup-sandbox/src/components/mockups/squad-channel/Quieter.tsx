export function Quieter() {
  const squadColor = "#E05C3A";
  const members = [
    { initials: "JM", name: "You", color: "#A855F7" },
    { initials: "SR", name: "Sarah", color: "#4A9EFF" },
    { initials: "TK", name: "Tom", color: "#2ECC8A" },
    { initials: "AL", name: "Alex", color: "#FFB547" },
    { initials: "+", name: "Add", color: "#E05C3A", isAdd: true },
  ];

  return (
    <div className="w-[390px] min-h-screen bg-[#0F0F0F] font-sans overflow-y-auto">
      {/* Flat nav header — events-style */}
      <div className="px-4 pt-14 pb-4 flex items-center gap-3 bg-[#0F0F0F] border-b border-[#1E1E1E]">
        <button className="w-9 h-9 flex items-center justify-center rounded-xl bg-[#1A1A1A] shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#ccc" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        {/* Color dot + squad info inline */}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[20px] shrink-0" style={{ backgroundColor: squadColor + "28" }}>
          🎮
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-bold text-white leading-tight truncate">Weekend Gamers</div>
          <div className="text-[12px] text-[#666] mt-0.5">4 members</div>
        </div>
        <button className="w-9 h-9 flex items-center justify-center rounded-xl bg-[#1A1A1A] shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="#aaa" strokeWidth="2"/><path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" stroke="#aaa" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Color accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${squadColor}, ${squadColor}44, transparent)` }} />

      {/* Scrollable content */}
      <div className="overflow-y-auto pb-24">
        {/* Find Best Time — kept prominent but slightly quieter */}
        <div className="px-4 pt-4">
          <button
            className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: `linear-gradient(135deg, ${squadColor}EE, ${squadColor}99)` }}
          >
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2l1.09 3.26L16 6l-1.91 2.87L15 12l-3-1.5L9 12l.91-3.13L8 6l2.91-.74L12 2z"/></svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-[15px] font-bold text-white">Find the Best Time</div>
              <div className="text-[11px] text-white/80">Poll the squad · see who's free</div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* Members — section label is quieter */}
        <div className="px-4 mt-5 mb-3">
          <span className="text-[11px] font-semibold text-[#555] uppercase tracking-wider">Members</span>
        </div>
        <div className="px-4 flex flex-wrap gap-2">
          {members.map((m) => (
            <div key={m.initials + m.name} className="flex flex-col items-center gap-1.5 py-3" style={{ width: "calc(20% - 7px)" }}>
              {m.isAdd ? (
                <div className="w-11 h-11 rounded-full border-2 border-dashed border-[#333] flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="#555" strokeWidth="2" strokeLinecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="#555" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
              ) : (
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-[14px]" style={{ backgroundColor: m.color }}>
                  {m.initials}
                </div>
              )}
              <span className={`text-[11px] font-medium text-center ${m.isAdd ? "text-[#555]" : "text-[#aaa]"}`}>{m.name}</span>
            </div>
          ))}
        </div>

        {/* Actions — events-style list with separators, no individual borders */}
        <div className="px-4 mt-5 mb-2">
          <span className="text-[11px] font-semibold text-[#555] uppercase tracking-wider">Squad</span>
        </div>
        <div className="mx-4 rounded-2xl border border-[#1E1E1E] bg-[#141414] overflow-hidden divide-y divide-[#1E1E1E]">
          {/* Group Chat */}
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-[#1A1A1A]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="flex-1 text-[15px] font-medium text-white">Group Chat</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {/* Squad Vault */}
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-[#1A1A1A]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#E05C3A" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="#E05C3A"/><path d="M21 15l-5-5L5 21" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="flex-1 text-[15px] font-medium text-white">Squad Vault</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {/* Invite */}
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-[#1A1A1A]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/><circle cx="9" cy="7" r="4" stroke="#E05C3A" strokeWidth="2"/><line x1="19" y1="8" x2="19" y2="14" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/><line x1="22" y1="11" x2="16" y2="11" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/></svg>
            <span className="flex-1 text-[15px] font-medium text-white">Invite friends</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* Events section */}
        <div className="px-4 mt-5 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#555] uppercase tracking-wider">Events</span>
            <button className="text-[12px] font-semibold text-[#E05C3A]">Plan one</button>
          </div>
        </div>
        <div className="mx-4 rounded-2xl border border-[#1E1E1E] bg-[#141414] overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="text-[22px]">🎮</span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-white">LAN Party Saturday</div>
              <div className="text-[12px] text-[#555] mt-0.5">Sat, Jun 21 · Mike's Place · 3 going</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>
      </div>
    </div>
  );
}
