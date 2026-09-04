import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import wellKnownRouter from "../routes/wellKnown";

const app = () => {
  const server = express();
  server.use(wellKnownRouter);
  return server;
};

const ORIGINAL_IOS_APP_ID = process.env.IOS_APP_ID;

afterEach(() => {
  if (ORIGINAL_IOS_APP_ID === undefined) delete process.env.IOS_APP_ID;
  else process.env.IOS_APP_ID = ORIGINAL_IOS_APP_ID;
});

describe("well-known app-link association", () => {
  it("serves the AASA as JSON with friend, squad, and event invite paths", async () => {
    process.env.IOS_APP_ID = "ABCDE12345.com.squadz.app";

    const response = await request(app()).get("/.well-known/apple-app-site-association");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    const detail = response.body.applinks.details[0];
    expect(detail.appID).toBe("ABCDE12345.com.squadz.app");
    expect(detail.paths).toEqual(expect.arrayContaining([
      "/api/add/friend/*",
      "/squad/join",
      "/squad/join-public/*",
      "/join/*",
    ]));
    expect(detail.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ "/": "/api/add/friend/*" }),
      expect.objectContaining({ "/": "/squad/join" }),
      expect.objectContaining({ "/": "/join/*" }),
    ]));
  });
});