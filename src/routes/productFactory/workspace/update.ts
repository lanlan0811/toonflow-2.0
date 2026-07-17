import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { updateProductFactoryWorkspace } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => updateProductFactoryWorkspace(requiredId(req.body.projectId, "项目 ID"), req.body));
