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
    url: z.string(),
    flowId: z.number(),
  }),
  async (req, res) => {
    const { id, url, flowId } = req.body;
    await u.db.transaction(async (trx) => {
      const [imageId] = await trx("o_image").insert({
        filePath: u.replaceUrl(url),
        state: "已完成",
        assetsId: id,
      });
      const asset = await trx("o_assets").where({ id }).select("revision").first();
      await trx("o_assets")
        .where({ id })
        .update({ flowId, imageId, revision: Number(asset?.revision ?? 1) + 1 });
    });
    res.status(200).send(success({ message: "更新提示词成功" }));
  },
);
