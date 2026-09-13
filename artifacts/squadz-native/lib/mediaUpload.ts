import { Platform } from "react-native";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { stripMediaExif } from "@/lib/imageUtils";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

type UploadInput = {
  uri: string;
  fileName: string;
  mimeType: string;
  fallbackSize: number;
  authToken: string | null;
  surface: string;
};

type UploadResult = {
  objectPath: string;
  mimeType: string;
  byteSize: number;
};

export class MediaUploadError extends Error {
  constructor(
    public readonly kind: "too_large" | "request_failed" | "upload_failed",
  ) {
    super(kind);
  }
}

async function localFileSize(uri: string, fallbackSize: number): Promise<number> {
  if (Platform.OS !== "web") {
    try {
      // Native's legacy file API streams the local file directly to a presigned
      // URL. Dynamic import keeps the Expo web bundle on its browser-safe path.
      const FileSystem = await import("expo-file-system/legacy");
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && typeof info.size === "number") return info.size;
    } catch {
      // Fall through to the browser-compatible Blob path below.
    }
  }

  const response = await fetch(uri);
  const blob = await response.blob();
  return blob.size || fallbackSize;
}

async function putLocalFile(uploadURL: string, uri: string, mimeType: string): Promise<boolean> {
  if (Platform.OS !== "web") {
    try {
      const FileSystem = await import("expo-file-system/legacy");
      const result = await FileSystem.uploadAsync(uploadURL, uri, {
        httpMethod: "PUT",
        headers: { "Content-Type": mimeType },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      });
      return result.status >= 200 && result.status < 300;
    } catch {
      // Some uncommon URI schemes are unsupported by the native uploader. Use
      // the existing Blob upload as a compatibility fallback rather than fail.
    }
  }

  const response = await fetch(uri);
  const blob = await response.blob();
  const put = await fetch(uploadURL, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": mimeType },
  });
  return put.ok;
}

/**
 * Strip metadata, validate the resulting file, obtain a signed URL, then upload
 * directly from native storage. This avoids copying every native photo/video
 * through JavaScript memory before the network transfer.
 */
export async function uploadMediaDirect({
  uri,
  fileName,
  mimeType,
  fallbackSize,
  authToken,
  surface,
}: UploadInput): Promise<UploadResult> {
  const prepared = await stripMediaExif(uri, mimeType, surface);
  const byteSize = await localFileSize(prepared.uri, fallbackSize);
  if (byteSize > MAX_UPLOAD_BYTES) throw new MediaUploadError("too_large");

  const urlResponse = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: fileName,
      size: byteSize,
      contentType: prepared.mimeType,
    }),
  });
  if (!urlResponse.ok) throw new MediaUploadError("request_failed");

  const { uploadURL, objectPath } = (await urlResponse.json()) as {
    uploadURL: string;
    objectPath: string;
  };
  if (!(await putLocalFile(uploadURL, prepared.uri, prepared.mimeType))) {
    throw new MediaUploadError("upload_failed");
  }

  return { objectPath, mimeType: prepared.mimeType, byteSize };
}