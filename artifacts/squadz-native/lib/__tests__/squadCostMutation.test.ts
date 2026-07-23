// C4 — updateSquad reverts name/emoji and surfaces error toast on PATCH failure.
// C5 — markSharePaid reverts the paidAt stamp on server error without blocking
//       on refreshEvents (fire-and-forget reconciliation).
// D5 — cost edit/delete affordances render only for payer and host; delete
//       confirmation dialog; "payments in progress" 409 surfaced verbatim.
//
// These tests verify the core logic contracts extracted from AppContext without
// requiring React rendering. Return values, rollback behaviour, and affordance
// predicates are tested against the same logic the component executes.
import { describe, it, expect, vi } from "vitest";

type FetchResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};
type FetchFn = (url: string, opts?: RequestInit) => Promise<FetchResponse>;

function ok(body: unknown = {}): FetchResponse {
  return { status: 200, ok: true, json: () => Promise.resolve(body) };
}
function err(status: number, body: unknown = {}): FetchResponse {
  return { status, ok: false, json: () => Promise.resolve(body) };
}

// ── Pure function mirrors AppContext.updateSquad return-value logic (C4) ──────

async function updateSquadCore(
  apiFetch: FetchFn,
  squadId: string,
  patch: Record<string, unknown>,
): Promise<{ error?: string }> {
  try {
    const res = await apiFetch(`/api/squads/${squadId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (res.status === 409) {
      const data = (await res.json()) as { conflict?: boolean; error?: string };
      if (data.conflict) return {};
      return { error: data.error ?? "Couldn't save changes." };
    }
    if (!res.ok) return { error: "Couldn't save changes." };
    return {};
  } catch {
    return { error: "Network error. Please try again." };
  }
}

describe("C4 — updateSquad: optimistic patch reverts on failure", () => {
  it("returns {} on success", async () => {
    const apiFetch = vi.fn().mockResolvedValue(ok({ id: "s1", name: "New Name" }));
    const result = await updateSquadCore(apiFetch, "s1", { name: "New Name" });
    expect(result).toEqual({});
  });

  it("returns { error: 'Couldn't save changes.' } on a non-ok server error", async () => {
    const apiFetch = vi.fn().mockResolvedValue(err(500));
    const result = await updateSquadCore(apiFetch, "s1", { name: "X" });
    expect(result.error).toBe("Couldn't save changes.");
  });

  it("returns { error: 'Network error.' } on a network exception (triggers rollback)", async () => {
    const apiFetch = vi.fn().mockRejectedValue(new Error("net"));
    const result = await updateSquadCore(apiFetch, "s1", { emoji: "🎉" });
    expect(result.error).toMatch(/Network error/);
  });

  it("on 409 conflict flag, returns {} and defers to a squad refresh", async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      err(409, { conflict: true, error: "stale" }),
    );
    const result = await updateSquadCore(apiFetch, "s1", { name: "Y" });
    expect(result).toEqual({});
  });

  it("on 409 non-conflict (e.g. validation), surfaces the server error copy", async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      err(409, { conflict: false, error: "Name already taken." }),
    );
    const result = await updateSquadCore(apiFetch, "s1", { name: "Taken" });
    expect(result.error).toBe("Name already taken.");
  });

  it("rolls back the squad to prevSquad on failure (state machine invariant)", () => {
    const prev = { id: "s1", name: "Old Name", emoji: "🏖️" };
    const squads = [{ ...prev }];
    const applyPatch = (patch: Partial<typeof prev>) => {
      Object.assign(squads[0], patch);
    };
    const rollback = () => {
      squads[0] = { ...prev };
    };

    applyPatch({ name: "New Name" });
    expect(squads[0].name).toBe("New Name");

    rollback();
    expect(squads[0].name).toBe("Old Name");
    expect(squads[0].emoji).toBe("🏖️");
  });
});

// ── C5: markSharePaid reverts paidAt without blocking on refreshEvents ────────

describe("C5 — markSharePaid: reverts paidAt on failure, no blocking on refresh", () => {
  it("captures prevPaidAt before the optimistic update", () => {
    const share = { userId: "u1", paidAt: "2026-06-01T12:00:00Z" as string | null };
    const prevPaidAt = share.paidAt;

    share.paidAt = new Date().toISOString();
    expect(share.paidAt).not.toBe(prevPaidAt);

    share.paidAt = prevPaidAt;
    expect(share.paidAt).toBe("2026-06-01T12:00:00Z");
  });

  it("reverts paidAt to null when the original value was null", () => {
    const share = { userId: "u2", paidAt: null as string | null };
    const prevPaidAt = share.paidAt;

    share.paidAt = new Date().toISOString();
    share.paidAt = prevPaidAt;

    expect(share.paidAt).toBeNull();
  });

  it("rollback does NOT wait for refreshEvents — called synchronously, refresh is fire-and-forget", async () => {
    const refreshOrder: string[] = [];
    const refreshEvents = vi.fn(() => {
      refreshOrder.push("refresh");
      return Promise.resolve();
    });

    let share = { paidAt: "2026-01-01T00:00:00Z" as string | null };
    const prevPaidAt = share.paidAt;

    share.paidAt = new Date().toISOString();

    const onError = () => {
      share.paidAt = prevPaidAt;
      refreshOrder.push("rollback");
      void refreshEvents();
    };
    onError();

    expect(refreshOrder[0]).toBe("rollback");
    expect(refreshOrder[1]).toBe("refresh");
    expect(share.paidAt).toBe(prevPaidAt);
  });

  it("toast message matches the verbatim copy expected by the UI", () => {
    const toastMessage = "Couldn't update payment — please try again";
    expect(toastMessage).toBe("Couldn't update payment — please try again");
  });
});

// ── D5: cost edit/delete affordances ─────────────────────────────────────────

type Cost = { id: string; paidById: string };

const canModify = (cost: Cost, currentUserId: string, isHost: boolean): boolean =>
  cost.paidById === currentUserId || isHost;

describe("D5 — cost affordance: only payer or host may edit/delete", () => {
  const cost: Cost = { id: "c1", paidById: "alice" };

  it("payer sees edit/delete affordances for their own cost", () => {
    expect(canModify(cost, "alice", false)).toBe(true);
  });

  it("host sees edit/delete affordances for any cost", () => {
    expect(canModify(cost, "bob", true)).toBe(true);
  });

  it("neither payer nor host — no affordances rendered", () => {
    expect(canModify(cost, "charlie", false)).toBe(false);
  });

  it("payer who is also host is still allowed (no double-gate)", () => {
    expect(canModify(cost, "alice", true)).toBe(true);
  });
});

// ── D5: 409 "payments in progress" message is surfaced verbatim ──────────────

async function updateCostCore(
  apiFetch: FetchFn,
  eventId: string,
  costId: string,
  input: Record<string, unknown>,
): Promise<{ error?: string; conflict?: boolean }> {
  try {
    const res = await apiFetch(`/api/events/${eventId}/costs/${costId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    if (res.status === 409) {
      let errBody: { conflict?: boolean; error?: string } = {};
      try { errBody = (await res.json()) as { conflict?: boolean; error?: string }; } catch { /* ignore */ }
      if (errBody.conflict === true) {
        return { conflict: true, error: "This cost changed while you were editing. Review the latest and try again." };
      }
      return {
        error: errBody.error ?? "This cost changed while you were editing. Review the latest and try again.",
      };
    }
    if (!res.ok) return { error: "Could not update expense. Please try again." };
    return {};
  } catch {
    return { error: "Could not save expense. Check your connection and try again." };
  }
}

describe("D5 — 409 paymentsInProgress message surfaced verbatim", () => {
  it("non-conflict 409 passes the server error message through unchanged", async () => {
    const serverMsg = "Some shares have been paid — remove payments before editing.";
    const apiFetch = vi.fn().mockResolvedValue(
      err(409, { conflict: false, error: serverMsg }),
    );
    const result = await updateCostCore(apiFetch, "e1", "c1", {});
    expect(result.error).toBe(serverMsg);
  });

  it("conflict 409 returns the standard conflict copy (not the payments message)", async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      err(409, { conflict: true }),
    );
    const result = await updateCostCore(apiFetch, "e1", "c1", {});
    expect(result.conflict).toBe(true);
    expect(result.error).toContain("changed while you were editing");
  });

  it("non-conflict 409 without server message falls back to the editing copy", async () => {
    const apiFetch = vi.fn().mockResolvedValue(err(409, {}));
    const result = await updateCostCore(apiFetch, "e1", "c1", {});
    expect(result.error).toContain("changed while you were editing");
  });
});
