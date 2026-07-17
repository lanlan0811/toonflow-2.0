import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { saveProductPromptOverride } from "@/lib/productFactory/service";
import { PRODUCT_PROMPT_TEMPLATE_VERSION } from "@/lib/productFactory/types";

export default createProductFactoryRoute(async (req) => {
  const workflow = await saveProductPromptOverride({
    ...req.body,
    projectId: requiredId(req.body.projectId, "项目 ID"),
    productId: requiredId(req.body.productId, "商品 ID"),
    mediaType: req.body.mediaType === "video" ? "video" : "image",
  }, null);
  return { workflow, upgradedTo: PRODUCT_PROMPT_TEMPLATE_VERSION };
});
