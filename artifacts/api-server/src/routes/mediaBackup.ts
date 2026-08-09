import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { runMediaBackup } from "../lib/mediaBackup";

const router: IRouter = Router();

function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.INTERNAL_API_TOKEN;
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  if (!configured || token !== configured) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post("/internal/media-backup", requireInternalToken, async (_req, res, next) => {
  try {
    res.json(await runMediaBackup());
  } catch (error) {
    next(error);
  }
});

export default router;