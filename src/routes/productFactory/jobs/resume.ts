import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { resumeProductFactoryJobs } from "@/lib/productFactory/queue";

export default createProductFactoryRoute(async (req) => resumeProductFactoryJobs(requiredId(req.body.projectId, "项目 ID"), Array.isArray(req.body.jobIds) ? idList(req.body.jobIds, "任务 ID") : undefined));
