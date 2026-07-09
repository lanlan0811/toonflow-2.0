import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    keyword: z.string().optional().nullable(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, keyword, page = 1, pageSize = 50 } = req.body as { projectId: number; keyword?: string | null; page?: number; pageSize?: number };
    const offset = (page - 1) * pageSize;

    const query = u
      .db("o_storyboard")
      .where({ projectId })
      .modify((qb) => {
        const text = keyword?.trim();
        if (!text) return;
        qb.andWhere((builder) => {
          builder.where("prompt", "like", `%${text}%`).orWhere("videoDesc", "like", `%${text}%`).orWhere("track", "like", `%${text}%`);
        });
      });

    const rows = await query.clone().orderBy("index", "asc").orderBy("id", "asc").offset(offset).limit(pageSize);
    const totalQuery = (await query.clone().count("* as total").first()) as { total?: number } | undefined;
    const storyboardIds = rows.map((item: { id?: number }) => item.id!).filter(Boolean);

    const relations = storyboardIds.length ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).select("storyboardId", "assetId") : [];
    const assetIds = [...new Set(relations.map((item: { assetId?: number }) => item.assetId).filter(Boolean))];
    const assets = assetIds.length ? await u.db("o_assets").whereIn("id", assetIds).select("id", "name", "type", "describe", "imageId", "prompt", "promptState", "promptErrorReason") : [];
    const assetMap = new Map(assets.map((item) => [item.id, item]));
    const relationMap = relations.reduce<Record<number, any[]>>((result, item) => {
      if (!item.storyboardId) return result;
      if (!result[item.storyboardId]) result[item.storyboardId] = [];
      const asset = assetMap.get(item.assetId);
      if (asset) result[item.storyboardId].push(asset);
      return result;
    }, {});

    const originalAssets = await u.db("o_assets").where({ projectId }).whereNull("assetsId").select("id", "name", "type", "describe", "imageId", "prompt", "promptState", "promptErrorReason");

    const data = await Promise.all(
      rows.map(async (item: { id?: number; index?: number; prompt?: string; duration?: string | number; state?: string; scriptId?: number; projectId?: number; track?: string; videoDesc?: string; shouldGenerateImage?: number; reason?: string; filePath?: string }) => ({
        id: item.id,
        index: item.index,
        prompt: item.prompt,
        duration: Number(item.duration ?? 0),
        state: item.state,
        scriptId: item.scriptId,
        projectId: item.projectId,
        track: item.track,
        videoDesc: item.videoDesc,
        shouldGenerateImage: item.shouldGenerateImage,
        reason: item.reason,
        src: item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "",
        assets: relationMap[item.id!] ?? [],
      })),
    );

    res.status(200).send(
      success({
        data,
        total: Number(totalQuery?.total ?? 0),
        assets: originalAssets,
      }),
    );
  },
);
