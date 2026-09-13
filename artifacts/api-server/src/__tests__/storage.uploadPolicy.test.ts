import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  validateUploadMetadata,
} from "../lib/uploadPolicy";

describe("storage upload policy", () => {
  it.each([MAX_UPLOAD_BYTES - 1, MAX_UPLOAD_BYTES])(
    "accepts supported video at %i bytes",
    (size) => {
      expect(validateUploadMetadata(size, "video/mp4")).toBeNull();
    },
  );

  it("rejects a video one byte above 500 MB before upload", () => {
    expect(validateUploadMetadata(MAX_UPLOAD_BYTES + 1, "video/mp4")).toEqual({
      status: 413,
      error: "File too large. Photos and videos must be 500 MB or smaller.",
    });
  });

  it("continues to reject unsupported MIME types within the size limit", () => {
    expect(validateUploadMetadata(1024, "application/octet-stream")).toEqual({
      status: 400,
      error: "Unsupported file type. Only photos (JPEG, PNG, HEIC, WebP) and videos (MP4, MOV) are allowed.",
    });
  });
});