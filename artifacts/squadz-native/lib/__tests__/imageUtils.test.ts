import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted so these references are available when vi.mock factories run
// ---------------------------------------------------------------------------
const { mockManipulateAsync, mockVideoCompress, mockTrack } = vi.hoisted(() => ({
  mockManipulateAsync: vi.fn(),
  mockVideoCompress: vi.fn(),
  mockTrack: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock expo-image-manipulator
// ---------------------------------------------------------------------------
vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: mockManipulateAsync,
  SaveFormat: { JPEG: "jpeg" },
}));

// ---------------------------------------------------------------------------
// Mock react-native-compressor (dynamic import inside stripVideoExif)
// ---------------------------------------------------------------------------
vi.mock("react-native-compressor", () => ({
  Video: { compress: mockVideoCompress },
}));

// ---------------------------------------------------------------------------
// Mock react-native Platform — mutable so tests can switch ios/web
// ---------------------------------------------------------------------------
let _platform: "ios" | "android" | "web" = "ios";
vi.mock("react-native", () => ({
  Platform: {
    get OS() { return _platform; },
  },
}));

// ---------------------------------------------------------------------------
// Mock analytics — verify fallback events fire (and only then)
// ---------------------------------------------------------------------------
vi.mock("@/lib/analytics", () => ({
  track: mockTrack,
}));

import { stripImageExif, stripVideoExif, stripMediaExif } from "../imageUtils";

