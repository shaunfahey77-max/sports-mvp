import { Router, type IRouter } from "express";
import healthRouter from "./health";
import snapshotsRouter from "./snapshots";
import picksRouter from "./picks";
import performanceRouter from "./performance";
import simulationRouter from "./simulation";
import oddsRouter from "./odds";
import userRouter from "./user";
import stripeRouter from "./stripe";
import adminRouter from "./admin";
import launchRouter from "./launch";

const router: IRouter = Router();

router.use(healthRouter);
router.use(snapshotsRouter);
router.use(picksRouter);
router.use(performanceRouter);
router.use(simulationRouter);
router.use(oddsRouter);
router.use(userRouter);
router.use(stripeRouter);
router.use(adminRouter);
router.use(launchRouter);

export default router;
