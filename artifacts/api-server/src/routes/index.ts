import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import stripeRouter from "./stripe";
import eventsRouter from "./events";
import squadsRouter from "./squads";
import emailPreviewRouter from "./emailPreview";
import userPreferencesRouter from "./userPreferences";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stripeRouter);
router.use(eventsRouter);
router.use(squadsRouter);
router.use(emailPreviewRouter);
router.use(userPreferencesRouter);

export default router;
