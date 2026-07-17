import { createProductFactoryRoute, requiredId } from "@/lib/productFactory/http";
import { saveProductPromptOverride } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => {
  const overrides = req.body.overrides && typeof req.body.overrides === "object"
    ? Object.fromEntries(["goal", "creative", "craft"].filter((key) => typeof req.body.overrides[key] === "string").map((key) => [key, req.body.overrides[key].trim()]))
    : {};
  return saveProductPromptOverride({
    ...req.body,
    projectId: requiredId(req.body.projectId, "项目 ID"),
    productId: requiredId(req.body.productId, "商品 ID"),
    mediaType: req.body.mediaType === "video" ? "video" : "image",
  }, overrides);
});
