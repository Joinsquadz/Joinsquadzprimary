import { View, Text, StyleSheet } from "react-native";

interface UserAvatarProps {
  initials: string;
  color: string;
  size?: number;
  fontSize?: number;
}

export function UserAvatar({ initials, color, size = 40, fontSize = 14 }: UserAvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    >
      <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#fff",
    fontWeight: "800",
  },
});
