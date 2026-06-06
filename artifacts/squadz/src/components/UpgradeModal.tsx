import { useState } from "react";
import { T, font, fontMono } from "@/lib/data";

const PRO_FEATURES = [
  "Unlimited events per year",
  "Permanent photo vault",
  "Calendar sync & AI best-time finder",
  "Custom invite codes",
  "Priority support",
];

export type UpgradeTrigger = "calendar" | "events" | "photos" | "general";

const TRIGGER_COPY: Record<UpgradeTrigger, { icon: string; title: string; body: string }> = {
  calendar: {
    icon: "📅",
    title: "Sync your calendar",
    body: "Let SquadZ find the perfect time for everyone automatically. This is a Pro feature.",
  },
  events: {
    icon: "🎉",
    title: "You're on a roll!",
    body: "You've planned 3 events this year — the free plan limit. Upgrade to keep the momentum going.",
  },
  photos: {
    icon: "📸",
    title: "Keep your memories",
    body: "Free accounts store photos for 30 days. Upgrade to Pro for a permanent, unlimited photo vault.",
  },
  general: {
    icon: "⚡",
    title: "Unlock the full experience",
    body: "Unlimited events, photo vault, calendar sync, and custom invite codes — for just $20/year.",
  },
};

export function UpgradeModal({
  trigger,
  onClose,
  onUpgrade,
}: {
  trigger: UpgradeTrigger;
  onClose: () => void;
  onUpgrade?: () => void;
}) {
  const { icon, title, body } = TRIGGER_COPY[trigger];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    if (onUpgrade) { onUpgrade(); return; }
    setLoading(true);
    setError(null);
    try {
      const productsRes = await fetch('/api/products-with-prices');
      const { data: products } = await productsRes.json() as {
        data: Array<{ id: string; name: string; prices: Array<{ id: string; unit_amount: number; recurring: { interval: string } | null }> }>;
      };

      const pro = products.find(p => p.name === 'Squadz Pro');
      const yearlyPrice = pro?.prices.find(p => p.recurring?.interval === 'year');

      if (!yearlyPrice) {
        setError('Squadz Pro plan not found. Please try again later.');
        return;
      }

      // Server resolves the current user from session — no userId sent from client
      const checkoutRes = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: yearlyPrice.id }),
      });

      const { url, error: apiError } = await checkoutRes.json() as { url?: string; error?: string };
      if (apiError || !url) {
        setError(apiError ?? 'Failed to start checkout. Please try again.');
        return;
      }

      window.location.href = url;
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 9999,
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        style={{
          width: "100%",
          background: T.surface,
          borderRadius: "24px 24px 0 0",
          padding: "28px 24px 44px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 17,
              background: `linear-gradient(135deg, ${T.accent}, ${T.gold})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: "'Georgia', serif",
                fontSize: 20,
                fontWeight: 700,
                color: T.white,
                lineHeight: 1.2,
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: T.textSub,
                fontFamily: font,
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {body}
            </div>
          </div>
        </div>

        <div
          style={{
            background: `linear-gradient(135deg, ${T.accent}22, ${T.gold}18)`,
            border: `1.5px solid ${T.accent}50`,
            borderRadius: 18,
            padding: "14px 20px",
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          <div style={{ fontFamily: fontMono, fontWeight: 800, fontSize: 36, color: T.white, lineHeight: 1 }}>
            $20
          </div>
          <div style={{ fontSize: 13, color: T.textSub, fontFamily: font, marginTop: 3 }}>
            per year · less than $2/month · cancel anytime
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 22 }}>
          {PRO_FEATURES.map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  background: T.green,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  color: "#000",
                  fontWeight: 900,
                  flexShrink: 0,
                }}
              >
                ✓
              </div>
              <span style={{ fontSize: 13, color: T.text, fontFamily: font }}>{f}</span>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ fontSize: 13, color: "#FF6B6B", fontFamily: font, marginBottom: 10, textAlign: "center" }}>
            {error}
          </div>
        )}

        <button
          onClick={handleUpgrade}
          disabled={loading}
          style={{
            width: "100%",
            borderRadius: 14,
            border: "none",
            background: loading
              ? `linear-gradient(135deg, ${T.accent}80, #FF805080)`
              : `linear-gradient(135deg, ${T.accent}, #FF8050)`,
            color: "#fff",
            fontFamily: font,
            fontWeight: 800,
            fontSize: 15,
            padding: "14px 20px",
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: `0 8px 28px ${T.accent}45`,
            marginBottom: 10,
          }}
        >
          {loading ? "Opening checkout…" : "Upgrade to Pro — $20/year →"}
        </button>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            color: T.textDim,
            fontFamily: font,
            fontSize: 13,
            cursor: "pointer",
            padding: "6px",
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
