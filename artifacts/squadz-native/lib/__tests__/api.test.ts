import { describe, it, expect, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { resolveUploadedUrl } from "@/lib/api";

describe("resolveUploadedUrl", () => {
  it("returns a full public Supabase URL verbatim (public avatar upload)", () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/squadz-media/uploads/x.jpg";
    expect(resolveUploadedUrl(url)).toBe(url);
  });

  it("also passes through plain http URLs", () => {
    const url = "http://example.com/a.png";
    expect(resolveUploadedUrl(url)).toBe(url);
  });

  it("proxies a relative protected object path through /api/storage", () => {
    expect(resolveUploadedUrl("/objects/supabase/uploads/x.jpg")).toBe(
      "/api/storage/objects/supabase/uploads/x.jpg",
    );
  });

  it("does not prepend the proxy prefix to an https URL (regression for broken avatar)", () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/squadz-media/uploads/x.jpg";
    expect(resolveUploadedUrl(url).startsWith("/api/storage")).toBe(false);
  });
});
