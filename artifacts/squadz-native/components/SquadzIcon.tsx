import Svg, { Defs, LinearGradient, Stop, Rect, Path } from "react-native-svg";
import type { ViewStyle, StyleProp } from "react-native";

export function SquadzIcon({
  size = 88,
  style,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" style={style}>
      <Defs>
        <LinearGradient id="sq-zg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#FF5C3A" />
          <Stop offset="100%" stopColor="#FFB547" />
        </LinearGradient>
        <LinearGradient id="sq-bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#1E1E2E" />
          <Stop offset="100%" stopColor="#0A0A14" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="512" height="512" rx="114" fill="url(#sq-bg)" />
      <Path
        d="M 81,81 L 431,81 L 431,151 L 151,361 L 431,361 L 431,431 L 81,431 L 81,361 L 361,151 L 81,151 Z"
        fill="url(#sq-zg)"
      />
    </Svg>
  );
}
