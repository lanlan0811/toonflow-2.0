import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { importLegacyProductPromo } from "@/lib/productFactory/migration";

export default createProductFactoryRoute(async (req) => importLegacyProductPromo(requiredId(req.body.projectId, "项目 ID"), req.body.legacyCanvas));
