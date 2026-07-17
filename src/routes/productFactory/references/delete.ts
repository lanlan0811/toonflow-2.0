import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { deleteProductFactoryReference } from "@/lib/productFactory/references";

export default createProductFactoryRoute(async (req) => deleteProductFactoryReference(requiredId(req.body.projectId, "项目 ID"), requiredId(req.body.referenceId, "参考图 ID")));
