import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

type Props = {
  uri: string;
  headers?: Record<string, string>;
  style?: ViewStyle;
};

/**
 * Web video player for protected media. A DOM `<video>` element cannot attach
 * custom auth headers to its request. For protected Supabase media we first
 * resolve the authenticated object path to a short-lived signed URL. The video
 * element can request byte ranges from that URL and begin playback immediately.
 * Legacy storage falls back to an authenticated Blob fetch for compatibility.
 */
export default function AttachmentVideo({ uri, headers, style }: Props) {
  const needsAuth = Boolean(headers && Object.keys(headers).length > 0);
  const headersKey = JSON.stringify(headers ?? {});
  const stableHeaders = useMemo<Record<string, string> | undefined>(
    () => (needsAuth ? JSON.parse(headersKey) : undefined),
    [headersKey, needsAuth],
  );
  const [streamUri, setStreamUri] = useState<string | null>(null);
  const [blobUri, setBlobUri] = useState<string | null>(null);
  const [useBlobFallback, setUseBlobFallback] = useState(false);

  useEffect(() => {
    setStreamUri(null);
    setBlobUri(null);
    setUseBlobFallback(false);
    if (!needsAuth) {
      return;
    }
    if (!uri.includes("/objects/supabase/")) {
      setUseBlobFallback(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const separator = uri.includes("?") ? "&" : "?";
        const res = await fetch(`${uri}${separator}stream=1`, { headers: stableHeaders });
        if (!res.ok) throw new Error(`Stream URL request failed: ${res.status}`);
        const body: unknown = await res.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("url" in body) ||
          typeof body.url !== "string"
        ) {
          throw new Error("Stream URL response was invalid");
        }
        if (!cancelled) setStreamUri(body.url);
      } catch {
        if (!cancelled) setUseBlobFallback(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, needsAuth, stableHeaders]);

  useEffect(() => {
    if (!needsAuth || !useBlobFallback) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(uri, { headers: stableHeaders });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUri(objectUrl);
      } catch {
        // Leave the player empty rather than crashing the surrounding feed.
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, needsAuth, stableHeaders, useBlobFallback]);

  const handleStreamError = useCallback(() => {
    if (needsAuth && streamUri && !blobUri) {
      setStreamUri(null);
      setUseBlobFallback(true);
    }
  }, [needsAuth, streamUri, blobUri]);

  const src = needsAuth ? blobUri ?? streamUri : uri;

  return (
    <View style={[styles.wrap, style]}>
      {src ? (
        <video
          src={src}
          controls
          playsInline
          onError={handleStreamError}
          style={{ width: "100%", height: "100%", objectFit: "cover", backgroundColor: "#000" }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#000" },
});
