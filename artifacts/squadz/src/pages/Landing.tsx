import { Fragment, useEffect, useState } from "react";
import { T, font } from "@/lib/data";
import { SquadzIcon } from "@/components/SquadzIcon";

const ACCENT_GRADIENT = `linear-gradient(135deg, ${T.accent} 0%, ${T.gold} 100%)`;

const features = [
  {
    emoji: "👥",
    color: T.accent,
    title: "Squads, not group chats",
    body: "Spin up a crew for your roommates, your run club, your college fam. Everything for that group lives in one place — no more lost-in-the-chat plans.",
  },
  {
    emoji: "🗓️",
    color: T.purple,
    title: "Find the Best Time",
    body: "Everyone taps when they're free. Squadz builds a live heatmap and picks the slot that works for the most people. No more 47-text scheduling threads.",
  },
  {
    emoji: "🎉",
    color: T.gold,
    title: "Events & RSVPs",
    body: "Create a hangout in seconds. Track who's in, who's out, and who's a maybe — with reminders that actually get people to show up.",
  },
  {
    emoji: "💬",
    color: T.blue,
    title: "Group chat that does stuff",
    body: "Chat tied to the plan: vote on times, claim what to bring, drop the address. Decisions happen in the thread, not lost above it.",
  },
  {
    emoji: "📸",
    color: T.pink,
    title: "Photo vault",
    body: "Every hangout's photos in one shared album, auto-sorted by event. Relive the night without begging everyone to AirDrop.",
  },
  {
    emoji: "💸",
    color: T.green,
    title: "Split the costs",
    body: "Keep the BBQ, the cabin, the bar tab fair. Track who paid for what and settle up without the awkward math.",
  },
];

const steps = [
  { n: "1", title: "Start your squad", body: "Invite your people with a link. They're in with one tap." },
  { n: "2", title: "Find the time", body: "Everyone marks when they're free. The best slot rises to the top." },
  { n: "3", title: "Actually hang", body: "Lock the plan, bring the snacks, and capture the memories." },
];

function WaitlistForm({ id, compact = false }: { id?: string; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "web-landing" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(data.error || "Something went wrong. Please try again.");
        setState("error");
        return;
      }
      setState("done");
      setEmail("");
    } catch {
      setMsg("Network error. Please try again.");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div
        id={id}
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "16px 20px",
          background: T.greenDim, border: `1px solid ${T.green}55`, borderRadius: 16,
          color: T.text, fontFamily: font, fontWeight: 600, maxWidth: 460,
        }}
      >
        <span style={{ fontSize: 22 }}>🎉</span>
        <span>You're on the list! We'll email you the moment Squadz drops.</span>
      </div>
    );
  }

  return (
    <form id={id} onSubmit={submit} style={{ width: "100%", maxWidth: 460 }}>
      <div className="lz-form-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          style={{
            flex: 1, minWidth: 0, padding: "15px 18px", borderRadius: 14,
            background: T.surfaceUp, border: `1.5px solid ${T.border}`,
            color: T.text, fontFamily: font, fontSize: 15, outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            border: "none", borderRadius: 14, background: ACCENT_GRADIENT, color: "#fff",
            fontFamily: font, fontWeight: 800, fontSize: 15, padding: "15px 26px",
            cursor: state === "loading" ? "default" : "pointer", whiteSpace: "nowrap",
            boxShadow: `0 8px 28px ${T.accent}45`, opacity: state === "loading" ? 0.7 : 1,
          }}
        >
          {state === "loading" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      <div style={{ marginTop: 9, fontSize: 12.5, fontFamily: font, color: state === "error" ? "#FF8A6E" : T.textDim }}>
        {state === "error" ? msg : compact ? "No spam. Just one email when we launch." : "Be first in line. No spam, no credit card — just the launch invite."}
      </div>
    </form>
  );
}

function StoreBadge({ store }: { store: "ios" | "android" }) {
  return (
    <a
      href="#waitlist"
      style={{
        display: "flex", alignItems: "center", gap: 10, textDecoration: "none",
        padding: "10px 16px", borderRadius: 13, background: T.surfaceUp,
        border: `1px solid ${T.border}`, color: T.text, fontFamily: font,
      }}
    >
      <span style={{ fontSize: 22 }}>{store === "ios" ? "" : "🤖"}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontSize: 10, color: T.textSub }}>Coming soon to</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{store === "ios" ? "App Store" : "Google Play"}</span>
      </span>
    </a>
  );
}

