import { describe, it, expect, vi, beforeEach } from "vitest";
import { squadSignature, runSquadPoll } from "../squadLiveRefresh";
import type { SquadSnapshot } from "../squadLiveRefresh";

// ---------------------------------------------------------------------------
// squadSignature — pure function tests
// ---------------------------------------------------------------------------

describe("squadSignature", () => {
  const base: SquadSnapshot = {
    name: "The Crew",
    emoji: "🔥",
    description: "weekend fun",
    color: "#FF5C3A",
    isPublic: false,
    membersCanInvite: true,
    memberIds: ["u1", "u2", "u3"],
  };

  it("returns the same value for identical inputs", () => {
    expect(squadSignature(base)).toBe(squadSignature({ ...base }));
  });

  it("is sensitive to name changes", () => {
    expect(squadSignature(base)).not.toBe(squadSignature({ ...base, name: "New Name" }));
  });

  it("is sensitive to emoji changes", () => {
    expect(squadSignature(base)).not.toBe(squadSignature({ ...base, emoji: "🎉" }));
  });

  it("is sensitive to description changes", () => {
    expect(squadSignature(base)).not.toBe(
      squadSignature({ ...base, description: "changed description" }),
    );
  });

  it("is sensitive to color changes", () => {
    expect(squadSignature(base)).not.toBe(squadSignature({ ...base, color: "#A855F7" }));
  });

  it("is sensitive to isPublic changes", () => {
    expect(squadSignature(base)).not.toBe(squadSignature({ ...base, isPublic: true }));
  });

  it("is sensitive to membersCanInvite changes", () => {
    expect(squadSignature(base)).not.toBe(
      squadSignature({ ...base, membersCanInvite: false }),
    );
  });

  it("is sensitive to member list changes (addition)", () => {
    expect(squadSignature(base)).not.toBe(
      squadSignature({ ...base, memberIds: ["u1", "u2", "u3", "u4"] }),
    );
  });

  it("is sensitive to member list changes (removal)", () => {
    expect(squadSignature(base)).not.toBe(
      squadSignature({ ...base, memberIds: ["u1", "u2"] }),
    );
  });

  it("is ORDER-INSENSITIVE for memberIds (sorted before hashing)", () => {
    const shuffled = { ...base, memberIds: ["u3", "u1", "u2"] };
    expect(squadSignature(base)).toBe(squadSignature(shuffled));
  });

  it("treats null and empty string identically for name/emoji/description/color", () => {
    const withNulls: SquadSnapshot = {
      name: null,
      emoji: null,
      description: null,
      color: null,
      isPublic: null,
      membersCanInvite: null,
      memberIds: null,
    };
    const withEmptyish: SquadSnapshot = {
      name: "",
      emoji: "",
      description: "",
      color: "",
      isPublic: false,
      membersCanInvite: false,
      memberIds: [],
    };
    expect(squadSignature(withNulls)).toBe(squadSignature(withEmptyish));
  });
});

// ---------------------------------------------------------------------------
// runSquadPoll — behaviour tests
// ---------------------------------------------------------------------------

