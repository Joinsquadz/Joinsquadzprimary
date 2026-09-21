// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  TouchableOpacity: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => (
    <button data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
  ActivityIndicator: () => <span>Loading</span>,
  TextInput: () => <input />,
  StyleSheet: { create: <T,>(styles: T) => styles },
  Platform: { OS: "web" },
}));

vi.mock("expo-router", () => ({
  router: {
    back: vi.fn(),
    canGoBack: vi.fn(() => false),
    push: vi.fn(),
    replace: vi.fn(),
  },
  useLocalSearchParams: () => ({ code: "slow-invite" }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: () => <span>icon</span>,
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#000",
    border: "#222",
    card: "#111",
    destructive: "#f00",
    foreground: "#fff",
    green: "#0f0",
    mutedForeground: "#999",
    primary: "#f60",
    textDim: "#777",
  }),
}));

vi.mock("@/context/AppContext", () => ({
  useData: () => ({ isLoggedIn: false, joinSquadByCode: vi.fn() }),
  useAuth: () => ({ isLoggedIn: false }),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

vi.mock("@/lib/pendingInvite", () => ({
  savePendingInviteCode: vi.fn(),
  clearPendingInviteCode: vi.fn(),
}));

import SquadJoinScreen from "../join";

describe("SquadJoinScreen invite preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("replaces a hanging lookup with a retryable error state after the standard timeout", async () => {
    render(<SquadJoinScreen />);

    expect(screen.getByText("Checking invite code…")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText("Couldn't load invite")).toBeTruthy();
    expect(screen.getByText("We couldn't load this invite. Check your connection, then try again.")).toBeTruthy();
    expect(screen.getByTestId("retry-squad-invite-preview")).toBeTruthy();
    expect(screen.queryByText("Checking invite code…")).toBeNull();
  });
});