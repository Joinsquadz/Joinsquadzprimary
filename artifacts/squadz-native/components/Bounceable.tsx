import React, { useCallback, useImperativeHandle, useRef } from "react";
import {
  Animated,
  GestureResponderEvent,
  StyleProp,
  TouchableWithoutFeedback,
  ViewStyle,
} from "react-native";

export type BounceableHandle = { bounce: () => void };

type Props = {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Peak scale of the bounce (default 1.35). */
  peak?: number;
};

/**
 * Wraps tappable content and plays a springy "bounce" on press (B1 delight).
 * Also exposes an imperative `bounce()` so a parent can trigger the animation
 * when state changes from elsewhere (e.g. an optimistic reaction toggle).
 */
export const Bounceable = React.forwardRef<BounceableHandle, Props>(
  ({ children, onPress, disabled, style, peak = 1.35 }, ref) => {
    const scale = useRef(new Animated.Value(1)).current;

    const bounce = useCallback(() => {
      scale.stopAnimation();
      scale.setValue(1);
      Animated.sequence([
        Animated.spring(scale, { toValue: peak, useNativeDriver: true, friction: 4, tension: 140 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 120 }),
      ]).start();
    }, [scale, peak]);

    useImperativeHandle(ref, () => ({ bounce }), [bounce]);

    const handlePress = useCallback(
      (e: GestureResponderEvent) => {
        if (disabled) return;
        bounce();
        onPress?.(e);
      },
      [disabled, bounce, onPress],
    );

    return (
      <TouchableWithoutFeedback onPress={handlePress} disabled={disabled}>
        <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
      </TouchableWithoutFeedback>
    );
  },
);

Bounceable.displayName = "Bounceable";
