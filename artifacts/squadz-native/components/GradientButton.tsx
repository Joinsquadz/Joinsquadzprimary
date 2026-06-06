import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export function GradientButton({
  label,
  onPress,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.shadow, disabled && styles.shadowDisabled, style]}
    >
      {disabled ? (
        <View style={[styles.btn, styles.btnDisabled]}>
          <Text style={[styles.text, styles.textDisabled]}>{label}</Text>
        </View>
      ) : (
        <LinearGradient
          colors={["#FF5C3A", "#FF8050"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.btn}
        >
          <Text style={styles.text}>{label}</Text>
        </LinearGradient>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: 15,
    shadowColor: "#FF5C3A",
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  shadowDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  btn: { borderRadius: 15, paddingVertical: 15, paddingHorizontal: 20, alignItems: "center" },
  btnDisabled: { backgroundColor: "#2a2a3a" },
  text: { fontSize: 15, fontWeight: "800", color: "#fff" },
  textDisabled: { color: "#555566" },
});
