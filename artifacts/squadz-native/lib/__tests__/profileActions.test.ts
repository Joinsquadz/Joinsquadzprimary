import { describe, expect, it } from "vitest";
import { friendCtaFor } from "../profileActions";

describe("friendCtaFor", () => {
  it("offers Add friend to a stranger", () => {
    expect(friendCtaFor({ blocked: false, isFriend: false, isPending: false })).toBe("add");
  });

  it("shows the pending state after a request is sent", () => {
    expect(friendCtaFor({ blocked: false, isFriend: false, isPending: true })).toBe("pending");
  });

  it("offers Remove friend to an actual friend", () => {
    expect(friendCtaFor({ blocked: false, isFriend: true, isPending: false })).toBe("remove");
  });

  it("hides every friend action once a block exists, even with a stale friends list", () => {
    // Blocking severs the friendship server-side; the cached list lags behind.
    // Showing "Remove friend" beside "Blocked" is the bug this guards.
    expect(friendCtaFor({ blocked: true, isFriend: true, isPending: false })).toBe("none");
    expect(friendCtaFor({ blocked: true, isFriend: false, isPending: true })).toBe("none");
    expect(friendCtaFor({ blocked: true, isFriend: false, isPending: false })).toBe("none");
  });

  it("never offers friend actions on your own profile", () => {
    expect(friendCtaFor({ blocked: false, isFriend: false, isPending: false, isSelf: true })).toBe(
      "none",
    );
  });
});
