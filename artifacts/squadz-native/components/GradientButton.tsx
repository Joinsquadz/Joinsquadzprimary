import { TouchableOpacity, Text, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export function GradientButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={[styles.shadow, style]}>
      <LinearGradient
        colors={["#FF5C3A", "#FF8050"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.btn}
      >
        <Text style={styles.text}>{label}</Text>
      </LinearGradient>
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
  btn: { borderRadius: 15, paddingVertical: 15, paddingHorizontal: 20, alignItems: "center" },
  text: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
