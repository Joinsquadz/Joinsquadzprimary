import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

export type SnapConfirmHandle = { snap: (label?: string) => void };

/**
 * A quick celebratory "snap" confirmation played after a post is sent
 * (B4 — vibe post + moment ring). A badge scales in with a flash, holds
 * briefly, then shoots up and fades — evoking the post being flung into the
 * feed. Self-contained; drive it via the imperative `snap()` handle.
 */
export const SnapConfirm = React.forwardRef<SnapConfirmHandle>((_props, ref) => {
  const [label, setLabel] = useState("Posted!");
  const [active, setActive] = useState(false);
  const scale = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const snap = useCallback(
    (text?: string) => {
      setLabel(text ?? "Posted!");
      setActive(true);
      scale.setValue(0.4);
      translateY.setValue(0);
      opacity.setValue(0);
      Animated.sequence([
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 120 }),
          Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
        ]),
        Animated.delay(550),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -160,
            duration: 360,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, { toValue: 0.5, duration: 360, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 360, useNativeDriver: true }),
        ]),
      ]).start(() => setActive(false));
    },
    [scale, translateY, opacity],
  );

  useImperativeHandle(ref, () => ({ snap }), [snap]);

  if (!active) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.badge, { opacity, transform: [{ scale }, { translateY }] }]}>
        <Text style={styles.emoji}>📸</Text>
        <Text style={styles.label}>{label}</Text>
      </Animated.View>
    </View>
  );
});

SnapConfirm.displayName = "SnapConfirm";

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 9998 },
  badge: {
    backgroundColor: "rgba(20,20,20,0.92)",
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 26,
    alignItems: "center",
    gap: 6,
  },
  emoji: { fontSize: 40 },
  label: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
