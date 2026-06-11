import { View, StyleSheet, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { UserAvatar } from "./UserAvatar";

interface ProAvatarProps {
  initials: string;
  color: string;
  imageUrl?: string | null;
  size?: number;
  fontSize?: number;
  isPro?: boolean;
  /** When provided, the avatar becomes tappable (e.g. to open the user's profile). */
  onPress?: () => void;
}

/**
 * Avatar with an optional gold gradient ring denoting Squadz+ (Pro) members.
 * Falls back to a plain UserAvatar when the user is not Pro, so it can be used
 * as a drop-in replacement everywhere avatars appear.
 *
 * The gold ring is rendered as a gradient halo behind the avatar: the wrapper
 * grows by 2× the ring width and the inner avatar sits centered on top, leaving
 * a clean gold band around the edge.
 */
export function ProAvatar({
  initials,
  color,
  imageUrl,
  size = 40,
  fontSize = 14,
  isPro = false,
  onPress,
}: ProAvatarProps) {
  const avatar = !isPro ? (
    <UserAvatar initials={initials} color={color} imageUrl={imageUrl} size={size} fontSize={fontSize} />
  ) : (
    (() => {
      const ringWidth = Math.max(2, Math.round(size * 0.06));
      const outer = size + ringWidth * 2 + 2;
      return (
        <LinearGradient
          colors={["#FFE08A", "#F5C242", "#C8941A"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.ring, { width: outer, height: outer, borderRadius: outer / 2 }]}
        >
          <View style={[styles.inner, { borderRadius: (size + 4) / 2, padding: 2, backgroundColor: "transparent" }]}>
            <UserAvatar initials={initials} color={color} imageUrl={imageUrl} size={size} fontSize={fontSize} />
          </View>
        </LinearGradient>
      );
    })()
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
        {avatar}
      </TouchableOpacity>
    );
  }

  return avatar;
}

const styles = StyleSheet.create({
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
  },
});
