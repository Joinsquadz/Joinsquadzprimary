import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  registering: boolean;
  onReEnable: () => void;
  onDismiss: () => void;
}

/**
 * Pure-UI banner shown when the server's stored push token no longer matches
 * the device's current token. All logic lives in the parent
 * (PushNotificationHandler in _layout.tsx).
 */
export function PushNotificationBanner({ visible, registering, onReEnable, onDismiss }: Props) {
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const colors = useColors();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  if (Platform.OS === "web" || !visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { top: insets.top + 8, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="bell-off" size={18} color="#FF5C3A" style={styles.icon} />
        <Text style={[styles.text, { color: colors.foreground }]} numberOfLines={2}>
          Notifications aren't reaching you. Tap to fix it.
        </Text>
        <Pressable
          onPress={registering ? undefined : onReEnable}
          disabled={registering}
          style={[styles.actionBtn, { opacity: registering ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Re-enable push notifications"
        >
          <Text style={styles.actionText}>{registering ? "Fixing…" : "Fix"}</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification banner"
        >
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
    gap: 8,
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  actionBtn: {
    flexShrink: 0,
    backgroundColor: "#FF5C3A",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  actionText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  closeBtn: {
    flexShrink: 0,
    padding: 4,
  },
});
