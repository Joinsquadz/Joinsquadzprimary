import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
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

async function readProductionArgs(): Promise<string[]> {
  const toml = await readFile(artifactToml, "utf8");
  const productionRunSection = toml.match(
    /\[services\.production\.run\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1];
  const match = productionRunSection?.match(/^args = (\[.*\])$/m);
  if (!match) {
    throw new Error(
      "Could not find [services.production.run] args in artifact.toml",
    );
  }

  const args = JSON.parse(match[1]) as unknown;
  if (
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string") ||
    args.length < 2
  ) {
    throw new Error("Production run args in artifact.toml must be a non-empty string array");
  }
  return args;
}

async function buildApiBundle(): Promise<void> {
  await execFileAsync(process.execPath, [buildScript], {
    cwd: packageRoot,
    env: { ...process.env, NODE_ENV: "test" },
  });
}

async function getAvailablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");

  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("Could not determine an available TCP port");
  }

  const port = address.port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function bootProductionCommand(
  productionArgs: string[],
): Promise<{ stdout: string; stderr: string }> {
  const [command, ...args] = productionArgs;
  const port = await getAvailablePort();
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      SKIP_SCHEMA_SYNC: "1",
      SKIP_STRIPE_INIT: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let booted = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const bootPromise = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(
          `Production command did not boot within 20s.\nstdout=${stdout}\nstderr=${stderr}`,
        ),
      );
    }, 20_000);

    const checkForBoot = (): void => {
      if (stdout.includes("Server listening")) {
        booted = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      checkForBoot();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      checkForBoot();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (!booted) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Production command exited before boot: code=${code} signal=${signal}\nstdout=${stdout}\nstderr=${stderr}`,
          ),
        );
      }
    });
  });

  try {
    await bootPromise;
    return { stdout, stderr };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, "exit");
    }
  }
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

  it("validates and boots the exact production command", async () => {
    await buildApiBundle();
    const args = await readProductionArgs();

    expect(args[0]).toBe("node");
    const importFlagIndex = args.indexOf("--import");
    expect(importFlagIndex).toBeGreaterThanOrEqual(0);

    const importSpecifier = args[importFlagIndex + 1];
    expect(
      path.isAbsolute(importSpecifier) || importSpecifier.startsWith("./"),
    ).toBe(true);

    const importPath = path.isAbsolute(importSpecifier)
      ? importSpecifier
      : path.resolve(workspaceRoot, importSpecifier);
    await expect(access(importPath)).resolves.toBeUndefined();

    const result = await bootProductionCommand(args);
    expect(result.stdout).toContain("Server listening");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      "ERR_MODULE_NOT_FOUND",
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      "Cannot find package",
    );
  }, 30_000);
});