// A compact, stylized phone frame used to preview the product on the page.
function MiniPhone({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: 248, borderRadius: 38, background: T.bg, padding: 10,
        boxShadow: [
          "0 0 0 1.5px rgba(255,255,255,0.07) inset",
          `0 0 0 1.5px ${T.border}`,
          "0 50px 120px rgba(0,0,0,0.85)",
          `0 0 70px ${T.accent}18`,
        ].join(", "),
        ...style,
      }}
    >
      <div style={{ borderRadius: 29, overflow: "hidden", background: T.surface, height: 470, position: "relative" }}>
        <div style={{ position: "absolute", top: 9, left: "50%", transform: "translateX(-50%)", width: 70, height: 18, background: "#000", borderRadius: 12, zIndex: 5 }} />
        {children}
      </div>
    </div>
  );
}

function SquadsPreview() {
  const squads = [
    { emoji: "🔥", name: "The Usual Suspects", members: 7, color: T.accent, streak: 12 },
    { emoji: "💼", name: "Work Crew", members: 5, color: T.blue, streak: 4 },
    { emoji: "🎓", name: "College Fam", members: 12, color: T.purple, streak: 8 },
    { emoji: "🏡", name: "Neighbors", members: 6, color: T.green, streak: 3 },
  ];
  return (
    <div style={{ padding: "34px 16px 16px", height: "100%", fontFamily: font }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: T.text, marginBottom: 2 }}>Your Squads</div>
      <div style={{ fontSize: 12, color: T.textSub, marginBottom: 16 }}>4 crews · 3 plans this week</div>
      {squads.map((s) => (
        <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", marginBottom: 9, borderRadius: 15, background: T.surfaceUp, border: `1px solid ${T.border}` }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: s.color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>{s.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
            <div style={{ fontSize: 11, color: T.textSub }}>{s.members} members</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.gold }}>🔥{s.streak}</div>
        </div>
      ))}
    </div>
  );
}

