import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  execute: vi.fn(),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
  reconcileFoundingCounter: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  sql: {
    raw: vi.fn((statement: string) => statement),
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: hoisted.execute,
  },
}));

vi.mock("../lib/logger", () => ({ logger: hoisted.logger }));

vi.mock("../lib/founding", () => ({
  reconcileFoundingCounter: hoisted.reconcileFoundingCounter,
}));

import { ensureSchema, safeExec } from "../lib/schemaSync";

const originalSkipSchemaSync = process.env.SKIP_SCHEMA_SYNC;

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.execute.mockReset().mockResolvedValue({ rows: [] });
  hoisted.reconcileFoundingCounter.mockResolvedValue(undefined);
  delete process.env.SKIP_SCHEMA_SYNC;
});

afterEach(() => {
  if (originalSkipSchemaSync === undefined) {
    delete process.env.SKIP_SCHEMA_SYNC;
  } else {
    process.env.SKIP_SCHEMA_SYNC = originalSkipSchemaSync;
  }
});

describe("ensureSchema startup safety", () => {
  it("allows only idempotent duplicate errors through safeExec", async () => {
    const unexpected = new Error("permission denied for schema public");
    hoisted.execute.mockRejectedValueOnce(unexpected);
    await expect(safeExec("CREATE INDEX test_idx ON test(id)")).rejects.toBe(
      unexpected,
    );

    const alreadyExists = Object.assign(
      new Error('relation "test_idx" already exists'),
      { code: "42P07" },
    );
    hoisted.execute.mockRejectedValueOnce(alreadyExists);
    await expect(
      safeExec("CREATE INDEX test_idx ON test(id)"),
    ).resolves.toBeUndefined();

    const duplicateRows = Object.assign(
      new Error("could not create unique index; key is duplicated"),
      { code: "23505" },
    );
    hoisted.execute.mockRejectedValueOnce(
      Object.assign(new Error("Failed query"), { cause: duplicateRows }),
    );
    await expect(
      safeExec("CREATE UNIQUE INDEX test_unique ON test(id)"),
    ).rejects.toMatchObject({ cause: duplicateRows });
  });

  it("logs and rethrows a schema sync failure", async () => {
    const startupError = new Error("database unavailable");
    hoisted.execute.mockRejectedValueOnce(startupError);

    await expect(ensureSchema()).rejects.toBe(startupError);

    expect(hoisted.logger.error).toHaveBeenCalledWith(
      { err: startupError },
      expect.stringContaining("Schema sync FAILED"),
    );
  });

  it("preserves the explicit SKIP_SCHEMA_SYNC staging bypass", async () => {
    process.env.SKIP_SCHEMA_SYNC = "1";

    await expect(ensureSchema()).resolves.toBeUndefined();

    expect(hoisted.execute).not.toHaveBeenCalled();
    expect(hoisted.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Skipping schema sync"),
    );
  });
});