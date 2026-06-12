import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

const { width } = Dimensions.get("window");
const CONFETTI_COLORS = ["#FF5C3A", "#FFB547", "#2ECC8A", "#4A9EFF", "#A855F7", "#E91E8C"];

type Props = {
  visible: boolean;
  emoji: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onClose: () => void;
};

function ConfettiPiece({ index }: { index: number }) {
  const fall = useRef(new Animated.Value(0)).current;
  const startX = (index / 18) * width + (index % 3) * 12;
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const delay = (index % 6) * 120;

  useEffect(() => {
    Animated.loop(
      Animated.timing(fall, {
        toValue: 1,
        duration: 2600,
        delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [fall, delay]);

  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-40, 720] });
  const rotate = fall.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "540deg"] });
  const translateX = fall.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 18, -10] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.confetti,
        { left: startX, backgroundColor: color, transform: [{ translateY }, { translateX }, { rotate }] },
      ]}
    />
  );
}

/**
 * Full-screen celebration used for once-per-event milestones (B5 streaks,
 * B6 first RSVP). Confetti + scale-in badge + dismiss.
 */
export function CelebrationOverlay({ visible, emoji, title, subtitle, ctaLabel, onClose }: Props) {
  const colors = useColors();
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.6);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 90 }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [visible, scale, opacity]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {Array.from({ length: 18 }).map((_, i) => (
          <ConfettiPiece key={i} index={i} />
        ))}
        <Animated.View style={{ opacity, transform: [{ scale }], alignItems: "center" }}>
          <Text style={styles.emoji}>{emoji}</Text>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.primary }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>{ctaLabel ?? "Nice!"}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.82)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    overflow: "hidden",
  },
  confetti: { position: "absolute", top: 0, width: 10, height: 14, borderRadius: 2 },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: { color: "#fff", fontSize: 26, fontWeight: "900", textAlign: "center" },
  subtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 21,
  },
  cta: { marginTop: 28, paddingHorizontal: 36, paddingVertical: 14, borderRadius: 999 },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
