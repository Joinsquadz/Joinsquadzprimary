import { API_BASE, buildAuthHeaders } from "@/lib/api";
import type { StopCategory } from "@/types";

/**
 * Thin client for the trip itinerary + packing routes on the shared api-server
 * events resource. Mirrors the plain-fetch pattern used elsewhere in the mobile
 * app (see app/create.tsx) rather than threading through AppContext.apiFetch, so
 * the trip-detail screen owns its own fetched event state + SSE live updates.
 *
 * Every mutating route is version-checked server-side: pass the event's current
 * `version` and a concurrent edit yields `{ conflict: true }` so the caller can
 * refetch the latest instead of clobbering someone else's change.
 */
export type TripMutResult = {
  /** The full updated event row (server source of truth) on success. */
  event?: Record<string, unknown>;
  /** True when a 409 version conflict was returned. */
  conflict?: boolean;
  /** Human-readable error for any other failure. */
  error?: string;
};

export type NewStopInput = {
  day: string;
  time?: string;
  endTime?: string;
  title: string;
  placeName?: string;
  address?: string;
  note?: string;
  category?: StopCategory;
  status?: "confirmed" | "proposed";
  cost?: number | null;
  paidById?: string | null;
  assigneeId?: string | null;
};

export type StopPatch = {
  day?: string;
  time?: string;
  endTime?: string;
  title?: string;
  placeName?: string;
  address?: string;
  note?: string;
  category?: StopCategory;
  status?: "confirmed" | "proposed";
  cost?: number | null;
  paidById?: string | null;
  assigneeId?: string | null;
};

export type PackingPatch = {
  label?: string;
  done?: boolean;
  assigneeId?: string | null;
};

async function request(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  token: string | null,
  body?: Record<string, unknown>,
): Promise<TripMutResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...buildAuthHeaders(token) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { conflict?: boolean; error?: string };
      return { conflict: true, error: data.error ?? "Someone else just updated this" };
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: data.error ?? `Server error ${res.status}` };
    }
    const event = (await res.json()) as Record<string, unknown>;
    return { event };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

export function addStop(
  eventId: string,
  token: string | null,
  input: NewStopInput,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/itinerary`, "POST", token, { ...input, version });
}

export function patchStop(
  eventId: string,
  stopId: string,
  token: string | null,
  patch: StopPatch,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/itinerary/${stopId}`, "PATCH", token, { ...patch, version });
}

export function deleteStop(
  eventId: string,
  stopId: string,
  token: string | null,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/itinerary/${stopId}`, "DELETE", token, { version });
}

export function voteStop(
  eventId: string,
  stopId: string,
  token: string | null,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/itinerary/${stopId}/vote`, "POST", token, { version });
}

export function confirmStop(
  eventId: string,
  stopId: string,
  token: string | null,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/itinerary/${stopId}/confirm`, "POST", token, { version });
}

export function addPacking(
  eventId: string,
  token: string | null,
  label: string,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/packing`, "POST", token, { label, version });
}

export function patchPacking(
  eventId: string,
  itemId: string,
  token: string | null,
  patch: PackingPatch,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/packing/${itemId}`, "PATCH", token, { ...patch, version });
}

export function deletePacking(
  eventId: string,
  itemId: string,
  token: string | null,
  version?: number,
): Promise<TripMutResult> {
  return request(`/api/events/${eventId}/packing/${itemId}`, "DELETE", token, { version });
}
