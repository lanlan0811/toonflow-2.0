import express from "express";
import compressing from "compressing";
import u from "@/utils";
import { idList, requiredId } from "@/lib/productFactory/http";
import { collectProductFactoryExport } from "@/lib/productFactory/export";
import { error } from "@/lib/responseFormat";

const router = express.Router();

export default router.post("/", async (req, res) => {
  try {
    const projectId = requiredId(req.body.projectId, "项目 ID");
    const productIds = idList(req.body.productIds, "商品 ID");
    const bundle = await collectProductFactoryExport(projectId, productIds);
    const zipStream = new compressing.zip.Stream();
    for (const entry of bundle.entries) zipStream.addEntry(entry.content, { relativePath: entry.relativePath });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=product-factory-${projectId}.zip`);
    zipStream.pipe(res);
  } catch (caught) {
    if (!res.headersSent) res.status(400).send(error(u.error(caught).message));
  }
});
