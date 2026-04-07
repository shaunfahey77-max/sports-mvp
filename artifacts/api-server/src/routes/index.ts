import { Router, type IRouter } from "express";
import healthRouter from "./health";
import snapshotsRouter from "./snapshots";
import picksRouter from "./picks";
import performanceRouter from "./performance";
import simulationRouter from "./simulation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(snapshotsRouter);
router.use(picksRouter);
router.use(performanceRouter);
router.use(simulationRouter);

export default router;
