import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { uploadProductFactoryReference } from "@/lib/productFactory/references";

export default createProductFactoryRoute(async (req) => uploadProductFactoryReference({ ...req.body, projectId: requiredId(req.body.projectId, "项目 ID") }));
