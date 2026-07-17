import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { getProductFactoryJobProgress } from "@/lib/productFactory/queue";

export default createProductFactoryRoute(async (req) => getProductFactoryJobProgress(requiredId(req.body.projectId, "项目 ID"), Array.isArray(req.body.productIds) ? idList(req.body.productIds, "商品 ID") : undefined));
