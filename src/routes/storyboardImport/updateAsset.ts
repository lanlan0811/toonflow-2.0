import express from "express";
import { z } from "zod";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { db } from "@/utils/db";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    id: z.number(),
    describe: z.string(),
    prompt: z.string(),
  }),
  async (req, res) => {
    const { projectId, scriptId, id, describe, prompt } = req.body as {
      projectId: number;
      scriptId: number;
      id: number;
      describe: string;
      prompt: string;
    };

    try {
      const asset = await db.transaction(async (trx) => {
        const project = await trx("o_project").where("id", projectId).select("id", "projectType").first();
        if (!project) throw new Error("项目不存在");
        if (normalizeProjectType(project.projectType ?? "") !== ProjectTypes.storyboard) throw new Error("仅基于分镜表的项目支持更新导入资产");

        const script = await trx("o_script").where({ id: scriptId, projectId }).select("id").first();
        if (!script) throw new Error("分镜表批次不存在或不属于当前项目");

        const currentAsset = await trx("o_assets")
          .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
          .where("o_assets.id", id)
          .where("o_assets.projectId", projectId)
          .where("o_scriptAssets.scriptId", scriptId)
          .select("o_assets.id")
          .first();
        if (!currentAsset) throw new Error("资产不存在或不属于当前分镜表批次");

        const normalizedPrompt = prompt.trim();
        await trx("o_assets").where({ id, projectId }).update({
          describe,
          prompt: normalizedPrompt || null,
          promptState: normalizedPrompt ? "已完成" : null,
          promptErrorReason: null,
        });

        return await trx("o_assets")
          .where({ id, projectId })
          .select("id", "name", "type", "assetsId", "projectId", "describe", "prompt", "promptState", "promptErrorReason", "imageId")
          .first();
      });

      return res.status(200).send(success(asset));
    } catch (e) {
      const message = e instanceof Error ? e.message : "更新导入资产失败";
      return res.status(400).send(error(message));
    }
  },
);
