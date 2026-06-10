import { useEffect, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

type Props = {
  uri: string;
  headers?: Record<string, string>;
  style?: ViewStyle;
};

/**
 * Web video player for protected media. A DOM `<video>` element cannot attach
 * custom auth headers to its request, so when `headers` are supplied (the media
 * lives behind the auth-gated `/api/storage/objects/*` route) we fetch the bytes
 * with the headers ourselves and hand the element a same-origin blob URL.
 * Cross-origin redirects (e.g. Supabase signed URLs) are followed by `fetch`,
 * which correctly drops the Authorization header on the redirected request.
 */
export default function AttachmentVideo({ uri, headers, style }: Props) {
  const needsAuth = Boolean(headers && Object.keys(headers).length > 0);
  const [blobUri, setBlobUri] = useState<string | null>(null);

  useEffect(() => {
    if (!needsAuth) {
      setBlobUri(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(uri, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUri(objectUrl);
      } catch {
        // Leave blobUri null; the element simply won't play rather than crash.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, needsAuth, headers]);

  const src = needsAuth ? blobUri : uri;

  return (
    <View style={[styles.wrap, style]}>
      {src ? (
        <video
          src={src}
          controls
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", backgroundColor: "#000" }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#000" },
});
