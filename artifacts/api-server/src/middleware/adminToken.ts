import { type Request, type Response, type NextFunction } from "express";

/**
 * Protects operator-only endpoints with the server's configured admin token.
 * The token is intentionally read at request time so staging can configure it
 * without rebuilding the application.
 */
export function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configured = process.env.INTERNAL_API_TOKEN;
  if (!configured) {
    res.status(401).json({
      error: "Internal API access not configured — set the INTERNAL_API_TOKEN secret",
    });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (token !== configured) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}