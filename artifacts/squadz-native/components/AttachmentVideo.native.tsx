import { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

type Props = {
  uri: string;
  headers?: Record<string, string>;
  style?: ViewStyle;
};

export default function AttachmentVideo({ uri, headers, style }: Props) {
  const player = useVideoPlayer({ uri, headers }, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Player may already be released.
      }
    };
  }, [player]);

  return (
    <View style={[styles.wrap, style]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls
        allowsFullscreen
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#000" },
});
