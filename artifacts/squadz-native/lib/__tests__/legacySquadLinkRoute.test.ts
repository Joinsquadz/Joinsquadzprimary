import { describe, expect, it } from "vitest";
import { legacySquadLinkAction } from "../legacySquadLinkRoute";

const base = {
  id: "public-squad-7",
  isLoggedIn: true,
  isAuthRestoring: false,
  squadsLoading: false,
  squadsAuthPending: false,
  squadsAuthError: false,
  memberSquadIds: [] as string[],
};

describe("legacy /squad/:id installed-app routing", () => {
  it("preserves logged-out recipients through login", () => {
    expect(legacySquadLinkAction({ ...base, isLoggedIn: false })).toBe("login");
  });

  it("sends authenticated nonmembers to the public join experience", () => {
    expect(legacySquadLinkAction(base)).toBe("join-public");
  });

  it("keeps members on the normal squad detail screen", () => {
    expect(
      legacySquadLinkAction({ ...base, memberSquadIds: ["public-squad-7"] }),
    ).toBe("member");
  });

  it("waits for auth and squad hydration instead of misrouting", () => {
    expect(legacySquadLinkAction({ ...base, isAuthRestoring: true })).toBe("wait");
    expect(legacySquadLinkAction({ ...base, squadsLoading: true })).toBe("wait");
  });
});