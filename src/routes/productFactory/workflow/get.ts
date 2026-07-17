import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { ensureProductWorkflow } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => ensureProductWorkflow(requiredId(req.body.projectId, "项目 ID"), requiredId(req.body.productId, "商品 ID")));