// ---------------------------------------------------------------------------
// stripImageExif
// ---------------------------------------------------------------------------
describe("stripImageExif", () => {
  beforeEach(() => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://stripped.jpg" });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls ImageManipulator.manipulateAsync for image/* mimeTypes", async () => {
    const result = await stripImageExif("file://original.jpg", "image/jpeg");
    expect(mockManipulateAsync).toHaveBeenCalledWith(
      "file://original.jpg",
      [],
      { compress: 0.92, format: "jpeg" },
    );
    expect(result.uri).toBe("file://stripped.jpg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("strips HEIC and PNG — output is always image/jpeg", async () => {
    await stripImageExif("file://photo.heic", "image/heic");
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockManipulateAsync.mockResolvedValue({ uri: "file://stripped.jpg" });
    const r = await stripImageExif("file://photo.png", "image/png");
    expect(r.mimeType).toBe("image/jpeg");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("returns original uri/mimeType for video/* without calling manipulator", async () => {
    const result = await stripImageExif("file://clip.mp4", "video/mp4");
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://clip.mp4", mimeType: "video/mp4" });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("returns original uri/mimeType for unknown mimeTypes (no manipulator call)", async () => {
    const result = await stripImageExif("file://doc.pdf", "application/pdf");
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://doc.pdf", mimeType: "application/pdf" });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  // ── Retry behaviour ───────────────────────────────────────────────────────

  it("retries once on first failure and returns the stripped result without logging", async () => {
    mockManipulateAsync
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValue({ uri: "file://stripped-retry.jpg" });

    const result = await stripImageExif("file://original.jpg", "image/jpeg");

    expect(mockManipulateAsync).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ uri: "file://stripped-retry.jpg", mimeType: "image/jpeg" });
    // No fallback event — stripping succeeded on the retry.
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("falls back to original and fires exif_strip_fallback when both attempts fail", async () => {
    const err = new Error("codec unsupported");
    mockManipulateAsync.mockRejectedValue(err);

    const result = await stripImageExif("file://bad.jpg", "image/jpeg", "vault");

    // Both attempts were made.
    expect(mockManipulateAsync).toHaveBeenCalledTimes(2);
    // Original file returned unchanged.
    expect(result).toEqual({ uri: "file://bad.jpg", mimeType: "image/jpeg" });
    // Analytics event fired exactly once with the right shape.
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith("exif_strip_fallback", {
      surface: "vault",
      mediaType: "image",
      error: "codec unsupported",
    });
  });

  it("uses surface='unknown' in the fallback event when no surface is provided", async () => {
    mockManipulateAsync.mockRejectedValue(new Error("fail"));

    await stripImageExif("file://bad.jpg", "image/jpeg");

    expect(mockTrack).toHaveBeenCalledWith("exif_strip_fallback", expect.objectContaining({
      surface: "unknown",
    }));
  });
});

// ---------------------------------------------------------------------------
// stripVideoExif
// ---------------------------------------------------------------------------
describe("stripVideoExif", () => {
  afterEach(() => {
    vi.clearAllMocks();
    _platform = "ios";
  });

  it("calls Video.compress on native for video/* mimeTypes", async () => {
    _platform = "ios";
    mockVideoCompress.mockResolvedValue("file://compressed.mp4");
    const result = await stripVideoExif("file://original.mp4", "video/mp4");
    expect(mockVideoCompress).toHaveBeenCalledWith("file://original.mp4", {
      compressionMethod: "auto",
    });
    expect(result.uri).toBe("file://compressed.mp4");
    expect(result.mimeType).toBe("video/mp4");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("is a no-op on web (Platform.OS === 'web') — never calls compressor", async () => {
    _platform = "web";
    const result = await stripVideoExif("file://clip.mov", "video/quicktime");
    expect(mockVideoCompress).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://clip.mov", mimeType: "video/quicktime" });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("returns original for non-video mimeTypes", async () => {
    _platform = "ios";
    const result = await stripVideoExif("file://photo.jpg", "image/jpeg");
    expect(mockVideoCompress).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  // ── Retry behaviour ───────────────────────────────────────────────────────

  it("retries once on first failure and returns the compressed result without logging", async () => {
    _platform = "ios";
    mockVideoCompress
      .mockRejectedValueOnce(new Error("transient codec error"))
      .mockResolvedValue("file://compressed-retry.mp4");

    const result = await stripVideoExif("file://original.mp4", "video/mp4");

    expect(mockVideoCompress).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ uri: "file://compressed-retry.mp4", mimeType: "video/mp4" });
    // No fallback event — stripping succeeded on the retry.
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("falls back to original and fires exif_strip_fallback when both attempts fail", async () => {
    _platform = "ios";
    const err = new Error("codec error");
    mockVideoCompress.mockRejectedValue(err);

    const result = await stripVideoExif("file://clip.mp4", "video/mp4", "chat");

    // Both attempts were made.
    expect(mockVideoCompress).toHaveBeenCalledTimes(2);
    // Original file returned unchanged.
    expect(result).toEqual({ uri: "file://clip.mp4", mimeType: "video/mp4" });
    // Analytics event fired exactly once with the right shape.
    expect(mockTrack).toHaveBeenCalledOnce();
    expect(mockTrack).toHaveBeenCalledWith("exif_strip_fallback", {
      surface: "chat",
      mediaType: "video",
      error: "codec error",
    });
  });

  it("uses surface='unknown' in the fallback event when no surface is provided", async () => {
    _platform = "ios";
    mockVideoCompress.mockRejectedValue(new Error("fail"));

    await stripVideoExif("file://clip.mp4", "video/mp4");

    expect(mockTrack).toHaveBeenCalledWith("exif_strip_fallback", expect.objectContaining({
      surface: "unknown",
    }));
  });
});

// ---------------------------------------------------------------------------
// stripMediaExif — unified dispatcher
// ---------------------------------------------------------------------------
describe("stripMediaExif", () => {
  beforeEach(() => {
    _platform = "ios";
    mockManipulateAsync.mockResolvedValue({ uri: "file://stripped.jpg" });
    mockVideoCompress.mockResolvedValue("file://compressed.mp4");
  });
  afterEach(() => {
    vi.clearAllMocks();
    _platform = "ios";
  });

  it("routes image/* to stripImageExif (calls manipulator)", async () => {
    const result = await stripMediaExif("file://photo.jpg", "image/jpeg");
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
    expect(result.mimeType).toBe("image/jpeg");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("routes video/* to stripVideoExif (calls compressor on native)", async () => {
    const result = await stripMediaExif("file://clip.mp4", "video/mp4");
    expect(mockVideoCompress).toHaveBeenCalledTimes(1);
    expect(result.uri).toBe("file://compressed.mp4");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("returns original for unknown types without calling any processor", async () => {
    const result = await stripMediaExif("file://doc.pdf", "application/pdf");
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(mockVideoCompress).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://doc.pdf", mimeType: "application/pdf" });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("passes the surface label through to the image fallback event", async () => {
    mockManipulateAsync.mockRejectedValue(new Error("fail"));

    await stripMediaExif("file://photo.jpg", "image/jpeg", "moments");

    expect(mockTrack).toHaveBeenCalledWith("exif_strip_fallback", expect.objectContaining({
      surface: "moments",
      mediaType: "image",
    }));
  });

  it("passes the surface label through to the video fallback event", async () => {
    _platform = "ios";
    mockVideoCompress.mockRejectedValue(new Error("fail"));

    await stripMediaExif("file://clip.mp4", "video/mp4", "feed");

    expect(mockTrack).toHaveBeenCalledWith("exif_strip_fallback", expect.objectContaining({
      surface: "feed",
      mediaType: "video",
    }));
  });
});
