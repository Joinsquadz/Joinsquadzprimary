import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getSmtpStatus } from "../emailService";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/smtp", (_req, res) => {
  const smtp = getSmtpStatus();
  const status = smtp.configured ? 200 : 503;
  res.status(status).json({
    configured: smtp.configured,
    host: smtp.host,
    port: smtp.port,
    user: smtp.user,
    from: smtp.from,
    ...(smtp.missing.length > 0 ? { missing: smtp.missing } : {}),
  });
});

export default router;
