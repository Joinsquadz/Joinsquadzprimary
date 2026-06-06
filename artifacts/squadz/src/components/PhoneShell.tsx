import { ReactNode } from "react";
import { T } from "@/lib/data";

export function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-[100dvh] w-full flex items-center justify-center p-0 md:p-8"
      style={{ background: "radial-gradient(ellipse at 55% 20%, #1c0a04 0%, #06060C 55%, #000 100%)" }}
    >
      <div
        className="w-full h-[100dvh] md:w-[390px] md:h-[844px] md:rounded-[52px] overflow-hidden relative flex flex-col"
        style={{
          background: T.bg,
          boxShadow: [
            "0 0 0 1px rgba(255,255,255,0.06) inset",
            `0 0 0 1.5px ${T.border}`,
            "0 60px 140px rgba(0,0,0,0.96)",
            `0 0 80px ${T.accent}15`,
          ].join(", "),
        }}
      >
        {/* Status bar — desktop only */}
        <div className="hidden md:flex justify-between items-center px-[26px] pt-[14px] shrink-0">
          <span style={{ fontSize: 13, fontWeight: 800, color: T.text, fontFamily: "'DM Sans', sans-serif" }}>9:41</span>
          <div style={{ width: 120, height: 34, background: "#000", borderRadius: 20 }} />
          <div className="flex gap-[5px] items-center">
            <svg width="16" height="11" viewBox="0 0 16 11">
              <rect x="0" y="4" width="3" height="7" rx="1" fill={T.text} />
              <rect x="4.5" y="2.5" width="3" height="8.5" rx="1" fill={T.text} />
              <rect x="9" y="0" width="3" height="11" rx="1" fill={T.text} />
              <rect x="13.5" y="0" width="2.5" height="11" rx="1" fill={T.text} opacity=".3" />
            </svg>
            <svg width="16" height="12" viewBox="0 0 17 12">
              <path d="M8.5 2.5C10.8 2.5 12.9 3.5 14.3 5.1L15.7 3.7C13.9 1.8 11.3 0.7 8.5 0.7C5.7 0.7 3.1 1.8 1.3 3.7L2.7 5.1C4.1 3.5 6.2 2.5 8.5 2.5Z" fill={T.text} />
              <path d="M8.5 5.5C10.1 5.5 11.5 6.2 12.5 7.3L13.9 5.9C12.5 4.5 10.6 3.7 8.5 3.7C6.4 3.7 4.5 4.5 3.1 5.9L4.5 7.3C5.5 6.2 6.9 5.5 8.5 5.5Z" fill={T.text} />
              <circle cx="8.5" cy="10" r="1.8" fill={T.text} />
            </svg>
            <svg width="25" height="12" viewBox="0 0 25 12">
              <rect x="0" y="1" width="22" height="10" rx="3" stroke={T.text} strokeWidth="1.2" fill="none" />
              <rect x="1.5" y="2.5" width="16" height="7" rx="1.5" fill={T.text} />
              <path d="M23 4.2v3.6c.9-.4 1.5-1.1 1.5-1.8s-.6-1.4-1.5-1.8z" fill={T.text} opacity=".4" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {children}
        </div>
      </div>
    </div>
  );
}
