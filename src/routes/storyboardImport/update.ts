import express from "express";
import { db } from "@/utils/db";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { recalculateStoryboardTracks } from "./recalculateTracks";
import { resolveExactRoleAssociations } from "@/lib/storyboardAssetAssociations";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    projectId: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
    duration: z.number(),
    track: z.string(),
    shouldGenerateImage: z.number(),
    associateAssetsIds: z.array(z.number()).optional(),
    excludedAutoAssetIds: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    const { id, projectId, prompt, videoDesc, duration, track, shouldGenerateImage, associateAssetsIds = [], excludedAutoAssetIds = [] } = req.body as {
      id: number;
      projectId: number;
      prompt: string;
      videoDesc: string;
      duration: number;
      track: string;
      shouldGenerateImage: number;
      associateAssetsIds?: number[];
      excludedAutoAssetIds?: number[];
    };
    if (duration <= 0) return res.status(400).send(error("时长必须大于 0"));

    try {
      const result = await db.transaction(async (trx: any) => {
        const storyboard = await trx("o_storyboard").where({ id, projectId }).first();
        if (!storyboard) throw new Error("分镜不存在");

        await trx("o_storyboard").where({ id, projectId }).update({
          prompt,
          videoDesc,
          duration: String(duration),
          track: track || "默认分组",
          shouldGenerateImage,
        });

        const uniqueAssetIds = [...new Set(associateAssetsIds.filter((assetId) => Number.isInteger(assetId) && assetId > 0))];
        if (uniqueAssetIds.length !== associateAssetsIds.length) throw new Error("关联资产 ID 必须是有效的正整数");
        const uniqueExcludedIds = [...new Set(excludedAutoAssetIds.filter((assetId) => Number.isInteger(assetId) && assetId > 0))];
        if (uniqueExcludedIds.length !== excludedAutoAssetIds.length) throw new Error("排除资产 ID 必须是有效的正整数");
        const requestedIds = [...new Set([...uniqueAssetIds, ...uniqueExcludedIds])];
        if (requestedIds.length) {
          const validAssets = await trx("o_assets")
            .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
            .where("o_assets.projectId", projectId)
            .where("o_scriptAssets.scriptId", storyboard.scriptId)
            .whereIn("o_assets.id", requestedIds)
            .distinct("o_assets.id", "o_assets.type", "o_assets.revision");
          const validAssetIds = validAssets.map((item: { id: number }) => item.id);
          if (validAssetIds.length !== requestedIds.length) {
            const validAssetIdSet = new Set(validAssetIds);
            const invalidAssetIds = requestedIds.filter((assetId) => !validAssetIdSet.has(assetId));
            throw new Error(`关联资产不属于当前项目和分镜表批次：${invalidAssetIds.join(", ")}`);
          }
        }

        for (const assetId of uniqueExcludedIds) {
          await trx("o_storyboardAssetExclusion")
            .insert({ storyboardId: id, assetId, createTime: Date.now() })
            .onConflict(["storyboardId", "assetId"])
            .ignore();
        }
        if (uniqueAssetIds.length) {
          await trx("o_storyboardAssetExclusion").where("storyboardId", id).whereIn("assetId", uniqueAssetIds).delete();
        }

        const automatic = await resolveExactRoleAssociations(trx, {
          projectId,
          scriptId: Number(storyboard.scriptId),
          storyboardId: id,
          prompt,
          videoDesc,
        });
        const effectiveAssetIds = [...new Set([...uniqueAssetIds, ...automatic.matched.map((item) => Number(item.id))])];
        const currentRelations = await trx("o_assets2Storyboard").where("storyboardId", id).select("assetId", "assetRevision", "referenceEnabled");
        const currentByAssetId = new Map<number, { assetRevision?: number; referenceEnabled?: number }>(
          currentRelations.map((relation: any) => [Number(relation.assetId), relation]),
        );
        const assets = effectiveAssetIds.length ? await trx("o_assets").whereIn("id", effectiveAssetIds).select("id", "revision") : [];
        const revisionByAssetId = new Map(assets.map((asset: any) => [Number(asset.id), Number(asset.revision ?? 1)]));

        await trx("o_assets2Storyboard").where("storyboardId", id).delete();
        if (effectiveAssetIds.length) {
          await trx("o_assets2Storyboard").insert(
            effectiveAssetIds.map((assetId) => ({
              storyboardId: id,
              assetId,
              assetRevision: Number(currentByAssetId.get(assetId)?.assetRevision ?? revisionByAssetId.get(assetId) ?? 1),
              referenceEnabled: currentByAssetId.get(assetId)?.referenceEnabled === 0 ? 0 : 1,
            })),
          );
        }
        const removedAssetIds = currentRelations.map((relation: any) => Number(relation.assetId)).filter((assetId: number) => !effectiveAssetIds.includes(assetId));
        if (removedAssetIds.length) {
          await trx("o_storyboardAssetOverride").where("storyboardId", id).whereIn("assetId", removedAssetIds).delete();
        }

        await recalculateStoryboardTracks(trx, projectId, [Number(storyboard.scriptId)]);
        return {
          message: "更新分镜成功",
          associateAssetsIds: effectiveAssetIds,
          automaticRoleAssetIds: automatic.matched.map((item) => Number(item.id)),
          excludedAssetIds: uniqueExcludedIds,
        };
      });

      res.status(200).send(success(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "更新分镜失败";
      res.status(400).send(error(message));
    }
  },
);
