import { useState, useMemo } from "react";

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

type Entry = { e: string; kw: string };
const CATEGORIES: { label: string; items: Entry[] }[] = [
  {
    label: "Vibes",
    items: [
      { e: "🔥", kw: "fire hot lit vibe" },
      { e: "🎉", kw: "party celebrate" },
      { e: "🎊", kw: "party confetti" },
      { e: "✨", kw: "sparkle shine" },
      { e: "⭐", kw: "star favorite" },
      { e: "💯", kw: "hundred perfect" },
      { e: "🌈", kw: "rainbow pride" },
      { e: "💫", kw: "dizzy star" },
    ],
  },
  {
    label: "Sports & Fitness",
    items: [
      { e: "⚽", kw: "soccer football ball" },
      { e: "🏀", kw: "basketball ball hoops" },
      { e: "🏈", kw: "football ball" },
      { e: "⚾", kw: "baseball ball" },
      { e: "🎾", kw: "tennis ball" },
      { e: "🏐", kw: "volleyball ball" },
      { e: "🏉", kw: "rugby ball" },
      { e: "⛳", kw: "golf flag" },
      { e: "🏌️", kw: "golf golfer" },
      { e: "🏋️", kw: "gym lift weights" },
      { e: "🤸", kw: "gymnastics" },
      { e: "🧘", kw: "yoga meditate" },
      { e: "🏃", kw: "run running" },
      { e: "🚴", kw: "bike cycling" },
      { e: "🏊", kw: "swim swimming" },
      { e: "🏄", kw: "surf surfing" },
      { e: "⛷️", kw: "ski skiing" },
      { e: "🏂", kw: "snowboard" },
      { e: "🥾", kw: "hike hiking boot" },
      { e: "🧗", kw: "climb climbing" },
      { e: "🛹", kw: "skate skateboard" },
      { e: "🥊", kw: "box boxing" },
      { e: "🎿", kw: "ski skis" },
      { e: "🎳", kw: "bowling" },
      { e: "🎱", kw: "pool billiards" },
      { e: "♟️", kw: "chess" },
    ],
  },
  {
    label: "Games & Hobbies",
    items: [
      { e: "🎮", kw: "game gaming controller" },
      { e: "🎲", kw: "dice game" },
      { e: "🎯", kw: "darts target" },
      { e: "🕹️", kw: "arcade joystick" },
      { e: "🃏", kw: "cards joker" },
      { e: "🎨", kw: "art paint" },
      { e: "📷", kw: "photo camera" },
      { e: "🎣", kw: "fish fishing" },
      { e: "🎸", kw: "guitar music" },
      { e: "🎤", kw: "sing karaoke mic" },
      { e: "🎵", kw: "music note" },
      { e: "🎧", kw: "headphones music" },
      { e: "🎬", kw: "movie film" },
      { e: "🍿", kw: "popcorn movie" },
      { e: "📚", kw: "books read" },
      { e: "🎓", kw: "grad school" },
    ],
  },
  {
    label: "Food & Drink",
    items: [
      { e: "🍕", kw: "pizza food" },
      { e: "🍔", kw: "burger food" },
      { e: "🌮", kw: "taco food" },
      { e: "🍣", kw: "sushi food" },
      { e: "🍜", kw: "ramen noodles food" },
      { e: "🍩", kw: "donut food" },
      { e: "🍰", kw: "cake dessert food" },
      { e: "☕", kw: "coffee drink" },
      { e: "🍻", kw: "beer drink" },
      { e: "🍷", kw: "wine drink" },
      { e: "🥂", kw: "cheers drink" },
      { e: "🍳", kw: "brunch eggs food" },
    ],
  },
  {
    label: "Travel & Outdoors",
    items: [
      { e: "✈️", kw: "travel plane flight" },
      { e: "🏖️", kw: "beach vacation" },
      { e: "🌊", kw: "ocean wave water" },
      { e: "🏕️", kw: "camp camping" },
      { e: "🗺️", kw: "map trip" },
      { e: "🏔️", kw: "mountain" },
      { e: "🌅", kw: "sunrise sunset" },
      { e: "🚗", kw: "car road trip" },
      { e: "⛺", kw: "tent camp" },
    ],
  },
  {
    label: "Home & Misc",
    items: [
      { e: "🏠", kw: "home house" },
      { e: "💼", kw: "work business" },
      { e: "💪", kw: "strong gym" },
      { e: "🐶", kw: "dog pet" },
      { e: "🐱", kw: "cat pet" },
      { e: "🎂", kw: "birthday cake" },
      { e: "🎄", kw: "christmas holiday" },
      { e: "💍", kw: "ring wedding" },
      { e: "👶", kw: "baby" },
    ],
  },
];

const TOTAL = CATEGORIES.reduce((n, c) => n + c.items.length, 0);

export function SearchableSheet() {
  const [selected, setSelected] = useState("🔥");
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => ({
      label: cat.label,
      items: cat.items.filter((it) => it.kw.includes(q) || it.e === q),
    })).filter((cat) => cat.items.length > 0);
  }, [q]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.background,
        color: C.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 20, color: C.textSub }}>‹</span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>New Squad</span>
      </div>

      <div style={{ padding: "20px", flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 8 }}>Squad name</div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", fontSize: 15 }}>Sunday Ballers</div>

        <div style={{ height: 24 }} />

        <div style={{ fontSize: 13, fontWeight: 600, color: C.textSub, marginBottom: 8 }}>Icon</div>
        <button
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: "12px 14px",
            cursor: "pointer",
            color: C.text,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: C.primary + "22",
              border: `2px solid ${C.primary}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
            }}
          >
            {selected}
          </div>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Change icon</div>
            <div style={{ fontSize: 13, color: C.textSub }}>Search or browse {TOTAL} icons</div>
          </div>
          <span style={{ color: C.textDim, fontSize: 18 }}>›</span>
        </button>

        <p style={{ marginTop: 16, fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>
          The form shows just the chosen icon. Everything else opens in a searchable sheet — type “ball”, “food”, or
          “gym”.
        </p>
      </div>

      {open && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end" }} onClick={() => setOpen(false)}>
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{
              width: "100%",
              height: "86%",
              background: C.card,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>Choose an icon</span>
                <button
                  onClick={() => setOpen(false)}
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
                  border: `1px solid ${q ? C.primary : C.border}`,
                  borderRadius: 12,
                  padding: "10px 12px",
                }}
              >
                <span style={{ color: C.textDim, fontSize: 14 }}>🔍</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  placeholder="Search icons…"
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 15 }}
                />
                {query && (
                  <button onClick={() => setQuery("")} style={{ background: "transparent", border: "none", color: C.textDim, cursor: "pointer", fontSize: 14 }}>
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div style={{ overflowY: "auto", padding: "12px 18px 28px", flex: 1 }}>
              {filtered.length === 0 && (
                <div style={{ textAlign: "center", color: C.textDim, fontSize: 14, marginTop: 40 }}>
                  No icons match “{query}”.
                </div>
              )}
              {filtered.map((cat) => (
                <div key={cat.label} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: C.textSub, textTransform: "uppercase", marginBottom: 10 }}>
                    {cat.label}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {cat.items.map((it) => {
                      const active = selected === it.e;
                      return (
                        <button
                          key={it.e}
                          onClick={() => {
                            setSelected(it.e);
                            setOpen(false);
                          }}
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: 14,
                            fontSize: 26,
                            cursor: "pointer",
                            background: active ? C.primary + "25" : C.background,
                            border: active ? `2px solid ${C.primary}` : `1px solid ${C.border}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {it.e}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
