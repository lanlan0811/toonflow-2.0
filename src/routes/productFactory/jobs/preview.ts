import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { planProductFactoryJobs } from "@/lib/productFactory/queue";

export default createProductFactoryRoute(async (req) => planProductFactoryJobs({
  projectId: requiredId(req.body.projectId, "项目 ID"),
  productIds: idList(req.body.productIds, "商品 ID"),
  phase: req.body.phase === "video" ? "video" : "image",
  regenerate: req.body.regenerate === true,
}));
