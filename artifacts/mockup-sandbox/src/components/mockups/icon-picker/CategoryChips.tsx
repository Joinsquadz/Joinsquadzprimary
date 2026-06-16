import { useState } from "react";

const C = {
  text: "#FFFFFF",
  background: "#0A0A0F",
  card: "#12121A",
  primary: "#FF5C3A",
  secondary: "#1A1A26",
  border: "#222236",
  textSub: "#9999AA",
  textDim: "#555566",
};

const CATEGORIES: { label: string; icon: string; emojis: string[] }[] = [
  { label: "Vibes", icon: "🔥", emojis: ["🔥", "🎉", "🎊", "✨", "⭐", "💯", "🌈", "💫"] },
  {
    label: "Sports",
    icon: "⚽",
    emojis: ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "⛳", "🏌️", "🏋️", "🤸", "🧘", "🏃", "🚴", "🏊", "🏄", "⛷️", "🏂", "🥾", "🧗", "🛹", "🥊", "🎿", "🎳", "🎱", "♟️"],
  },
  { label: "Games", icon: "🎮", emojis: ["🎮", "🎲", "🎯", "🕹️", "🃏", "🎨", "📷", "🎣", "🎸", "🎤", "🎵", "🎧", "🎬", "🍿", "📚", "🎓"] },
  { label: "Food", icon: "🍕", emojis: ["🍕", "🍔", "🌮", "🍣", "🍜", "🍩", "🍰", "☕", "🍻", "🍷", "🥂", "🍳"] },
  { label: "Travel", icon: "✈️", emojis: ["✈️", "🏖️", "🌊", "🏕️", "🗺️", "🏔️", "🌅", "🚗", "⛺"] },
  { label: "Misc", icon: "🏠", emojis: ["🏠", "💼", "💪", "🐶", "🐱", "🎂", "🎄", "💍", "👶"] },
];

export function CategoryChips() {
  const [cat, setCat] = useState(0);
  const [selected, setSelected] = useState("🔥");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.background,
        color: C.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 20, color: C.textSub }}>‹</span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>New Squad</span>
      </div>

      <div style={{ padding: "20px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 8 }}>Squad name</div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", fontSize: 15 }}>Sunday Ballers</div>

        <div style={{ height: 24 }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textSub }}>Icon</span>
          <span style={{ fontSize: 22 }}>{selected}</span>
        </div>

        {/* Category chips */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 16 }}>
          {CATEGORIES.map((c, i) => {
            const active = i === cat;
            return (
              <button
                key={c.label}
                onClick={() => setCat(i)}
                style={{
                  flex: "0 0 auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 999,
                  fontSize: 13.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  color: active ? "#fff" : C.textSub,
                  background: active ? C.primary : C.secondary,
                  border: active ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontSize: 15 }}>{c.icon}</span>
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Grid for the selected category only */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignContent: "flex-start" }}>
          {CATEGORIES[cat].emojis.map((e) => {
            const active = selected === e;
            return (
              <button
                key={e}
                onClick={() => setSelected(e)}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  fontSize: 26,
                  cursor: "pointer",
                  background: active ? C.primary + "25" : C.card,
                  border: active ? `2px solid ${C.primary}` : `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {e}
              </button>
            );
          })}
        </div>

        <p style={{ marginTop: 16, fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>
          One tidy row of categories. Only the {CATEGORIES[cat].emojis.length} icons in “{CATEGORIES[cat].label}” show at a
          time — no endless scroll.
        </p>
      </div>
    </div>
  );
}
