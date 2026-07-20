import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted so these references are available when vi.mock factories run
// ---------------------------------------------------------------------------
const { mockManipulateAsync, mockVideoCompress } = vi.hoisted(() => ({
  mockManipulateAsync: vi.fn(),
  mockVideoCompress: vi.fn(),
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
  });

  it("strips HEIC and PNG — output is always image/jpeg", async () => {
    await stripImageExif("file://photo.heic", "image/heic");
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockManipulateAsync.mockResolvedValue({ uri: "file://stripped.jpg" });
    const r = await stripImageExif("file://photo.png", "image/png");
    expect(r.mimeType).toBe("image/jpeg");
  });

  it("returns original uri/mimeType for video/* without calling manipulator", async () => {
    const result = await stripImageExif("file://clip.mp4", "video/mp4");
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://clip.mp4", mimeType: "video/mp4" });
  });

  it("falls back to original uri/mimeType when manipulateAsync throws", async () => {
    mockManipulateAsync.mockRejectedValue(new Error("unsupported"));
    const result = await stripImageExif("file://bad.jpg", "image/jpeg");
    expect(result).toEqual({ uri: "file://bad.jpg", mimeType: "image/jpeg" });
  });

  it("returns original uri/mimeType for unknown mimeTypes (no manipulator call)", async () => {
    const result = await stripImageExif("file://doc.pdf", "application/pdf");
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://doc.pdf", mimeType: "application/pdf" });
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
  });

  it("is a no-op on web (Platform.OS === 'web') — never calls compressor", async () => {
    _platform = "web";
    const result = await stripVideoExif("file://clip.mov", "video/quicktime");
    expect(mockVideoCompress).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://clip.mov", mimeType: "video/quicktime" });
  });

  it("returns original for non-video mimeTypes", async () => {
    _platform = "ios";
    const result = await stripVideoExif("file://photo.jpg", "image/jpeg");
    expect(mockVideoCompress).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://photo.jpg", mimeType: "image/jpeg" });
  });

  it("falls back to original uri/mimeType when Video.compress throws", async () => {
    _platform = "ios";
    mockVideoCompress.mockRejectedValue(new Error("codec error"));
    const result = await stripVideoExif("file://clip.mp4", "video/mp4");
    expect(result).toEqual({ uri: "file://clip.mp4", mimeType: "video/mp4" });
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
  });

  it("routes video/* to stripVideoExif (calls compressor on native)", async () => {
    const result = await stripMediaExif("file://clip.mp4", "video/mp4");
    expect(mockVideoCompress).toHaveBeenCalledTimes(1);
    expect(result.uri).toBe("file://compressed.mp4");
  });

  it("returns original for unknown types without calling any processor", async () => {
    const result = await stripMediaExif("file://doc.pdf", "application/pdf");
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(mockVideoCompress).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: "file://doc.pdf", mimeType: "application/pdf" });
  });
});
