import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { createStorageUploadUrl, createStorageDownloadUrl } from "../services/objectStorage";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Hard cap on a single uploaded file: 150 MB. Photos and videos both flow
 * through the presigned-upload request below, so the limit is enforced here at
 * URL-issue time (the binary is PUT directly to cloud storage and never passes
 * through this server). The client reports the byte size up front so an
 * oversized file is rejected before any bytes are transferred.
 */
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  if (parsed.data.size > MAX_UPLOAD_BYTES) {
    res.status(413).json({
      error: "File too large. Photos and videos must be 150 MB or smaller.",
    });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    // Prefer Supabase Storage — direct client-to-cloud upload (no server proxying).
    // isPublicAccess=true (e.g. profile images) returns the Supabase public URL directly.
    // isPublicAccess=false (default, e.g. vault photos, attachments) returns an
    // auth-gated /objects/supabase/* path served via signed URL redirect.
    const isPublicAccess = (req.body as Record<string, unknown>).isPublicAccess === true;
    const supabaseUpload = await createStorageUploadUrl(contentType, isPublicAccess);
    if (supabaseUpload) {
      // Bind the new object path to the requester so other features can verify
      // ownership before serving it (prevents claiming another user's object).
      if (!isPublicAccess) {
        await storage.recordUpload(req.user!.id, supabaseUpload.objectPath);
      }
      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL: supabaseUpload.uploadURL,
          objectPath: supabaseUpload.objectPath,
          metadata: { name, size, contentType },
        }),
      );
      return;
    }

    // Avatars REQUIRE a publicly-loadable URL. If Supabase public-upload creation
    // failed for a public request, do NOT fall back to the auth-gated Replit path —
    // that persists a URL the no-auth <Image> can never load (the original bug).
    // Fail loudly so the client surfaces "couldn't upload" instead of a broken avatar.
    if (isPublicAccess) {
      res.status(502).json({ error: "Could not generate a public upload URL" });
      return;
    }

    // Fall back to Replit Object Storage (private assets only)
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    await storage.recordUpload(req.user!.id, objectPath);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const userId = req.user!.id;

    // ── Supabase-stored objects (path prefix: supabase/) ───────────────────────
    // These are served via a short-lived signed URL redirect instead of being
    // proxied through the server. The bucket should be configured as Private.
    if (wildcardPath.startsWith("supabase/")) {
      const storagePath = wildcardPath.slice("supabase/".length);

      // Authorize: only the uploader, squad members, event host, or a
      // conversation participant may access private Supabase objects.
      const canAccess =
        (await storage.canUserViewPhotoByUrl(objectPath, userId)) ||
        (await storage.canUserViewMessageAttachment(objectPath, userId)) ||
        (await storage.canUserViewFeedMedia(objectPath, userId)) ||
        (await storage.canUserViewMomentMedia(objectPath, userId));
      if (!canAccess) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const signedUrl = await createStorageDownloadUrl(storagePath, 3600);
      if (!signedUrl) {
        res.status(502).json({ error: "Could not generate a download URL for this object" });
        return;
      }
      res.redirect(302, signedUrl);
      return;
    }

    // ── Legacy Replit Object Storage ───────────────────────────────────────────
    // Authorize before revealing whether the object exists.
    const canAccess =
      (await storage.canUserViewPhotoByUrl(objectPath, userId)) ||
      (await storage.canUserViewMessageAttachment(objectPath, userId)) ||
      (await storage.canUserViewFeedMedia(objectPath, userId)) ||
      (await storage.canUserViewMomentMedia(objectPath, userId));
    if (!canAccess) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
