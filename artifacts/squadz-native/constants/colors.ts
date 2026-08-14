const theme = {
  text: "#FFFFFF",
  tint: "#FF6B2C",
  background: "#0F0F14",
  foreground: "#FFFFFF",
  card: "#12121A",
  cardForeground: "#FFFFFF",
  primary: "#FF6B2C",
  primaryForeground: "#FFFFFF",
  secondary: "#1A1A26",
  secondaryForeground: "#9999AA",
  muted: "#1A1A26",
  mutedForeground: "#9999AA",
  accent: "#FF6B2C",
  accentForeground: "#FFFFFF",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#222236",
  input: "#12121A",
  gold: "#FFB23E",
  green: "#2ECC8A",
  blue: "#4A9EFF",
  purple: "#A855F7",
  surface: "#12121A",
  surfaceUp: "#1A1A26",
  textDim: "#555566",
  textSub: "#9999AA",
};

export const SQUAD_COLORS = [
  "#FF6B2C",
  "#4A9EFF",
  "#2ECC8A",
  "#A855F7",
  "#FFB23E",
  "#FF6B9D",
] as const;

const colors = {
  light: theme,
  dark: theme,
  radius: 16,
};

export default colors;
