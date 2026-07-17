import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { setPrimaryProductFactoryReference } from "@/lib/productFactory/references";

export default createProductFactoryRoute(async (req) => setPrimaryProductFactoryReference(requiredId(req.body.projectId, "项目 ID"), requiredId(req.body.productId, "商品 ID"), requiredId(req.body.referenceId, "参考图 ID")));
