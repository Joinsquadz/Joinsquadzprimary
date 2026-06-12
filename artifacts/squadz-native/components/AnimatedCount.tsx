import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleProp, TextStyle } from "react-native";

type Props = {
  value: number;
  style?: StyleProp<TextStyle>;
};

/**
 * Renders a number that slides up (and the old value slides out) whenever the
 * value changes — the "slide-up count" half of the B1 reaction delight.
 */
export function AnimatedCount({ value, style }: Props) {
  const [display, setDisplay] = useState(value);
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    const goingUp = value > prev.current;
    prev.current = value;
    // Slide current value out, swap, then slide the new value into place.
    Animated.timing(translateY, {
      toValue: goingUp ? -10 : 10,
      duration: 110,
      useNativeDriver: true,
    }).start(() => {
      setDisplay(value);
      translateY.setValue(goingUp ? 10 : -10);
      opacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 130, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 130, useNativeDriver: true }),
      ]).start();
    });
  }, [value, translateY, opacity]);

  return (
    <Animated.Text style={[style, { opacity, transform: [{ translateY }] }]}>
      {display}
    </Animated.Text>
  );
}
