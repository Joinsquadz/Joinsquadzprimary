// Draft persistence for the "Find the Best Time" creation wizard.
//
// Backing out of the wizard (or an app kill mid-flow) used to discard the
// title, range and slot picks entirely. These tests pin the scoping, expiry and
// corruption behaviour that make a restore safe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const asyncStorageData = vi.hoisted(() => ({ store: {} as Record<string, string> }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStorageData.store[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStorageData.store[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete asyncStorageData.store[key];
      return Promise.resolve();
    }),
  },
}));

import {
  pollDraftKey,
  savePollDraft,
  readPollDraft,
  clearPollDraft,
  draftHasContent,
  type PollDraft,
} from "../pollDraft";

const PREFIX = "@squadz/pollDraft/";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

const draft: PollDraft = {
  title: "Ski weekend",
  rangeStartISO: "2026-08-12",
  rangeDays: 7,
  slots: ["6PM", "7PM"],
  period: "Evening",
  step: 2,
};

beforeEach(() => {
  asyncStorageData.store = {};
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("draft scoping", () => {
  it("keys drafts per creation scope so squads can't cross-contaminate", () => {
    expect(pollDraftKey({ squadId: "sq1" })).toBe("squad:sq1");
    expect(pollDraftKey({ eventId: "ev1" })).toBe("event:ev1");
    expect(pollDraftKey({ adhoc: true })).toBe("adhoc");
    expect(pollDraftKey({})).toBe("unscoped");
  });

  it("prefers the squad scope when both ids are present", () => {
    expect(pollDraftKey({ squadId: "sq1", eventId: "ev1" })).toBe("squad:sq1");
  });

  it("does not return one scope's draft for another scope", async () => {
    await savePollDraft(pollDraftKey({ squadId: "sq1" }), draft);
    expect(await readPollDraft(pollDraftKey({ squadId: "sq2" }))).toBeNull();
    expect(await readPollDraft(pollDraftKey({ squadId: "sq1" }))).toEqual(draft);
  });
});

describe("save and restore", () => {
  it("round-trips every wizard field", async () => {
    await savePollDraft("squad:sq1", draft);
    expect(await readPollDraft("squad:sq1")).toEqual(draft);
  });

  it("round-trips explicit Custom choices even when values match presets", async () => {
    const customDraft: PollDraft = {
      ...draft,
      rangeDays: 7,
      rangeDaysChoice: "custom",
      tripLengthDays: 3,
      tripLengthChoice: "custom",
    };
    await savePollDraft("squad:sq1", customDraft);
    expect(await readPollDraft("squad:sq1")).toEqual(customDraft);
  });

  it("stores under the dedicated key namespace with a savedAt stamp", async () => {
    await savePollDraft("squad:sq1", draft);
    const raw = asyncStorageData.store[`${PREFIX}squad:sq1`];
    expect(raw).toBeDefined();
    expect(typeof (JSON.parse(raw) as { savedAt: number }).savedAt).toBe("number");
  });

  it("returns null when nothing was ever saved", async () => {
    expect(await readPollDraft("squad:none")).toBeNull();
  });

  it("clears the draft once the poll is created", async () => {
    await savePollDraft("squad:sq1", draft);
    await clearPollDraft("squad:sq1");
    expect(await readPollDraft("squad:sq1")).toBeNull();
  });
});

describe("expiry and corruption", () => {
  it("keeps a draft that is under 24h old", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
    await savePollDraft("squad:sq1", draft);
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z").getTime() + EXPIRY_MS - 1000);
    expect(await readPollDraft("squad:sq1")).toEqual(draft);
  });

  it("drops and deletes a draft older than 24h", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
    await savePollDraft("squad:sq1", draft);
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z").getTime() + EXPIRY_MS + 1000);
    expect(await readPollDraft("squad:sq1")).toBeNull();
    expect(asyncStorageData.store[`${PREFIX}squad:sq1`]).toBeUndefined();
  });

  it("discards malformed JSON instead of throwing into the wizard", async () => {
    asyncStorageData.store[`${PREFIX}squad:sq1`] = "{not json";
    expect(await readPollDraft("squad:sq1")).toBeNull();
  });

  it("discards a structurally invalid draft and clears the key", async () => {
    asyncStorageData.store[`${PREFIX}squad:sq1`] = JSON.stringify({
      title: "x",
      rangeStartISO: "not-a-date",
      rangeDays: 7,
      slots: [],
      period: "Evening",
      step: 0,
      savedAt: Date.now(),
    });
    expect(await readPollDraft("squad:sq1")).toBeNull();
    expect(asyncStorageData.store[`${PREFIX}squad:sq1`]).toBeUndefined();
  });

  it("rejects a draft with a non-positive day count", async () => {
    asyncStorageData.store[`${PREFIX}squad:sq1`] = JSON.stringify({
      ...draft,
      rangeDays: 0,
      savedAt: Date.now(),
    });
    expect(await readPollDraft("squad:sq1")).toBeNull();
  });
});

describe("draftHasContent", () => {
  const defaults = { rangeDays: 7, slots: ["6PM", "7PM", "8PM", "9PM", "10PM"] };
  const fresh: PollDraft = {
    title: "",
    rangeStartISO: "2026-08-12",
    rangeDays: 7,
    slots: defaults.slots,
    period: "Evening",
    step: 0,
  };

  it("treats an untouched form as having nothing worth announcing", () => {
    expect(draftHasContent(fresh, defaults)).toBe(false);
    expect(draftHasContent({ ...fresh, title: "   " }, defaults)).toBe(false);
  });

  it("detects a typed title, a changed range, altered slots or progress", () => {
    expect(draftHasContent({ ...fresh, title: "Ski" }, defaults)).toBe(true);
    expect(draftHasContent({ ...fresh, rangeDays: 14 }, defaults)).toBe(true);
    expect(draftHasContent({ ...fresh, slots: ["6PM"] }, defaults)).toBe(true);
    expect(draftHasContent({ ...fresh, step: 1 }, defaults)).toBe(true);
  });

  it("ignores slot ordering when comparing against the defaults", () => {
    expect(draftHasContent({ ...fresh, slots: [...defaults.slots].reverse() }, defaults)).toBe(false);
  });
});