function HeatmapPreview() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const slots = ["6", "7", "8", "9"];
  // Hand-tuned overlap counts (0–5) to look like a real heatmap; Thu-8 is best.
  const grid: Record<string, number> = {
    "Mon-6": 1, "Mon-7": 2, "Mon-8": 2, "Mon-9": 1,
    "Tue-6": 2, "Tue-7": 3, "Tue-8": 3, "Tue-9": 2,
    "Wed-6": 1, "Wed-7": 2, "Wed-8": 4, "Wed-9": 3,
    "Thu-6": 3, "Thu-7": 4, "Thu-8": 5, "Thu-9": 4,
    "Fri-6": 2, "Fri-7": 3, "Fri-8": 3, "Fri-9": 2,
  };
  return (
    <div style={{ padding: "34px 14px 16px", height: "100%", fontFamily: font }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>Find the Best Time</div>
      <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 14 }}>5 of 7 squad members in</div>
      <div style={{ display: "grid", gridTemplateColumns: `18px repeat(${days.length}, 1fr)`, gap: 4 }}>
        <div />
        {days.map((d) => (
          <div key={d} style={{ fontSize: 9.5, fontWeight: 700, color: T.textSub, textAlign: "center" }}>{d}</div>
        ))}
        {slots.map((slot) => (
          <Fragment key={slot}>
            <div style={{ fontSize: 9, color: T.textDim, display: "flex", alignItems: "center" }}>{slot}p</div>
            {days.map((d) => {
              const c = grid[`${d}-${slot}`] ?? 0;
              const best = d === "Thu" && slot === "8";
              return (
                <div
                  key={`${d}-${slot}`}
                  style={{
                    height: 30, borderRadius: 7,
                    background: c === 0 ? T.surfaceUp : `rgba(255,92,58,${0.18 + c * 0.16})`,
                    border: best ? `2px solid ${T.gold}` : `1px solid ${T.border}`,
                    boxShadow: best ? `0 0 14px ${T.gold}66` : "none",
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 13, background: T.goldDim, border: `1px solid ${T.gold}55` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.gold, letterSpacing: 0.4 }}>✨ BEST TIME</div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text, marginTop: 2 }}>Thursday · 8:00 PM</div>
        <div style={{ fontSize: 10.5, color: T.textSub }}>Works for all 5 members</div>
      </div>
    </div>
  );
}

export default function Landing() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/waitlist/count")
      .then((r) => r.json())
      .then((d: { count: number }) => setCount(typeof d.count === "number" ? d.count : null))
      .catch(() => {});
  }, []);

  const waitlistLabel =
    count != null && count >= 25
      ? `${count.toLocaleString()} people on the waitlist`
      : "Join the founding squad";

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: font, minHeight: "100dvh", overflowX: "hidden" }}>
      <style>{`
        .lz-wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
        .lz-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 40px; align-items: center; padding: 64px 0 40px; }
        .lz-hero > div { min-width: 0; }
        .lz-phones { display: flex; justify-content: center; gap: 0; position: relative; height: 540px; align-items: center; max-width: 100%; }
        .lz-phone-a { transform: rotate(-5deg) translateX(28px); }
        .lz-phone-b { transform: rotate(4deg) translateX(-28px) translateY(26px); }
        .lz-form-row { display: flex; gap: 10px; }
        .lz-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .lz-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .lz-h1 { font-size: 60px; line-height: 1.02; letter-spacing: -0.035em; }
        @keyframes lzFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        @media (max-width: 900px) {
          .lz-hero { grid-template-columns: 1fr; gap: 8px; padding: 36px 0 24px; text-align: center; }
          .lz-hero .lz-cta { justify-content: center; }
          .lz-hero .lz-proof { justify-content: center; }
          .lz-hero form { margin-left: auto; margin-right: auto; }
          .lz-phones { height: 470px; margin-top: 8px; }
          .lz-phone-a { display: none; }
          .lz-phone-b { transform: rotate(0deg) translateX(0) translateY(0); }
          .lz-features { grid-template-columns: 1fr; }
          .lz-steps { grid-template-columns: 1fr; }
          .lz-h1 { font-size: 42px; }
          .lz-nav-links { display: none !important; }
        }
        @media (max-width: 560px) {
          .lz-form-row { flex-direction: column; }
          .lz-h1 { font-size: 34px; }
        }
      `}</style>

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,10,15,0.78)", backdropFilter: "blur(14px)", borderBottom: `1px solid ${T.border}` }}>
        <div className="lz-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 66 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <SquadzIcon size={34} style={{ borderRadius: 10 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.04em" }}>squadz</span>
          </div>
          <div className="lz-nav-links" style={{ display: "flex", alignItems: "center", gap: 30 }}>
            <a href="#features" style={{ color: T.textSub, textDecoration: "none", fontSize: 14.5, fontWeight: 600 }}>Features</a>
            <a href="#how" style={{ color: T.textSub, textDecoration: "none", fontSize: 14.5, fontWeight: 600 }}>How it works</a>
          </div>
          <a href="#waitlist" style={{ background: ACCENT_GRADIENT, color: "#fff", textDecoration: "none", fontWeight: 800, fontSize: 14, padding: "10px 18px", borderRadius: 12, boxShadow: `0 6px 20px ${T.accent}40` }}>
            Join waitlist
          </a>
        </div>
      </nav>

      {/* Ambient glows */}
      <div style={{ position: "absolute", top: 40, right: "-6%", width: 480, height: 480, borderRadius: "50%", background: T.accent, opacity: 0.12, filter: "blur(120px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 320, left: "-10%", width: 420, height: 420, borderRadius: "50%", background: T.purple, opacity: 0.1, filter: "blur(120px)", pointerEvents: "none" }} />

      {/* Hero */}
      <header className="lz-wrap" style={{ position: "relative" }}>
        <div className="lz-hero">
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 22, background: T.surfaceUp, border: `1px solid ${T.border}`, fontSize: 13, color: T.gold, fontWeight: 700, marginBottom: 22 }}>
              📱 Coming soon to iOS &amp; Android
            </div>
            <h1 className="lz-h1" style={{ fontWeight: 800, margin: 0 }}>
              Stop texting.<br />
              Start{" "}
              <span style={{ background: ACCENT_GRADIENT, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>actually hanging.</span>
            </h1>
            <p style={{ fontSize: 18.5, color: T.textSub, lineHeight: 1.55, margin: "20px 0 28px", maxWidth: 480 }}>
              Squadz is the app for your friend group — find the time everyone's free, plan the hangout, and keep the memories. All in one place, none of the chaos.
            </p>
            <div id="waitlist-hero">
              <WaitlistForm />
            </div>
            <div className="lz-cta" style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
              <StoreBadge store="ios" />
              <StoreBadge store="android" />
            </div>
            <div className="lz-proof" style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 24 }}>
              <div style={{ display: "flex" }}>
                {[T.accent, T.purple, T.green, T.gold, T.blue].map((c, i) => (
                  <div key={c} style={{ width: 30, height: 30, borderRadius: 15, background: c, marginLeft: i > 0 ? -9 : 0, border: `2px solid ${T.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#000" }}>{"MKTAR"[i]}</div>
                ))}
              </div>
              <span style={{ fontSize: 14, color: T.textSub }}>
                <span style={{ color: T.text, fontWeight: 700 }}>{waitlistLabel}</span>
              </span>
            </div>
          </div>

          {/* Phone mockups */}
          <div className="lz-phones">
            <div className="lz-phone-a" style={{ zIndex: 1 }}>
              <div style={{ animation: "lzFloat 6s ease-in-out infinite" }}>
                <MiniPhone style={{ opacity: 0.96 }}>
                  <SquadsPreview />
                </MiniPhone>
              </div>
            </div>
            <div className="lz-phone-b" style={{ zIndex: 2 }}>
              <div style={{ animation: "lzFloat 6s ease-in-out infinite 1.4s" }}>
                <MiniPhone>
                  <HeatmapPreview />
                </MiniPhone>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Features */}
      <section id="features" style={{ position: "relative", padding: "70px 0 30px" }}>
        <div className="lz-wrap">
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.accent, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Everything in one app</div>
            <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>Built for the way friends actually plan</h2>
          </div>
          <div className="lz-features">
            {features.map((f) => (
              <div key={f.title} style={{ padding: "26px 24px", borderRadius: 22, background: T.surface, border: `1px solid ${T.border}` }}>
                <div style={{ width: 52, height: 52, borderRadius: 15, background: f.color + "1F", border: `1px solid ${f.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, marginBottom: 18 }}>{f.emoji}</div>
                <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 9 }}>{f.title}</div>
                <div style={{ fontSize: 14.5, color: T.textSub, lineHeight: 1.55 }}>{f.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" style={{ padding: "60px 0" }}>
        <div className="lz-wrap">
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.purple, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>From group chat chaos to plans, in 3 taps</h2>
          </div>
          <div className="lz-steps">
            {steps.map((s) => (
              <div key={s.n} style={{ padding: "30px 26px", borderRadius: 22, background: T.surface, border: `1px solid ${T.border}`, textAlign: "center" }}>
                <div style={{ width: 50, height: 50, borderRadius: 25, margin: "0 auto 18px", background: ACCENT_GRADIENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#fff", boxShadow: `0 8px 24px ${T.accent}45` }}>{s.n}</div>
                <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 9 }}>{s.title}</div>
                <div style={{ fontSize: 14.5, color: T.textSub, lineHeight: 1.55 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing waitlist CTA */}
      <section id="waitlist" style={{ padding: "40px 0 90px" }}>
        <div className="lz-wrap">
          <div style={{ position: "relative", overflow: "hidden", borderRadius: 32, padding: "60px 40px", textAlign: "center", background: T.surface, border: `1px solid ${T.border}` }}>
            <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 420, height: 420, borderRadius: "50%", background: T.accent, opacity: 0.16, filter: "blur(120px)", pointerEvents: "none" }} />
            <div style={{ position: "relative" }}>
              <SquadzIcon size={64} style={{ borderRadius: 18, margin: "0 auto 22px", boxShadow: `0 18px 50px ${T.accent}50` }} />
              <h2 style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 14px" }}>Get your squad together.</h2>
              <p style={{ fontSize: 17, color: T.textSub, maxWidth: 480, margin: "0 auto 28px", lineHeight: 1.55 }}>
                We're putting the finishing touches on Squadz. Join the waitlist and you'll be first in when we launch.
              </p>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <WaitlistForm compact />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${T.border}`, padding: "34px 0" }}>
        <div className="lz-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SquadzIcon size={28} style={{ borderRadius: 9 }} />
            <span style={{ fontFamily: "'Georgia', serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.04em" }}>squadz</span>
          </div>
          <div style={{ fontSize: 13.5, color: T.textDim }}>© {new Date().getFullYear()} Squadz · Stop texting. Start actually hanging.</div>
        </div>
      </footer>
    </div>
  );
}
