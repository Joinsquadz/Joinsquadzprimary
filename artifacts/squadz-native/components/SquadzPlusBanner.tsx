import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AppContext";
import { UpgradeModal, type UpgradeTrigger } from "@/components/UpgradeModal";

interface Props {
  trigger: UpgradeTrigger;
  /** Short benefit hook shown on the banner. */
  message: string;
  style?: ViewStyle;
}

/**
 * Slim ambient Squadz+ banner. Reads pro status from AppContext (global, always
 * in sync) and renders nothing for pro members, so it can be dropped on any
 * screen without the parent tracking subscription state.
 */
export function SquadzPlusBanner({ trigger, message, style }: Props) {
  const { isPro, setIsPro } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Hide until we positively know the user is NOT pro (null = still loading).
  if (isPro !== false) return null;

  return (
    <>
      <TouchableOpacity activeOpacity={0.85} onPress={() => setShowUpgrade(true)} style={style}>
        <LinearGradient
          colors={["#FF6B2C", "#FF8050"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.banner}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="star" size={16} color="#fff" />
          </View>
          <Text style={styles.message} numberOfLines={2}>
            {message}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>

      <UpgradeModal
        visible={showUpgrade}
        trigger={trigger}
        onClose={() => setShowUpgrade(false)}
        onUpgradeSuccess={() => setIsPro(true)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    flex: 1,
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
});
