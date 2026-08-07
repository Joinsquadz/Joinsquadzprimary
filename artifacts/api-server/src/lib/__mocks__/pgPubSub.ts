import { vi } from "vitest";

// Manual mock for pgPubSub — prevents tests from requiring a live Postgres
// LISTEN connection. All event modules delegate to these no-ops in test scope.

export const initPgPubSub = vi.fn().mockResolvedValue(undefined);

export const pgNotify = vi.fn();

export const pgSubscribe = vi.fn().mockReturnValue(() => {});
