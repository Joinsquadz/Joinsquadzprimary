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
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ANDROID_FINGERPRINTS = process.env.ANDROID_SHA256_CERT_FINGERPRINTS;
const VALID_ANDROID_FINGERPRINT = Array.from({ length: 32 }, () => "AA").join(":");

afterEach(() => {
  if (ORIGINAL_IOS_APP_ID === undefined) delete process.env.IOS_APP_ID;
  else process.env.IOS_APP_ID = ORIGINAL_IOS_APP_ID;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ANDROID_FINGERPRINTS === undefined) delete process.env.ANDROID_SHA256_CERT_FINGERPRINTS;
  else process.env.ANDROID_SHA256_CERT_FINGERPRINTS = ORIGINAL_ANDROID_FINGERPRINTS;
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
      "/squad/join/*",
      "/squad/*",
      "/squad/join-public/*",
      "/join/*",
    ]));
    expect(detail.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ "/": "/api/add/friend/*" }),
      expect.objectContaining({ "/": "/squad/join" }),
      expect.objectContaining({ "/": "/squad/*" }),
      expect.objectContaining({ "/": "/join/*" }),
    ]));
  });

  it("refuses placeholder identities in production instead of serving unverifiable JSON", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.IOS_APP_ID;
    delete process.env.ANDROID_SHA256_CERT_FINGERPRINTS;

    const aasa = await request(app()).get("/.well-known/apple-app-site-association");
    const assetLinks = await request(app()).get("/.well-known/assetlinks.json");

    expect(aasa.status).toBe(503);
    expect(assetLinks.status).toBe(503);
  });

  it("keeps iOS association available before Android signing is configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.IOS_APP_ID = "ABCDE12345.com.squadz.app";
    delete process.env.ANDROID_SHA256_CERT_FINGERPRINTS;

    expect((await request(app()).get("/.well-known/apple-app-site-association")).status).toBe(200);
    expect((await request(app()).get("/.well-known/assetlinks.json")).status).toBe(503);
  });

  it("keeps Android association independent from Apple configuration", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.IOS_APP_ID;
    process.env.ANDROID_SHA256_CERT_FINGERPRINTS = VALID_ANDROID_FINGERPRINT;

    expect((await request(app()).get("/.well-known/assetlinks.json")).status).toBe(200);
    expect((await request(app()).get("/.well-known/apple-app-site-association")).status).toBe(503);
  });
});