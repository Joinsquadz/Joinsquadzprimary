import { describe, expect, it } from "vitest";
import {
  MAX_MOMENT_MEDIA_RETRIES,
  momentMediaUrl,
  nextMomentMediaRetryAttempt,
} from "../momentMediaRetry";

describe("Moment media retry", () => {
  it("uses a bounded retry sequence", () => {
    expect(nextMomentMediaRetryAttempt(0)).toBe(1);
    expect(nextMomentMediaRetryAttempt(1)).toBe(2);
    expect(nextMomentMediaRetryAttempt(MAX_MOMENT_MEDIA_RETRIES)).toBeNull();
  });

  it("only cache-busts retry requests", () => {
    expect(momentMediaUrl("/api/storage/objects/example", 0, "m1")).toBe(
      "/api/storage/objects/example",
    );
    expect(momentMediaUrl("/api/storage/objects/example", 1, "m1")).toBe(
      "/api/storage/objects/example?moment-retry=m1-1",
    );
  });
});