describe("runSquadPoll", () => {
  const API_BASE = "https://api.example.com";
  const SQUAD_ID = "squad-abc";
  const HEADERS = { Authorization: "Bearer tok" };

  /** Minimal squad snapshot used as the "initial" server response. */
  const baseSnapshot: SquadSnapshot = {
    name: "The Crew",
    emoji: "🔥",
    description: null,
    color: "#FF5C3A",
    isPublic: false,
    membersCanInvite: true,
    memberIds: ["u1", "u2"],
  };

  let lastSig: string | null;
  let isActive: boolean;
  let refreshSquads: ReturnType<typeof vi.fn>;
  let onChanged: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  function makeOpts() {
    return {
      id: SQUAD_ID,
      apiBase: API_BASE,
      getHeaders: () => HEADERS,
      getLastSig: () => lastSig,
      setLastSig: (s: string) => { lastSig = s; },
      isActive: () => isActive,
      refreshSquads: refreshSquads as unknown as () => Promise<void>,
      onChanged: onChanged as unknown as () => void,
    };
  }

  function okResponse(snapshot: SquadSnapshot) {
    return {
      ok: true,
      json: async () => snapshot,
    };
  }

  beforeEach(() => {
    lastSig = null;
    isActive = true;
    refreshSquads = vi.fn(async () => {});
    onChanged = vi.fn();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("fetches the correct squad URL with the supplied headers", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));

    await runSquadPoll(makeOpts());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/squads/${SQUAD_ID}`,
      { headers: HEADERS },
    );
  });

  // ── First call: baseline seeding ──────────────────────────────────────────

  it("stores the baseline signature on the first call without triggering refresh or banner", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));

    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(lastSig).not.toBeNull();
  });

  // ── Subsequent call: unchanged response ───────────────────────────────────

  it("does NOT call refreshSquads or onChanged when the server returns the same data", async () => {
    // First poll: seed the baseline.
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    // Second poll: identical response.
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when the member list order changes but membership is unchanged", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    // Server returns same members in a different order — should be treated as unchanged.
    fetchMock.mockResolvedValueOnce(
      okResponse({ ...baseSnapshot, memberIds: ["u2", "u1"] }),
    );
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  // ── Subsequent call: changed name ─────────────────────────────────────────

  it("calls refreshSquads and onChanged when the squad name changes", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    fetchMock.mockResolvedValueOnce(okResponse({ ...baseSnapshot, name: "New Name" }));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("calls refreshSquads and onChanged when the squad emoji changes", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    fetchMock.mockResolvedValueOnce(okResponse({ ...baseSnapshot, emoji: "🎉" }));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("calls refreshSquads and onChanged when a new member is added", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    fetchMock.mockResolvedValueOnce(
      okResponse({ ...baseSnapshot, memberIds: ["u1", "u2", "u3"] }),
    );
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("calls refreshSquads and onChanged when a member is removed", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    fetchMock.mockResolvedValueOnce(
      okResponse({ ...baseSnapshot, memberIds: ["u1"] }),
    );
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("calls refreshSquads and onChanged when isPublic changes", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    fetchMock.mockResolvedValueOnce(okResponse({ ...baseSnapshot, isPublic: true }));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("calls refreshSquads and onChanged when membersCanInvite changes", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    fetchMock.mockResolvedValueOnce(
      okResponse({ ...baseSnapshot, membersCanInvite: false }),
    );
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // ── isActive guard ────────────────────────────────────────────────────────

  it("does NOT call onChanged when the component becomes inactive between refresh and banner", async () => {
    // Seed baseline.
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    // On the second poll, simulate deactivation during refreshSquads.
    refreshSquads.mockImplementationOnce(async () => {
      isActive = false;
    });
    fetchMock.mockResolvedValueOnce(okResponse({ ...baseSnapshot, name: "Changed" }));
    await runSquadPoll(makeOpts());

    // refreshSquads was still called (change was real), but banner was suppressed.
    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("returns early without refreshing when isActive() is false before processing", async () => {
    isActive = false;
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));

    await runSquadPoll(makeOpts());

    // fetch was called but the response was discarded because the component is gone.
    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    // lastSig must NOT have been set (nothing processed).
    expect(lastSig).toBeNull();
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("does not throw and does not call refresh/banner when fetch throws a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(runSquadPoll(makeOpts())).resolves.toBeUndefined();

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not call refresh/banner when the server responds with a non-ok status", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  // ── Optimistic local edits — no spurious banner ───────────────────────────

  it("does NOT fire the banner when the user's own optimistic edit already seeded the latest signature", async () => {
    // Simulate the component immediately updating lastSig after the user's own
    // edit (e.g. saveSettings writes a new name and pre-seeds lastSquadSigRef).
    const editedSnapshot = { ...baseSnapshot, name: "Renamed by me" };
    lastSig = squadSignature(editedSnapshot);

    // The next server poll returns the same data — the edit was already recorded.
    fetchMock.mockResolvedValueOnce(okResponse(editedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when the user's own emoji change is pre-seeded as the baseline", async () => {
    const editedSnapshot = { ...baseSnapshot, emoji: "🎊" };
    lastSig = squadSignature(editedSnapshot);

    fetchMock.mockResolvedValueOnce(okResponse(editedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when the user's own membersCanInvite toggle is pre-seeded as the baseline", async () => {
    const editedSnapshot = { ...baseSnapshot, membersCanInvite: false };
    lastSig = squadSignature(editedSnapshot);

    fetchMock.mockResolvedValueOnce(okResponse(editedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when the user's own isPublic toggle is pre-seeded as the baseline", async () => {
    const editedSnapshot = { ...baseSnapshot, isPublic: true };
    lastSig = squadSignature(editedSnapshot);

    fetchMock.mockResolvedValueOnce(okResponse(editedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when saveSettings-style multi-field edit (name + emoji + description) is pre-seeded", async () => {
    const editedSnapshot = { ...baseSnapshot, name: "Weekend Crew", emoji: "🎉", description: "fri nights" };
    lastSig = squadSignature(editedSnapshot);

    fetchMock.mockResolvedValueOnce(okResponse(editedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when adding a member and pre-seeding the new member list", async () => {
    // Seed baseline with the original member list.
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    // Simulate: user added u3; optimistic state now includes u3; pre-seed the sig.
    const afterAdd = { ...baseSnapshot, memberIds: ["u1", "u2", "u3"] };
    lastSig = squadSignature(afterAdd);

    // Next poll confirms the addition — should be silent.
    fetchMock.mockResolvedValueOnce(okResponse(afterAdd));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when removing a member and pre-seeding the reduced member list", async () => {
    // Seed baseline with three members.
    const threeMembers = { ...baseSnapshot, memberIds: ["u1", "u2", "u3"] };
    fetchMock.mockResolvedValueOnce(okResponse(threeMembers));
    await runSquadPoll(makeOpts());

    // Simulate: user removed u3; optimistic state now has only u1+u2; pre-seed the sig.
    const afterRemove = { ...baseSnapshot, memberIds: ["u1", "u2"] };
    lastSig = squadSignature(afterRemove);

    // Next poll confirms the removal — should be silent.
    fetchMock.mockResolvedValueOnce(okResponse(afterRemove));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does NOT fire the banner when regenerating invite code and pre-seeding the existing squad signature", async () => {
    // Seed baseline with the initial server response.
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    // Simulate: user regenerated invite code; since inviteCode is not part of
    // squadSignature, the pre-seeded sig equals the current squad's sig.
    // (In [id].tsx: lastSquadSigRef.current = squadSignature({ ...squad }) after success.)
    lastSig = squadSignature(baseSnapshot);

    // Next poll returns the same squad fields (invite code changed on server but
    // is not in the signature) — should be silent.
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("still fires the banner for a DIFFERENT remote edit even after the user's own edit was pre-seeded", async () => {
    // User renamed the squad; the optimistic sig is pre-seeded.
    const myEdit = { ...baseSnapshot, name: "My New Name" };
    lastSig = squadSignature(myEdit);

    // Meanwhile, someone else also changed isPublic on the server.
    const remoteEdit = { ...myEdit, isPublic: true };
    fetchMock.mockResolvedValueOnce(okResponse(remoteEdit));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // ── Signature update after change ─────────────────────────────────────────

  it("updates the stored signature after a detected change so a second identical poll is a no-op", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(baseSnapshot));
    await runSquadPoll(makeOpts());

    const changedSnapshot = { ...baseSnapshot, name: "Changed" };
    fetchMock.mockResolvedValueOnce(okResponse(changedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);

    // Third poll: same changed data — should be silent.
    fetchMock.mockResolvedValueOnce(okResponse(changedSnapshot));
    await runSquadPoll(makeOpts());

    expect(refreshSquads).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
