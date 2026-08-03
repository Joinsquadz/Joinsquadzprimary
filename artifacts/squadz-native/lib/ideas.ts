import { API_BASE, buildAuthHeaders } from "@/lib/api";
import type { IdeaCategory, IdeaStatus, PlanIdea } from "@/types";

/**
 * Thin client for the plan-ideas routes (`/api/plans/:planId/ideas`). Mirrors
 * the plain-fetch pattern of lib/tripApi.ts. Ideas are NOT version-checked
 * (they live in their own table, not the events JSON columns), so no version
 * threading here — conflicts are last-write-wins per field, and reorders are
 * validated atomically server-side.
 */

export type IdeaMutResult = {
  idea?: PlanIdea;
  ok?: boolean;
  /** Human-readable error for any failure. */
  error?: string;
  /** HTTP status for callers that branch (e.g. 403 read-only). */
  status?: number;
};

export type IdeaListResult = {
  ideas?: PlanIdea[];
  /** True once the plan has ended or was cancelled — hide all write affordances. */
  readOnly?: boolean;
  error?: string;
};

export type NewIdeaInput = {
  title: string;
  description?: string;
  category?: IdeaCategory;
  linkUrl?: string;
  estimatedCost?: number | null;
  suggestedDate?: string | null;
};

export type IdeaPatch = Partial<NewIdeaInput>;

async function request(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  token: string | null,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown> & { __status?: number }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(token) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...data, __status: res.status };
}

function toMutResult(data: Record<string, unknown> & { __status?: number }): IdeaMutResult {
  const status = data.__status ?? 0;
  if (status >= 200 && status < 300) {
    // Single-idea routes return the serialized idea itself; delete/reorder return { ok }.
    if (typeof data.id === "string") return { idea: data as unknown as PlanIdea, status };
    return { ok: true, status };
  }
  return { error: (data.error as string) ?? `Server error ${status}`, status };
}

export async function listIdeas(planId: string, token: string | null): Promise<IdeaListResult> {
  try {
    const data = await request(`/api/plans/${planId}/ideas`, "GET", token);
    const status = data.__status ?? 0;
    if (status >= 200 && status < 300) {
      return { ideas: (data.ideas as PlanIdea[]) ?? [], readOnly: !!data.readOnly };
    }
    return { error: (data.error as string) ?? `Server error ${status}` };
  } catch {
    return { error: "Network unavailable" };
  }
}

export async function createIdea(
  planId: string,
  token: string | null,
  input: NewIdeaInput,
): Promise<IdeaMutResult> {
  try {
    return toMutResult(await request(`/api/plans/${planId}/ideas`, "POST", token, input));
  } catch {
    return { error: "Network unavailable" };
  }
}

export async function patchIdea(
  planId: string,
  ideaId: string,
  token: string | null,
  patch: IdeaPatch,
): Promise<IdeaMutResult> {
  try {
    return toMutResult(await request(`/api/plans/${planId}/ideas/${ideaId}`, "PATCH", token, patch));
  } catch {
    return { error: "Network unavailable" };
  }
}

export async function deleteIdea(
  planId: string,
  ideaId: string,
  token: string | null,
): Promise<IdeaMutResult> {
  try {
    return toMutResult(await request(`/api/plans/${planId}/ideas/${ideaId}`, "DELETE", token));
  } catch {
    return { error: "Network unavailable" };
  }
}

export async function toggleIdeaVote(
  planId: string,
  ideaId: string,
  token: string | null,
): Promise<IdeaMutResult> {
  try {
    return toMutResult(await request(`/api/plans/${planId}/ideas/${ideaId}/vote`, "POST", token));
  } catch {
    return { error: "Network unavailable" };
  }
}

export async function setIdeaStatus(
  planId: string,
  ideaId: string,
  token: string | null,
  status: IdeaStatus,
): Promise<IdeaMutResult> {
  try {
    return toMutResult(
      await request(`/api/plans/${planId}/ideas/${ideaId}/status`, "PATCH", token, { status }),
    );
  } catch {
    return { error: "Network unavailable" };
  }
}

export async function toggleIdeaPin(
  planId: string,
  ideaId: string,
  token: string | null,
): Promise<IdeaMutResult> {
  try {
    return toMutResult(await request(`/api/plans/${planId}/ideas/${ideaId}/pin`, "POST", token));
  } catch {
    return { error: "Network unavailable" };
  }
}

/**
 * Reorders the confirmed ideas of one day group. `ideaIds` must contain
 * EXACTLY the confirmed ideas of that group (server rejects partial payloads),
 * in the desired order. `date` is the group's day key or null for General.
 */
export async function reorderIdeas(
  planId: string,
  token: string | null,
  date: string | null,
  ideaIds: string[],
): Promise<IdeaMutResult> {
  try {
    return toMutResult(
      await request(`/api/plans/${planId}/ideas/reorder`, "PATCH", token, { date, ideaIds }),
    );
  } catch {
    return { error: "Network unavailable" };
  }
}
