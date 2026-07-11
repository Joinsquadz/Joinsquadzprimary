import { describe, it, expect, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Linking: { openURL: vi.fn() } }));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

import { mapsUrl } from "@/lib/mapLink";

describe("mapsUrl", () => {
  it("builds an Apple Maps URL on iOS", () => {
    expect(mapsUrl("123 Main St, Springfield", "ios")).toBe(
      "http://maps.apple.com/?q=123%20Main%20St%2C%20Springfield",
    );
  });

  it("builds a geo: URL on Android", () => {
    expect(mapsUrl("123 Main St, Springfield", "android")).toBe(
      "geo:0,0?q=123%20Main%20St%2C%20Springfield",
    );
  });

  it("builds a Google Maps search URL on web/other", () => {
    expect(mapsUrl("123 Main St", "web")).toBe(
      "https://www.google.com/maps/search/?api=1&query=123%20Main%20St",
    );
  });

  it("trims surrounding whitespace before encoding", () => {
    expect(mapsUrl("  Central Park  ", "ios")).toBe("http://maps.apple.com/?q=Central%20Park");
  });
});
