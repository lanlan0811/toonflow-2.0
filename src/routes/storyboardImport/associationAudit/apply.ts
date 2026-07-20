import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { db } from "@/utils/db";
import { findExactRoleMatches, storyboardRoleText } from "@/lib/storyboardAssetAssociations";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";

const pairSchema = z.object({ storyboardId: z.number().int().positive(), assetId: z.number().int().positive() });
const router = express.Router();

export default router.post(
  "/",
  validateFields({ additions: z.array(pairSchema).optional(), exclusions: z.array(pairSchema).optional() }),
  async (req, res) => {
    try {
      const rawAdditions = (req.body.additions || []) as { storyboardId: number; assetId: number }[];
      const rawExclusions = (req.body.exclusions || []) as { storyboardId: number; assetId: number }[];
      const dedupe = (items: typeof rawAdditions) => [...new Map(items.map((item) => [`${item.storyboardId}:${item.assetId}`, item])).values()];
      const exclusions = dedupe(rawExclusions);
      const excludedKeys = new Set(exclusions.map((item) => `${item.storyboardId}:${item.assetId}`));
      const additions = dedupe(rawAdditions).filter((item) => !excludedKeys.has(`${item.storyboardId}:${item.assetId}`));
      if (!additions.length && !exclusions.length) throw new Error("没有需要应用的关联变更");

      const result = await db.transaction(async (trx) => {
        let added = 0;
        let excluded = 0;
        const skipped: { storyboardId: number; assetId: number; reason: string }[] = [];
        for (const pair of [...additions, ...exclusions]) {
          const storyboard = await trx("o_storyboard").where("id", pair.storyboardId).select("id", "projectId", "scriptId", "prompt", "videoDesc").first();
          const project = storyboard ? await trx("o_project").where("id", storyboard.projectId).select("projectType").first() : null;
          const asset = await trx("o_assets")
            .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
            .where("o_assets.id", pair.assetId)
            .where("o_assets.type", "role")
            .where("o_scriptAssets.scriptId", storyboard?.scriptId || 0)
            .select("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.projectId", "o_assets.revision")
            .first();
          if (
            !storyboard ||
            !project ||
            normalizeProjectType(String(project.projectType ?? "")) !== ProjectTypes.storyboard ||
            !asset ||
            Number(asset.projectId) !== Number(storyboard.projectId)
          ) {
            skipped.push({ ...pair, reason: "分镜或角色不属于同一项目/剧本" });
            continue;
          }
          const exact = findExactRoleMatches(storyboardRoleText(storyboard.prompt, storyboard.videoDesc), [asset]).matched.length > 0;
          if (!exact) {
            skipped.push({ ...pair, reason: "分镜文本已不再精确命中该角色" });
            continue;
          }
          const isExclusion = exclusions.some((item) => item.storyboardId === pair.storyboardId && item.assetId === pair.assetId);
          if (isExclusion) {
            await trx("o_storyboardAssetExclusion")
              .insert({ ...pair, createTime: Date.now() })
              .onConflict(["storyboardId", "assetId"])
              .merge({ createTime: Date.now() });
            await trx("o_storyboardAssetOverride").where(pair).delete();
            await trx("o_assets2Storyboard").where(pair).delete();
            excluded += 1;
            continue;
          }
          const blocked = await trx("o_storyboardAssetExclusion").where(pair).first();
          if (blocked) {
            skipped.push({ ...pair, reason: "该角色已被永久排除" });
            continue;
          }
          const existing = await trx("o_assets2Storyboard").where(pair).first();
          if (!existing) {
            await trx("o_assets2Storyboard").insert({ ...pair, assetRevision: Math.max(1, Number(asset.revision || 1)), referenceEnabled: 1 });
            added += 1;
          }
        }
        return { added, excluded, skipped };
      });
      return res.status(200).send(success(result));
    } catch (e) {
      return res.status(400).send(error(e instanceof Error ? e.message : "应用关联修复失败"));
    }
  },
);
