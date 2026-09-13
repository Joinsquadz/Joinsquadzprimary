import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetInfoAsync,
  mockUploadAsync,
  mockStripMediaExif,
} = vi.hoisted(() => ({
  mockGetInfoAsync: vi.fn(),
  mockUploadAsync: vi.fn(),
  mockStripMediaExif: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-file-system/legacy", () => ({
  getInfoAsync: mockGetInfoAsync,
  uploadAsync: mockUploadAsync,
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));
vi.mock("@/lib/api", () => ({
  API_BASE: "",
  buildAuthHeaders: () => ({ Authorization: "Bearer test" }),
}));
vi.mock("@/lib/imageUtils", () => ({ stripMediaExif: mockStripMediaExif }));

import {
  MAX_UPLOAD_BYTES,
  MediaUploadError,
  uploadMediaDirect,
} from "../mediaUpload";

const input = {
  uri: "file://original.mp4",
  fileName: "clip.mp4",
  mimeType: "video/mp4",
  fallbackSize: 1,
  authToken: "test",
  surface: "vault",
};

describe("uploadMediaDirect size limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStripMediaExif.mockResolvedValue({
      uri: "file://prepared.mp4",
      mimeType: "video/mp4",
    });
    mockUploadAsync.mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ uploadURL: "https://upload.test", objectPath: "/objects/clip" }),
    }));
  });

  it.each([MAX_UPLOAD_BYTES - 1, MAX_UPLOAD_BYTES])(
    "streams a prepared native file at %i bytes",
    async (size) => {
      mockGetInfoAsync.mockResolvedValue({ exists: true, size });
      await expect(uploadMediaDirect(input)).resolves.toEqual({
        objectPath: "/objects/clip",
        mimeType: "video/mp4",
        byteSize: size,
      });
      expect(mockUploadAsync).toHaveBeenCalledWith(
        "https://upload.test",
        "file://prepared.mp4",
        expect.objectContaining({ httpMethod: "PUT" }),
      );
    },
  );

  it("rejects the processed file above 500 MB without requesting or uploading", async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: MAX_UPLOAD_BYTES + 1 });
    await expect(uploadMediaDirect(input)).rejects.toEqual(
      expect.objectContaining<Partial<MediaUploadError>>({ kind: "too_large" }),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});