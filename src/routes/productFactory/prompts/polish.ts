import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { polishProductFactoryPrompt } from "@/lib/productFactory/polish";

export default createProductFactoryRoute(async (req) => polishProductFactoryPrompt({
    ...req.body,
    projectId: requiredId(req.body.projectId, "项目 ID"),
    productId: requiredId(req.body.productId, "商品 ID"),
    mediaType: req.body.mediaType === "video" ? "video" : "image",
  }));
