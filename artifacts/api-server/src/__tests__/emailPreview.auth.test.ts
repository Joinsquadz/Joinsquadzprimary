import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

import emailPreviewRouter from "../routes/emailPreview";
import stripeRouter from "../routes/stripe";

vi.mock("../emailService", () => ({
  buildProWelcomeHtml: (data: { planName: string }) => `<html>${data.planName}</html>`,
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/urls", () => ({ getBaseUrl: () => "https://example.test" }));
vi.mock("../lib/founding", () => ({ getFoundingStatus: vi.fn() }));
vi.mock("../lib/proStatus", () => ({ resolveProStatus: vi.fn() }));

const ADMIN_TOKEN = "email-preview-test-token";

function makeApp() {
  const app = express();
  app.use("/api", emailPreviewRouter);
  app.use("/api", stripeRouter);
  return app;
}

afterEach(() => {
  delete process.env.INTERNAL_API_TOKEN;
  delete process.env.ENABLE_EMAIL_PREVIEW_TEST;
  delete process.env.NODE_ENV;
});

describe("email preview GET authorization", () => {
  it("denies unauthenticated requests to every preview route", async () => {
    process.env.INTERNAL_API_TOKEN = ADMIN_TOKEN;
    process.env.ENABLE_EMAIL_PREVIEW_TEST = "true";
    process.env.NODE_ENV = "development";
    const app = makeApp();

    const responses = await Promise.all([
      request(app).get("/api/email/preview/welcome"),
      request(app).get("/api/email/preview/welcome/text"),
      request(app).get("/api/stripe/email-preview/pro-welcome"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  });

  it("denies an incorrect admin token", async () => {
    process.env.INTERNAL_API_TOKEN = ADMIN_TOKEN;
    process.env.ENABLE_EMAIL_PREVIEW_TEST = "true";
    process.env.NODE_ENV = "development";

    const response = await request(makeApp())
      .get("/api/email/preview/welcome")
      .set("Authorization", "Bearer incorrect-token");

    expect(response.status).toBe(401);
  });

  it("serves all previews with the configured admin token", async () => {
    process.env.INTERNAL_API_TOKEN = ADMIN_TOKEN;
    process.env.ENABLE_EMAIL_PREVIEW_TEST = "true";
    process.env.NODE_ENV = "development";
    const app = makeApp();

    const responses = await Promise.all([
      request(app)
        .get("/api/email/preview/welcome")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`),
      request(app)
        .get("/api/email/preview/welcome/text")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`),
      request(app)
        .get("/api/stripe/email-preview/pro-welcome")
        .set("Authorization", `Bearer ${ADMIN_TOKEN}`),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(responses[0].text).toContain("SquadZ Pro");
    expect(responses[1].text).toContain("Welcome to SquadZ Pro");
    expect(responses[2].text).toContain("SquadZ Pro");
  });
});