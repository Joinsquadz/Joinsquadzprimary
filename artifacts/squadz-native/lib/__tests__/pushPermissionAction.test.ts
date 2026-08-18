import { describe, it, expect } from "vitest";
import { decidePushPermissionAction } from "../pushPermissionAction";

describe("decidePushPermissionAction", () => {
  it("registers the device when permission is already granted", () => {
    expect(decidePushPermissionAction({ granted: true, canAskAgain: true }, false)).toBe("register");
    expect(decidePushPermissionAction({ granted: true, canAskAgain: false }, true)).toBe("register");
  });

  it("asks the OS while the prompt is still available", () => {
    expect(decidePushPermissionAction({ granted: false, canAskAgain: true }, false)).toBe("request");
    expect(decidePushPermissionAction({ granted: false, canAskAgain: true }, true)).toBe("request");
  });

  it("never yanks the user into Settings on an automatic check", () => {
    // The permanently-denied user opening the app just sees the banner.
    expect(decidePushPermissionAction({ granted: false, canAskAgain: false }, false)).toBe(
      "show-banner",
    );
  });

  it("opens Settings when a permanently-denied user taps Fix", () => {
    // Re-requesting here is a silent no-op, which made "Fix" look broken.
    expect(decidePushPermissionAction({ granted: false, canAskAgain: false }, true)).toBe(
      "open-settings",
    );
  });
});
