import { createProductFactoryRoute, idList, requiredId } from "@/lib/productFactory/http";
import { enqueueProductFactoryJobs } from "@/lib/productFactory/queue";

export default createProductFactoryRoute(async (req) => {
  if (req.body.confirmed !== true) throw new Error("提交任务前必须明确确认费用与任务数量");
  return enqueueProductFactoryJobs({
    projectId: requiredId(req.body.projectId, "项目 ID"),
    productIds: idList(req.body.productIds, "商品 ID"),
    phase: req.body.phase === "video" ? "video" : "image",
    regenerate: req.body.regenerate === true,
  });
});
