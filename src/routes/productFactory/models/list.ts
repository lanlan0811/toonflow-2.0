import u from "@/utils";
import { createProductFactoryRoute } from "@/lib/productFactory/http";
import { getProductFactoryModelMetadata, modelSupportsProductReference } from "@/lib/productFactory/service";

export default createProductFactoryRoute(async (req) => {
  const type = req.body.type === "video" ? "video" : "image";
  const vendors = await u.db("o_vendorConfig").where("enable", 1).select("id");
  const result: any[] = [];
  for (const vendorRow of vendors) {
    try {
      const vendorId = String(vendorRow.id);
      const vendor = u.vendor.getVendor(vendorId);
      const models = await u.vendor.getModelList(vendorId);
      for (const model of models.filter((item: any) => item.type === type)) {
        const key = `${vendorId}:${model.modelName}`;
        const metadata = await getProductFactoryModelMetadata(key);
        if (!modelSupportsProductReference(metadata, type)) continue;
        result.push({
          id: vendorId,
          label: model.name,
          value: model.modelName,
          type,
          name: vendor?.name || "",
          mode: metadata.modes,
          promptLanguage: metadata.promptLanguage,
          maxReferenceImages: metadata.maxReferenceImages,
          durationResolutionMap: metadata.raw?.durationResolutionMap || [],
          audio: metadata.raw?.audio,
        });
      }
    } catch {
      // 一个损坏或过时的 Vendor 不应阻止其他可用模型出现在商品工厂中。
    }
  }
  return result;
});
