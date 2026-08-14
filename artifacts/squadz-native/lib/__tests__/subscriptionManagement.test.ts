import { describe, expect, it } from "vitest";
import { subscriptionManagementUrl } from "../subscriptionManagement";

describe("subscriptionManagementUrl", () => {
  it("opens the App Store subscription manager on iOS", () => {
    expect(subscriptionManagementUrl("ios")).toBe(
      "https://apps.apple.com/account/subscriptions",
    );
  });

  it("opens this app's Google Play subscription manager on Android", () => {
    expect(subscriptionManagementUrl("android")).toBe(
      "https://play.google.com/store/account/subscriptions?package=com.squadz.app",
    );
  });

  it("does not offer a native subscription manager on web", () => {
    expect(subscriptionManagementUrl("web")).toBeNull();
  });
});