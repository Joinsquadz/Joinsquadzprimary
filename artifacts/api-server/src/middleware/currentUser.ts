import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that requires an authenticated user from the session.
 * Returns 401 if the request has no valid session (set by authMiddleware).
 *
 * Usage: mount after authMiddleware (already done in app.ts).
 * authMiddleware sets req.user and patches req.isAuthenticated() — this
 * middleware just enforces the guard and provides a convenient req.currentUser alias.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}
