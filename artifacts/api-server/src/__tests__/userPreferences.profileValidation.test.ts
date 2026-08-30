import { describe, expect, it } from "vitest";
import { PatchProfileBody } from "../routes/userPreferences";

describe("profile field validation", () => {
  it("accepts a 150-character bio and rejects 151 characters", () => {
    expect(PatchProfileBody.safeParse({ bio: "a".repeat(150) }).success).toBe(true);
    expect(PatchProfileBody.safeParse({ bio: "a".repeat(151) }).success).toBe(false);
  });

  it("accepts up to five short hobbies and rejects a sixth", () => {
    expect(PatchProfileBody.safeParse({ hobbies: ["Hiking", "Cooking", "Music", "Travel", "Running"] }).success).toBe(true);
    expect(PatchProfileBody.safeParse({ hobbies: ["1", "2", "3", "4", "5", "6"] }).success).toBe(false);
  });

  it("accepts a real past birthdate and rejects invalid or future dates", () => {
    expect(PatchProfileBody.safeParse({ birthdate: "2000-02-29" }).success).toBe(true);
    expect(PatchProfileBody.safeParse({ birthdate: "2001-02-29" }).success).toBe(false);
    expect(PatchProfileBody.safeParse({ birthdate: "2999-01-01" }).success).toBe(false);
  });
});