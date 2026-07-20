import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    const image = await u.db("o_image").where({ id }).first();
    const assets = await u.db("o_assets").where({ imageId: id }).select("id", "revision");
    for (const asset of assets) {
      await u.db("o_assets").where("id", asset.id).update({ imageId: null, revision: Number(asset.revision ?? 1) + 1 });
    }
    await u.db("o_image").where({ id: id }).delete();
    if (image?.filePath) await u.oss.deleteFile(image.filePath).catch((e) => { if (e?.code !== "ENOENT") throw e; });
    res.status(200).send(success({ message: "资产图片删除成功" }));
  },
);
