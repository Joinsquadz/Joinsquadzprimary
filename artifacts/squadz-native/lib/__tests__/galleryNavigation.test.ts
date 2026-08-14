import { describe, expect, it } from "vitest";
import { galleryNeighborIndex } from "../galleryNavigation";

describe("galleryNeighborIndex", () => {
  it("moves through an ordered gallery", () => {
    expect(galleryNeighborIndex(1, "previous", 3)).toBe(0);
    expect(galleryNeighborIndex(1, "next", 3)).toBe(2);
  });

  it("does not allow navigation beyond either boundary", () => {
    expect(galleryNeighborIndex(0, "previous", 3)).toBeNull();
    expect(galleryNeighborIndex(2, "next", 3)).toBeNull();
  });

  it("does not navigate an unknown selection", () => {
    expect(galleryNeighborIndex(-1, "next", 3)).toBeNull();
    expect(galleryNeighborIndex(4, "previous", 3)).toBeNull();
  });
});