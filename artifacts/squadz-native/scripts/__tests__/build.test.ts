import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const buildScript = readFileSync(
  decodeURIComponent(new URL("../build.js", import.meta.url).pathname),
  "utf8",
);

describe("native production build Metro port", () => {
  it("uses METRO_PORT with an 8081 fallback for every Metro request", () => {
    expect(buildScript).toContain(
      'const metroPort = process.env.METRO_PORT || "8081";',
    );
    expect(buildScript).toContain(
      "const metroBaseUrl = `http://localhost:${metroPort}`;",
    );
    expect(buildScript).toMatch(/"--port",\s+metroPort/);
    expect(buildScript).not.toContain("localhost:8081");
  });
});