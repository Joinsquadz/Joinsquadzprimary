import { StyleSheet, View, type ViewStyle } from "react-native";

type Props = {
  uri: string;
  headers?: Record<string, string>;
  style?: ViewStyle;
};

export default function AttachmentVideo({ uri, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <video
        src={uri}
        controls
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover", backgroundColor: "#000" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#000" },
});
