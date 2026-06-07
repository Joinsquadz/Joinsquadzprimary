import { vi } from "vitest";

// Shared manual mock for `../lib/logger`, used by API access-control tests via a
// bare `vi.mock("../lib/logger")`. Centralizing it here removes the identical
// logger-mock factory that was previously copy-pasted into every test file.
export const logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};
