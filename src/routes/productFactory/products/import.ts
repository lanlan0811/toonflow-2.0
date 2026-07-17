import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { importProductFactoryCsv } from "@/lib/productFactory/csv";

export default createProductFactoryRoute(async (req) => importProductFactoryCsv(requiredId(req.body.projectId, "项目 ID"), String(req.body.csvText || "")));
