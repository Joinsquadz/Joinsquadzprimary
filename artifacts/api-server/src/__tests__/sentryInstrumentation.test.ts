import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { promisify } from "node:util";
import path from "node:path";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "../..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const buildScript = path.join(packageRoot, "build.mjs");
const preload = path.join(packageRoot, "dist/instrument.mjs");
const fixture = path.join(packageRoot, "src/__tests__/fixtures/sentry-express-smoke.mjs");
const artifactToml = path.join(packageRoot, ".replit-artifact/artifact.toml");

async function buildApiBundle(): Promise<void> {
  await execFileAsync(process.execPath, [buildScript], {
    cwd: packageRoot,
    env: { ...process.env, NODE_ENV: "test" },
  });
}

async function runSmokeProcess(
  sentryDsn: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const child = spawn(process.execPath, ["--import", preload, fixture], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      SENTRY_DSN: sentryDsn,
      SENTRY_SMOKE_URL: "enabled",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const [exitCode] = (await once(child, "exit")) as [number | null];
  return { stdout, stderr, exitCode };
}

describe("production Sentry Express instrumentation", () => {
  it("preloads Sentry before Express and delivers a thrown Express error", async () => {
    await buildApiBundle();
    const bundle = await (await import("node:fs/promises")).readFile(
      path.join(packageRoot, "dist/index.mjs"),
      "utf8",
    );
    expect(bundle).toMatch(/from "express";/);

    const envelopes: string[] = [];
    const collector = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        envelopes.push(body);
        response.writeHead(200);
        response.end();
      });
    });
    collector.listen(0, "127.0.0.1");
    await once(collector, "listening");

    try {
      const address = collector.address();
      if (!address || typeof address === "string") {
        throw new Error("Sentry collector did not bind to a TCP port");
      }
      const result = await runSmokeProcess(
        `http://0123456789abcdef0123456789abcdef@127.0.0.1:${address.port}/42`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("[sentry-smoke] Express error delivered");
      expect(result.stderr).not.toContain("express is not instrumented");
      if (envelopes.length === 0) {
        throw new Error(
          `Sentry did not send an envelope. stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
        );
      }
      expect(envelopes.join("\n")).toContain("SENTRY_EXPRESS_SMOKE_TEST");
    } finally {
      collector.close();
      await once(collector, "close");
    }
  }, 30_000);

  it("keeps the production command on the preload path", async () => {
    const toml = await (await import("node:fs/promises")).readFile(artifactToml, "utf8");

    expect(toml).toContain(
      'args = ["node", "--import", "artifacts/api-server/dist/instrument.mjs", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]',
    );
  });
});