import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { updateProductWorkflow } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => updateProductWorkflow(requiredId(req.body.projectId, "项目 ID"), requiredId(req.body.productId, "商品 ID"), req.body.graph, true));
