// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: <T,>(styles: T) => styles },
}));

import AttachmentVideo from "../AttachmentVideo";

const headers = { Authorization: "Bearer test-token" };
const signedUri = "/api/storage/objects/supabase/uploads/video.mp4";
const legacyUri = "/api/storage/objects/uploads/video.mp4";

describe("AttachmentVideo", () => {
  const fetchMock = vi.fn();
  const createObjectURL = vi.fn(() => "blob:test-video");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses the signed URL without creating a Blob", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: "https://storage.example/signed-video" }),
    });

    const { container } = render(<AttachmentVideo uri={signedUri} headers={headers} />);

    await waitFor(() => {
      expect(container.querySelector("video")?.getAttribute("src")).toBe(
        "https://storage.example/signed-video",
      );
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${signedUri}?stream=1`);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("fetches a legacy protected object only once and keeps its Blob URL alive", async () => {
    const blob = new Blob(["video"]);
    fetchMock.mockResolvedValueOnce({ ok: true, blob: async () => blob });

    const { container, unmount } = render(
      <AttachmentVideo uri={legacyUri} headers={headers} />,
    );

    await waitFor(() => {
      expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:test-video");
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(legacyUri);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-video");
  });

  it("falls back to a Blob if signed URL playback fails", async () => {
    const blob = new Blob(["video"]);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://storage.example/signed-video" }),
      })
      .mockResolvedValueOnce({ ok: true, blob: async () => blob });

    const { container } = render(<AttachmentVideo uri={signedUri} headers={headers} />);
    const video = await waitFor(() => {
      const element = container.querySelector("video");
      expect(element?.getAttribute("src")).toBe("https://storage.example/signed-video");
      return element!;
    });

    act(() => video.dispatchEvent(new Event("error")));

    await waitFor(() => {
      expect(container.querySelector("video")?.getAttribute("src")).toBe("blob:test-video");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(signedUri);
  });
});