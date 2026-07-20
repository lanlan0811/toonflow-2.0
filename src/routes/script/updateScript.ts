import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 编辑剧本
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    content: z.string(),
    assets: z.array(z.number()),
  }),
  async (req, res) => {
    const { id, name, content, assets } = req.body;
    await u.db("o_script").where({ id }).update({
      name,
      content,
    });
    if (assets.length) {
      const assetsData = await u.db("o_assets").whereIn("id", assets).select();
      const existingAssetIds = (await u.db("o_scriptAssets").where({ scriptId: id }).select("assetId")).map((item) => Number(item.assetId));
      const nextAssetIds = new Set(assetsData.map((item) => Number(item.id)));
      const removedAssetIds = existingAssetIds.filter((assetId) => !nextAssetIds.has(assetId));
      if (removedAssetIds.length) {
        const storyboardIds = (await u.db("o_storyboard").where("scriptId", id).select("id")).map((item) => Number(item.id));
        if (storyboardIds.length) {
          await u.db("o_storyboardAssetOverride").whereIn("storyboardId", storyboardIds).whereIn("assetId", removedAssetIds).delete();
          await u.db("o_storyboardAssetExclusion").whereIn("storyboardId", storyboardIds).whereIn("assetId", removedAssetIds).delete();
          await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).whereIn("assetId", removedAssetIds).delete();
        }
      }
      await u.db("o_scriptAssets").where({ scriptId: id }).delete();
      if (assetsData.length) {
        const insertData = assetsData.map((item) => {
          return {
            scriptId: id,
            assetId: item.id,
          };
        });
        await u.db("o_scriptAssets").insert(insertData);
      }
    }

    res.status(200).send(success({ message: "编辑剧本成功" }));
  },
);
