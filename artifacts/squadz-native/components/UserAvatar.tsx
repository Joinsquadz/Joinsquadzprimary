import { useState, useEffect } from "react";
import { View, Text, Image, StyleSheet } from "react-native";

interface UserAvatarProps {
  initials: string;
  color: string;
  imageUrl?: string | null;
  size?: number;
  fontSize?: number;
}

export function UserAvatar({ initials, color, imageUrl, size = 40, fontSize = 14 }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);

  // Reset the failure flag whenever the source changes so a new url gets a fresh try.
  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  const showImage = !!imageUrl && !failed;

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
      {showImage ? (
        <Image
          source={{ uri: imageUrl as string }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: {
    color: "#fff",
    fontWeight: "800",
  },
});
