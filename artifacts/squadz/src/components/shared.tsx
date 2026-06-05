import { useState, ReactNode } from "react";
import { T, getAvatarColor, font, fontMono } from "@/lib/data";

export function Btn({ children, variant = "primary", onPress, style = {}, small = false }: {
  children: ReactNode; variant?: string; onPress?: () => void; style?: React.CSSProperties; small?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: T.accent, color: "#fff", border: "none" },
    secondary: { background: T.surfaceUp, color: T.text, border: `1px solid ${T.border}` },
    ghost: { background: "transparent", color: T.accent, border: `1px solid ${T.accent}` },
    apple: { background: T.text, color: T.bg, border: "none" },
    google: { background: T.surfaceUp, color: T.text, border: `1px solid ${T.border}` },
    danger: { background: "#FF4444", color: "#fff", border: "none" },
    gold: { background: T.gold, color: "#000", border: "none" },
  };
  return (
    <button onClick={onPress} onMouseDown={() => setPressed(true)} onMouseUp={() => setPressed(false)} onMouseLeave={() => setPressed(false)}
      style={{
        ...styles[variant], borderRadius: 14, fontFamily: font, fontWeight: 700,
        fontSize: small ? 13 : 15, padding: small ? "8px 16px" : "14px 20px",
        cursor: "pointer", width: "100%", textAlign: "center", transition: "all 0.15s",
        transform: pressed ? "scale(0.97)" : "scale(1)", outline: "none",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, ...style,
      }}>{children}
    </button>
  );
}

export function Input({ placeholder, type = "text", icon, value, onChange }: {
  placeholder?: string; type?: string; icon?: string; value?: string; onChange?: (v: string) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      {icon && <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16 }}>{icon}</span>}
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange?.(e.target.value)}
        style={{
          width: "100%", background: T.surfaceUp, border: `1px solid ${T.border}`, borderRadius: 12,
          padding: `13px 14px`, paddingLeft: icon ? 42 : 14,
          color: T.text, fontFamily: font, fontSize: 15, outline: "none", boxSizing: "border-box",
        }} />
    </div>
  );
}

export function Avatar({ name = "?", size = 36, color }: { name?: string; size?: number; color?: string }) {
  const bg = color || getAvatarColor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2, background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, color: "#000", flexShrink: 0, fontFamily: font,
    }}>{name[0]?.toUpperCase()}</div>
  );
}

export function Tag({ children, color = T.accent }: { children: ReactNode; color?: string }) {
  return (
    <span style={{
      background: color + "22", color, fontSize: 11, fontWeight: 700, padding: "3px 9px",
      borderRadius: 20, fontFamily: fontMono, letterSpacing: "0.04em", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8 }}>
      {children}
    </div>
  );
}

export function Card({ children, style = {}, onPress }: { children: ReactNode; style?: React.CSSProperties; onPress?: () => void }) {
  return (
    <div onClick={onPress} style={{
      background: T.surface, borderRadius: 18, border: `1px solid ${T.border}`,
      padding: 16, cursor: onPress ? "pointer" : "default", transition: onPress ? "all 0.15s" : "none", ...style,
    }}>{children}</div>
  );
}

export function SwitchToggle({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <div onClick={toggle} style={{
      width: 44, height: 26, borderRadius: 13, background: on ? T.green : T.surfaceHigh,
      position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0,
    }}>
      <div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff", position: "absolute", top: 3, left: on ? 21 : 3, transition: "left 0.2s" }} />
    </div>
  );
}

export function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <button onClick={onPress} style={{ background: "none", border: "none", color: T.textSub, fontSize: 22, textAlign: "left", cursor: "pointer", padding: 0 }}>←</button>
  );
}
