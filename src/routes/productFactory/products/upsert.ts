import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { upsertProductFactoryItem } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => upsertProductFactoryItem(requiredId(req.body.projectId, "项目 ID"), req.body));
