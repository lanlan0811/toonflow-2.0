import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { retryProductFactoryJobs } from "@/lib/productFactory/queue";

export default createProductFactoryRoute(async (req) => retryProductFactoryJobs(requiredId(req.body.projectId, "项目 ID"), idList(req.body.jobIds, "任务 ID")));
