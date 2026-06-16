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

const CURATED = ["🔥", "🎉", "⚽", "🎮", "🍕", "✈️", "🎵", "🎨"];

const CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: "Vibes", emojis: ["🔥", "🎉", "🎊", "✨", "⭐", "💯", "🌈", "💫"] },
  {
    label: "Sports & Fitness",
    emojis: ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "⛳", "🏌️", "🏋️", "🤸", "🧘", "🏃", "🚴", "🏊", "🏄", "⛷️", "🏂", "🥾", "🧗", "🛹", "🥊", "🎿", "🎳", "🎱", "♟️"],
  },
  { label: "Games & Hobbies", emojis: ["🎮", "🎲", "🎯", "🕹️", "🃏", "🎨", "📷", "🎣", "🎸", "🎤", "🎵", "🎧", "🎬", "🍿", "📚", "🎓"] },
  { label: "Food & Drink", emojis: ["🍕", "🍔", "🌮", "🍣", "🍜", "🍩", "🍰", "☕", "🍻", "🍷", "🥂", "🍳"] },
  { label: "Travel & Outdoors", emojis: ["✈️", "🏖️", "🌊", "🏕️", "🗺️", "🏔️", "🌅", "🚗", "⛺"] },
  { label: "Home & Misc", emojis: ["🏠", "💼", "💪", "🐶", "🐱", "🎂", "🎄", "💍", "👶"] },
];

const ALL = CATEGORIES.flatMap((c) => c.emojis);

export function CuratedRow() {
  const [selected, setSelected] = useState("🔥");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");

  const inRow = CURATED.includes(selected) ? CURATED : [selected, ...CURATED.slice(0, 7)];

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
      <Header title="New Squad" />

      <div style={{ padding: "20px", flex: 1 }}>
        <FieldLabel>Squad name</FieldLabel>
        <FakeInput value="Sunday Ballers" />

        <div style={{ height: 28 }} />

        <FieldLabel>Icon</FieldLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: C.primary + "22",
              border: `2px solid ${C.primary}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
            }}
          >
            {selected}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Selected icon</div>
            <div style={{ fontSize: 13, color: C.textSub }}>Tap a quick pick or browse all</div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {inRow.map((e) => (
            <Tile key={e} emoji={e} active={selected === e} onClick={() => setSelected(e)} />
          ))}
          <button
            onClick={() => setSheetOpen(true)}
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: C.secondary,
              border: `1px dashed ${C.border}`,
              color: C.textSub,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
            More
          </button>
        </div>

        <p style={{ marginTop: 14, fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>
          8 quick picks stay visible. The full {ALL.length}-icon library lives one tap away in “More.”
        </p>
      </div>

      {sheetOpen && (
        <div
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end" }}
          onClick={() => setSheetOpen(false)}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{
              width: "100%",
              maxHeight: "76%",
              background: C.card,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 18px 8px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>Choose an icon</span>
                <button
                  onClick={() => setSheetOpen(false)}
                  style={{ width: 30, height: 30, borderRadius: 15, background: C.secondary, border: "none", color: C.text, fontSize: 16, cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: C.background,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "9px 12px",
                }}
              >
                <span style={{ color: C.textDim, fontSize: 14 }}>🔍</span>
                <input
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  placeholder="Search… (try “ball”, “food”)"
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 14 }}
                />
              </div>
            </div>

            <div style={{ overflowY: "auto", padding: "12px 18px 28px" }}>
              {CATEGORIES.map((cat) => {
                const list = cat.emojis.filter((e) => !query); // visual mock: search box is illustrative
                if (list.length === 0) return null;
                return (
                  <div key={cat.label} style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: C.textSub, textTransform: "uppercase", marginBottom: 10 }}>
                      {cat.label}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {cat.emojis.map((e) => (
                        <Tile
                          key={e}
                          emoji={e}
                          active={selected === e}
                          onClick={() => {
                            setSelected(e);
                            setSheetOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 20, color: C.textSub }}>‹</span>
      <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 8 }}>{children}</div>;
}

function FakeInput({ value }: { value: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", fontSize: 15 }}>{value}</div>
  );
}

function Tile({ emoji, active, onClick }: { emoji: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
      {emoji}
    </button>
  );
}
