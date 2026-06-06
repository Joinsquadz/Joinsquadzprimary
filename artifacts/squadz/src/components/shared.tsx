import { useState, ReactNode } from "react";
import { T, getAvatarColor, font, fontMono } from "@/lib/data";

export function Btn({ children, variant = "primary", onPress, style = {}, small = false }: {
  children: ReactNode; variant?: string; onPress?: () => void; style?: React.CSSProperties; small?: boolean;
}) {
  const [pressed, setPressed] = useState(false);

  const baseStyles: Record<string, React.CSSProperties> = {
    primary: {
      background: `linear-gradient(135deg, ${T.accent} 0%, #FF8050 100%)`,
      color: "#fff", border: "none",
      boxShadow: `0 6px 24px ${T.accent}40`,
    },
    secondary: {
      background: T.surfaceUp, color: T.text,
      border: `1.5px solid ${T.border}`,
    },
    ghost: {
      background: "transparent", color: T.accent,
      border: `1.5px solid ${T.accent}`,
    },
    facebook: {
      background: "#1877F2", color: "#fff", border: "none",
    },
    google: {
      background: T.surfaceUp, color: T.text,
      border: `1.5px solid ${T.border}`,
    },
    danger: {
      background: "#FF3333", color: "#fff", border: "none",
      boxShadow: "0 4px 16px rgba(255,51,51,0.30)",
    },
    gold: {
      background: T.gold, color: "#000", border: "none",
      boxShadow: `0 4px 16px ${T.gold}40`,
    },
  };

  return (
    <button
      onClick={onPress}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        ...baseStyles[variant],
        borderRadius: small ? 11 : 14,
        fontFamily: font, fontWeight: 700,
        fontSize: small ? 13 : 15,
        padding: small ? "8px 16px" : "14px 20px",
        cursor: "pointer", width: "100%", textAlign: "center",
        transition: "all 0.12s",
        transform: pressed ? "scale(0.97)" : "scale(1)",
        outline: "none",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Input({ placeholder, type = "text", icon, value, onChange }: {
  placeholder?: string; type?: string; icon?: string; value?: string; onChange?: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      {icon && (
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: 0.6 }}>
          {icon}
        </span>
      )}
      <input
        type={type} placeholder={placeholder} value={value}
        onChange={e => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          background: focused ? T.surfaceHigh : T.surfaceUp,
          border: `1.5px solid ${focused ? T.accent + "80" : T.border}`,
          borderRadius: 13, padding: `13px 14px`,
          paddingLeft: icon ? 42 : 14,
          color: T.text, fontFamily: font, fontSize: 15,
          outline: "none", boxSizing: "border-box",
          transition: "all 0.2s",
        }}
      />
    </div>
  );
}

export function Avatar({ name = "?", size = 36, color }: { name?: string; size?: number; color?: string }) {
  const bg = color || getAvatarColor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2,
      background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, color: "#000", flexShrink: 0, fontFamily: font,
      boxShadow: `0 2px 8px ${bg}40`,
    }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

export function Tag({ children, color = T.accent }: { children: ReactNode; color?: string }) {
  return (
    <span style={{
      background: color + "1E", color, fontSize: 11, fontWeight: 700,
      padding: "3px 9px", borderRadius: 20, fontFamily: fontMono,
      letterSpacing: "0.04em", whiteSpace: "nowrap",
      border: `1px solid ${color}30`,
    }}>
      {children}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: "0.10em",
      textTransform: "uppercase", fontFamily: fontMono, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

export function Card({ children, style = {}, onPress }: { children: ReactNode; style?: React.CSSProperties; onPress?: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onPress}
      onMouseEnter={() => onPress && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: T.surface, borderRadius: 18, border: `1px solid ${hov ? T.borderLight : T.border}`,
        padding: 16, cursor: onPress ? "pointer" : "default",
        transition: "all 0.15s", transform: hov ? "translateY(-1px)" : "none",
        boxShadow: hov ? `0 8px 24px rgba(0,0,0,0.3)` : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SwitchToggle({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <div onClick={toggle} style={{
      width: 46, height: 26, borderRadius: 13,
      background: on ? T.green : T.surfaceHigh,
      position: "relative", cursor: "pointer",
      transition: "background 0.22s", flexShrink: 0,
      boxShadow: on ? `0 0 12px ${T.green}40` : "none",
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: 10, background: "#fff",
        position: "absolute", top: 3, left: on ? 23 : 3,
        transition: "left 0.22s cubic-bezier(0.34, 1.5, 0.64, 1)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }} />
    </div>
  );
}

export function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <button onClick={onPress} style={{
      background: T.surfaceUp, border: `1px solid ${T.border}`,
      color: T.textSub, fontSize: 18, cursor: "pointer",
      padding: "6px 12px", borderRadius: 10,
    }}>←</button>
  );
}
