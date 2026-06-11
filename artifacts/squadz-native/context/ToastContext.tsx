import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type ToastAction = { label: string; onPress: () => void };

export type ToastOptions = {
  durationMs?: number;
  action?: ToastAction;
};

type ToastContextType = {
  showToast: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

export function useToast(): ToastContextType {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<ToastAction | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setMessage(null);
      setAction(null);
    });
  }, [opacity]);

  const showToast = useCallback((msg: string, options?: ToastOptions) => {
    const durationMs = options?.durationMs ?? (options?.action ? 8000 : 3000);
    const toastAction = options?.action ?? null;

    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(msg);
    setAction(toastAction);

    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setMessage(null);
        setAction(null);
      });
    }, durationMs);
  }, [opacity]);

  const handleActionPress = useCallback(() => {
    action?.onPress();
    dismiss();
  }, [action, dismiss]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message ? (
        <Animated.View
          pointerEvents={action ? "box-none" : "none"}
          style={[
            styles.toast,
            {
              bottom: insets.bottom + 96,
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity,
            },
          ]}
        >
          <View style={[styles.dot, { backgroundColor: colors.destructive }]} />
          <Text style={[styles.text, { color: colors.foreground }]}>{message}</Text>
          {action ? (
            <TouchableOpacity onPress={handleActionPress} style={styles.actionButton} hitSlop={8}>
              <Text style={[styles.actionLabel, { color: colors.primary ?? "#A855F7" }]}>
                {action.label}
              </Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    maxWidth: 340,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  actionButton: {
    flexShrink: 0,
    marginLeft: 4,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
