import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { getProductFactoryWorkspace } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => getProductFactoryWorkspace(requiredId(req.body.projectId, "项目 ID")));
