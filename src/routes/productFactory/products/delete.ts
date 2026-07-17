import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { deleteProductFactoryItems } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => deleteProductFactoryItems(requiredId(req.body.projectId, "项目 ID"), idList(req.body.productIds, "商品 ID")));
