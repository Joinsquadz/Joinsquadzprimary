import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { resolveApiBase, resolveUploadedUrl } from "@/lib/api";

describe("resolveApiBase", () => {
  it("uses an explicit absolute API URL when configured", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.example.com/");
    expect(resolveApiBase()).toBe("https://api.example.com");
    vi.unstubAllEnvs();
  });

  it("uses the dev domain for native development", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    vi.stubEnv("EXPO_PUBLIC_DOMAIN", "dev.example.com");
    expect(resolveApiBase()).toBe("https://dev.example.com");
    vi.unstubAllEnvs();
  });

  it("falls back to the production API for native release safety", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    vi.stubEnv("EXPO_PUBLIC_DOMAIN", "");
    expect(resolveApiBase()).toBe("https://joinsquadz.com");
    vi.unstubAllEnvs();
  });

  it("rejects a relative API URL instead of allowing a native relative request", () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "/api");
    vi.stubEnv("EXPO_PUBLIC_DOMAIN", "");
    expect(resolveApiBase()).toBe("https://joinsquadz.com");
    vi.unstubAllEnvs();
  });
});

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
