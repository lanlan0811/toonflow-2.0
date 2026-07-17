import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { saveProductPromptOverride } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => saveProductPromptOverride({
  ...req.body,
  projectId: requiredId(req.body.projectId, "项目 ID"),
  productId: requiredId(req.body.productId, "商品 ID"),
  mediaType: req.body.mediaType === "video" ? "video" : "image",
}, null));
