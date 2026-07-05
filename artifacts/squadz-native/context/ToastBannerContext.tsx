import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Image,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type ToastBannerOptions = {
  title: string;
  subtitle?: string;
  /** Remote avatar URL of the actor (rendered as a circular image). */
  avatarUrl?: string | null;
  /** Fallback initials shown when there is no avatarUrl and no emoji. */
  initials?: string;
  /** Accent color for the initials bubble (defaults to the brand orange). */
  color?: string;
  /** Emoji shown instead of an avatar (e.g. for milestones / system banners). */
  emoji?: string;
  /** Tapping the banner runs this then dismisses. */
  onPress?: () => void;
  /** How long the banner stays up before auto-dismiss (default 4000ms). */
  durationMs?: number;
};

type ToastBannerContextType = {
  showBanner: (options: ToastBannerOptions) => void;
};

const ToastBannerContext = createContext<ToastBannerContextType>({
  showBanner: () => {},
});

export function useToastBanner(): ToastBannerContextType {
  return useContext(ToastBannerContext);
}

const BRAND = "#FF6B2C";
const GAP_MS = 500;

export function ToastBannerProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastBannerOptions | null>(null);
  const queueRef = useRef<ToastBannerOptions[]>([]);
  const showingRef = useRef(false);
  const translateY = useRef(new Animated.Value(-200)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slide the current banner off the top, then advance the queue after a gap.
  const slideOut = useCallback(
    (after?: () => void) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      Animated.timing(translateY, {
        toValue: -200,
        duration: 240,
        useNativeDriver: true,
      }).start(() => {
        setCurrent(null);
        showingRef.current = false;
        after?.();
      });
    },
    [translateY],
  );

  const playNext = useCallback(() => {
    if (showingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    showingRef.current = true;
    setCurrent(next);
    translateY.setValue(-200);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      friction: 9,
      tension: 70,
    }).start();
    hideTimer.current = setTimeout(() => {
      slideOut(() => {
        // Small gap between consecutive banners so they read as distinct.
        setTimeout(playNext, GAP_MS);
      });
    }, next.durationMs ?? 4000);
  }, [slideOut, translateY]);

  const showBanner = useCallback(
    (options: ToastBannerOptions) => {
      queueRef.current.push(options);
      if (!showingRef.current) playNext();
    },
    [playNext],
  );

  const handlePress = useCallback(() => {
    const onPress = current?.onPress;
    slideOut(() => {
      onPress?.();
      setTimeout(playNext, GAP_MS);
    });
  }, [current, playNext, slideOut]);

  // Swipe up to dismiss (native only; web falls back to tap-to-dismiss).
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Platform.OS !== "web" && gesture.dy < -6,
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dy < 0) translateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy < -40) {
            slideOut(() => setTimeout(playNext, GAP_MS));
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              friction: 9,
              tension: 70,
            }).start();
          }
        },
      }),
    [playNext, slideOut, translateY],
  );

  const value = useMemo(() => ({ showBanner }), [showBanner]);

  return (
    <ToastBannerContext.Provider value={value}>
      {children}
      {current ? (
        <Animated.View
          {...panResponder.panHandlers}
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { paddingTop: insets.top + 8, transform: [{ translateY }] },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handlePress}
            style={styles.banner}
          >
            <View style={styles.accent} />
            {current.avatarUrl ? (
              <Image source={{ uri: current.avatarUrl }} style={styles.avatar} />
            ) : current.emoji ? (
              <View style={[styles.bubble, { backgroundColor: "#2A2A2A" }]}>
                <Text style={styles.emoji}>{current.emoji}</Text>
              </View>
            ) : (
              <View style={[styles.bubble, { backgroundColor: current.color ?? BRAND }]}>
                <Text style={styles.initials}>{current.initials ?? "?"}</Text>
              </View>
            )}
            <View style={styles.textCol}>
              <Text style={styles.title} numberOfLines={1}>
                {current.title}
              </Text>
              {current.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {current.subtitle}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </ToastBannerContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    zIndex: 9999,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  accent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: BRAND,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#2A2A2A" },
  bubble: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 20 },
  initials: { color: "#fff", fontSize: 15, fontWeight: "800" },
  textCol: { flex: 1 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700" },
  subtitle: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 2 },
});
