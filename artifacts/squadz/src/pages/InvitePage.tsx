import { useState } from "react";
import { useLocation } from "wouter";
import { PhoneShell } from "@/components/PhoneShell";
import { T, font, fontMono } from "@/lib/data";
import { inviteStore } from "@/lib/inviteStore";
import { toast } from "@/hooks/use-toast";

export default function InvitePage() {
  const [, setLocation] = useLocation();
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);

  const invite = {
    emoji: "🔥",
    title: "Rooftop BBQ",
    host: "Marcus Chen",
    date: "Sat, Jun 7 · 5:00 PM",
    squad: "The Usual Suspects",
    going: 5,
    code: "BBQ-7K2M",
  };

  const copyCode = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAccept = async () => {
    setJoining(true);
    try {
      const res = await fetch("/api/events/join", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: invite.code }),
      });
      if (res.ok) {
        setAccepted(true);
        return;
      }
      const body = await res.json() as { error?: string };
      const message = body.error ?? "Something went wrong. Please try again.";
      toast({ title: message, variant: "destructive" });
    } catch {
      toast({ title: "Could not connect. Please check your connection.", variant: "destructive" });
    } finally {
      setJoining(false);
    }
  };

  if (accepted) return (
    <PhoneShell>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: T.bg,
          padding: "0 32px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 72, marginBottom: 18 }}>🎉</div>
        <div
          style={{
            fontFamily: "'Georgia', serif",
            fontSize: 28,
            fontWeight: 700,
            color: T.white,
            marginBottom: 8,
          }}
        >
          You're in!
        </div>
        <div
          style={{
            fontSize: 14,
            color: T.textSub,
            fontFamily: font,
            lineHeight: 1.6,
            marginBottom: 36,
          }}
        >
          You've joined{" "}
          <strong style={{ color: T.text }}>{invite.title}</strong>. See you there!
        </div>
        <button
          onClick={() => setLocation("/home")}
          style={{
            width: "100%",
            borderRadius: 14,
            border: "none",
            background: `linear-gradient(135deg, ${T.accent}, #FF8050)`,
            color: "#fff",
            fontFamily: font,
            fontWeight: 800,
            fontSize: 15,
            padding: "14px 20px",
            cursor: "pointer",
            boxShadow: `0 8px 28px ${T.accent}45`,
          }}
        >
          Open SquadZ →
        </button>
      </div>
    </PhoneShell>
  );

  return (
    <PhoneShell>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden" }}>
        <div
          style={{
            background: `linear-gradient(160deg, ${T.accent}, #C83E22)`,
            padding: "60px 24px 36px",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: -50,
              top: -50,
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
            }}
          />
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.7)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontFamily: fontMono,
              marginBottom: 12,
            }}
          >
            You're invited
          </div>
          <div style={{ fontSize: 60, marginBottom: 12 }}>{invite.emoji}</div>
          <div
            style={{
              fontFamily: "'Georgia', serif",
              fontSize: 28,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {invite.title}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontFamily: font, marginTop: 6 }}>
            {invite.squad}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px 40px" }}>
          <div
            style={{
              background: T.surface,
              borderRadius: 18,
              border: `1px solid ${T.border}`,
              padding: "4px 0",
              marginBottom: 20,
            }}
          >
            {[
              ["👤", `Hosted by ${invite.host}`],
              ["📅", invite.date],
              ["👥", `${invite.going} going · The Usual Suspects`],
            ].map(([icon, val], i) => (
              <div
                key={val}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "13px 18px",
                  borderTop: i > 0 ? `1px solid ${T.border}` : "none",
                  fontSize: 14,
                  color: T.textSub,
                  fontFamily: font,
                }}
              >
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span style={{ flex: 1 }}>{val}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              background: T.surfaceUp,
              borderRadius: 16,
              border: `1px solid ${T.border}`,
              padding: "16px 20px",
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 12, color: T.textDim, fontFamily: font, marginBottom: 8 }}>
              Invite code
            </div>
            <div
              style={{
                fontFamily: fontMono,
                fontSize: 26,
                fontWeight: 800,
                color: T.accent,
                letterSpacing: "0.1em",
                marginBottom: 10,
              }}
            >
              {invite.code}
            </div>
            <button
              onClick={copyCode}
              style={{
                background: copied ? T.green + "22" : T.accent + "18",
                border: `1px solid ${copied ? T.green : T.accent}`,
                borderRadius: 10,
                padding: "6px 18px",
                color: copied ? T.green : T.accent,
                fontFamily: font,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {copied ? "✓ Copied!" : "Copy code"}
            </button>
          </div>

          <button
            onClick={handleAccept}
            disabled={joining}
            style={{
              width: "100%",
              borderRadius: 14,
              border: "none",
              background: joining
                ? T.textDim
                : `linear-gradient(135deg, ${T.accent}, #FF8050)`,
              color: "#fff",
              fontFamily: font,
              fontWeight: 800,
              fontSize: 15,
              padding: "14px 20px",
              cursor: joining ? "not-allowed" : "pointer",
              marginBottom: 12,
              boxShadow: joining ? "none" : `0 8px 28px ${T.accent}45`,
              opacity: joining ? 0.7 : 1,
            }}
          >
            {joining ? "Joining…" : "Accept Invite →"}
          </button>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => {
                inviteStore.set({ code: invite.code, title: invite.title, emoji: invite.emoji, host: invite.host, type: "event", dest: "/event" });
                setLocation("/signup");
              }}
              style={{
                flex: 1,
                borderRadius: 12,
                border: `1.5px solid ${T.border}`,
                background: "transparent",
                color: T.textSub,
                fontFamily: font,
                fontWeight: 700,
                fontSize: 13,
                padding: "11px 0",
                cursor: "pointer",
              }}
            >
              Create Account
            </button>
            <button
              onClick={() => {
                inviteStore.set({ code: invite.code, title: invite.title, emoji: invite.emoji, host: invite.host, type: "event", dest: "/event" });
                setLocation("/login");
              }}
              style={{
                flex: 1,
                borderRadius: 12,
                border: `1.5px solid ${T.accent}`,
                background: "transparent",
                color: T.accent,
                fontFamily: font,
                fontWeight: 700,
                fontSize: 13,
                padding: "11px 0",
                cursor: "pointer",
              }}
            >
              Sign In
            </button>
          </div>

          <div
            style={{
              marginTop: 20,
              textAlign: "center",
              fontSize: 12,
              color: T.textDim,
              fontFamily: font,
            }}
          >
            Powered by SquadZ · getsquadz.com
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
