export function Current() {
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
      {/* Hero */}
      <div style={{ backgroundColor: squadColor }} className="px-5 pb-6 pt-14 flex flex-col items-center relative">
        <button className="absolute top-10 left-4 p-2 text-white">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button className="absolute top-10 right-4 p-2 text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="white" strokeWidth="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="white" strokeWidth="2"/></svg>
        </button>
        <span className="text-[52px] mt-3 mb-2">🎮</span>
        <span className="text-[24px] font-extrabold text-white text-center">Weekend Gamers</span>
        <span className="text-[14px] text-white/80 mt-1">4 members</span>
      </div>

      {/* Content */}
      <div className="px-5 pt-5 pb-24 space-y-3">
        {/* Invite banner */}
        <div className="flex items-center gap-3 rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-[14px]">
          <div className="w-10 h-10 rounded-full bg-[#E05C3A]/20 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/><circle cx="9" cy="7" r="4" stroke="#E05C3A" strokeWidth="2"/><line x1="19" y1="8" x2="19" y2="14" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/><line x1="22" y1="11" x2="16" y2="11" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-extrabold text-white">Invite friends not on SquadZ</div>
            <div className="text-[12px] text-[#888] mt-0.5">Share an invite link to add them</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>

        {/* Public share banner */}
        <div className="flex items-center gap-3 rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-[14px]">
          <div className="w-10 h-10 rounded-full bg-[#E05C3A]/20 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#E05C3A" strokeWidth="2"/><line x1="2" y1="12" x2="22" y2="12" stroke="#E05C3A" strokeWidth="2"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" stroke="#E05C3A" strokeWidth="2"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-extrabold text-white">Share publicly</div>
            <div className="text-[12px] text-[#888] mt-0.5">Anyone with the link can join</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>

        {/* SquadzPlus banner */}
        <div className="flex items-center gap-3 rounded-2xl border border-[#E05C3A]/30 bg-[#E05C3A]/8 p-[12px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#E05C3A"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span className="text-[13px] font-semibold text-[#E05C3A]">Squadz+ — unlimited squads, permanent vault & more</span>
        </div>

        {/* Find Best Time */}
        <div className="mt-3">
          <div
            className="flex items-center gap-3 rounded-2xl p-4"
            style={{ background: `linear-gradient(135deg, ${squadColor}, ${squadColor}CC)` }}
          >
            <div className="w-10 h-10 rounded-xl bg-white/22 flex items-center justify-center shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M12 2l1.09 3.26L16 6l-1.91 2.87L15 12l-3-1.5L9 12l.91-3.13L8 6l2.91-.74L12 2z"/></svg>
            </div>
            <div className="flex-1">
              <div className="text-[16px] font-extrabold text-white">Find the Best Time</div>
              <div className="text-[12px] text-white/85 mt-0.5">Poll the squad · pick a time everyone's free</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>

        {/* Members */}
        <div className="text-[18px] font-extrabold text-white mt-6 mb-3">Members</div>
        <div className="flex flex-wrap gap-2.5">
          {members.map((m) => (
            <div key={m.initials + m.name} className="rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-3.5 flex flex-col items-center gap-2" style={{ width: "calc(33% - 6px)" }}>
              {m.isAdd ? (
                <div className="w-11 h-11 rounded-full bg-[#E05C3A]/20 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/><line x1="19" y1="8" x2="19" y2="14" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/><line x1="22" y1="11" x2="16" y2="11" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
              ) : (
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-[15px]" style={{ backgroundColor: m.color }}>
                  {m.initials}
                </div>
              )}
              <span className={`text-[12px] font-bold text-center ${m.isAdd ? "text-[#E05C3A]" : "text-white"}`}>{m.name}</span>
            </div>
          ))}
        </div>

        {/* Group Chat */}
        <div className="flex items-center gap-3 rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-[14px] mt-5">
          <div className="w-10 h-10 rounded-full bg-[#E05C3A]/20 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-extrabold text-white">Group Chat</div>
            <div className="text-[12px] text-[#888] mt-0.5">Message the whole squad</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>

        {/* Photos */}
        <div className="flex items-center gap-3 rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-[14px]">
          <div className="w-10 h-10 rounded-full bg-[#E05C3A]/20 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#E05C3A" strokeWidth="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="#E05C3A"/><path d="M21 15l-5-5L5 21" stroke="#E05C3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-extrabold text-white">Squad Vault</div>
            <div className="text-[12px] text-[#888] mt-0.5">View vault · private memories</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>

        {/* Events */}
        <div className="text-[18px] font-extrabold text-white mt-6 mb-3">Events</div>
        <div className="rounded-2xl border border-[#2A2A2A] bg-[#1A1A1A] p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎮</span>
            <div className="flex-1">
              <div className="text-[15px] font-bold text-white">LAN Party Saturday</div>
              <div className="text-[12px] text-[#888] mt-0.5">Sat, Jun 21 · Mike's Place · 3 going</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
