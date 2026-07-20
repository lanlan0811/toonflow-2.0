import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import { assertNoUnpublishedDraftReference, normalizeCanvasGraph } from "@/lib/storyboardCanvas";
import { ensureExactRoleAssociations } from "@/lib/storyboardAssetAssociations";

const router = express.Router();

const selectionSchema = z.object({
  assetId: z.number().int().positive(),
  sourceNodeId: z.string().optional().nullable(),
  referenceEnabled: z.boolean(),
  mode: z.enum(["global", "local"]),
  filePath: z.string().optional().nullable(),
  describe: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
  baseAssetRevision: z.number().int().positive().optional(),
});

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    storyboardId: z.number().int().positive(),
    flowId: z.number().int().positive().optional().nullable(),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    prompt: z.string(),
    finalImageUrl: z.string().optional().nullable(),
    assetSelections: z.array(selectionSchema).optional(),
  }),
  async (req, res) => {
    try {
      assertNoUnpublishedDraftReference(req.body.nodes, req.body.edges);
      const graph = normalizeCanvasGraph(req.body.nodes, req.body.edges);
      const result = await u.db.transaction(async (trx) => {
        const { projectId, scriptId, storyboardId } = req.body;
        const project = await trx("o_project").where("id", projectId).select("projectType").first();
        if (!project || normalizeProjectType(project.projectType ?? "") !== ProjectTypes.storyboard) {
          throw new Error("该能力仅适用于“基于分镜表”项目");
        }
        const storyboard = await trx("o_storyboard").where({ id: storyboardId, projectId, scriptId }).first();
        if (!storyboard) throw new Error("分镜不存在或不属于当前项目和剧本");

        await ensureExactRoleAssociations(trx, {
          storyboardId,
          projectId,
          scriptId,
          prompt: req.body.prompt,
          videoDesc: storyboard.videoDesc,
        });

        const expectedFlowId = Number(req.body.flowId || 0);
        const currentFlowId = Number(storyboard.flowId || 0);
        if (expectedFlowId !== currentFlowId) throw new Error("画布版本已变更，请刷新后重试");
        let flowId = currentFlowId;
        if (flowId) {
          const flow = await trx("o_imageFlow").where("id", flowId).first();
          if (!flow) throw new Error("画布流程不存在，请刷新后重试");
          await trx("o_imageFlow").where("id", flowId).update({ flowData: JSON.stringify(graph) });
        } else {
          [flowId] = await trx("o_imageFlow").insert({ flowData: JSON.stringify(graph) });
        }

        const updateStoryboard: Record<string, unknown> = { flowId, prompt: req.body.prompt };
        if (typeof req.body.finalImageUrl === "string") {
          const filePath = u.replaceUrl(req.body.finalImageUrl);
          updateStoryboard.filePath = filePath;
          updateStoryboard.state = filePath ? "已完成" : "未生成";
          updateStoryboard.reason = null;
          updateStoryboard.shouldGenerateImage = filePath ? 1 : 0;
        }
        await trx("o_storyboard").where({ id: storyboardId, projectId, scriptId }).update(updateStoryboard);

        const relations = await trx("o_assets2Storyboard").where("storyboardId", storyboardId).select("assetId");
        const relationIds = new Set(relations.map((relation: any) => Number(relation.assetId)));
        const selections = req.body.assetSelections ?? [];
        const unknownIds = selections.map((selection: any) => Number(selection.assetId)).filter((assetId: number) => !relationIds.has(assetId));
        if (unknownIds.length) throw new Error(`画布包含未关联到当前分镜的资产：${[...new Set(unknownIds)].join(", ")}`);

        for (const selection of selections) {
          const asset = await trx("o_assets")
            .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
            .where({ "o_assets.id": selection.assetId, "o_assets.projectId": projectId, "o_scriptAssets.scriptId": scriptId })
            .select("o_assets.revision")
            .first();
          if (!asset) throw new Error(`资产 ${selection.assetId} 不存在或已跨项目`);
          const relationUpdate: Record<string, number> = { referenceEnabled: selection.referenceEnabled ? 1 : 0 };
          if (selection.mode === "local") {
            const filePath = u.replaceUrl(selection.filePath || "");
            if (!filePath) throw new Error(`资产 ${selection.assetId} 的本分镜版本没有有效图片`);
            if (!(await u.oss.fileExists(filePath))) throw new Error(`资产 ${selection.assetId} 的本分镜版本图片已不存在，请重新上传或选择版本`);
            await trx("o_storyboardAssetOverride")
              .insert({
                storyboardId,
                assetId: selection.assetId,
                filePath,
                describe: selection.describe ?? null,
                prompt: selection.prompt ?? null,
                sourceNodeId: selection.sourceNodeId ?? null,
                baseAssetRevision: Number(selection.baseAssetRevision ?? asset.revision ?? 1),
                updateTime: Date.now(),
              })
              .onConflict(["storyboardId", "assetId"])
              .merge();
          } else {
            await trx("o_storyboardAssetOverride").where({ storyboardId, assetId: selection.assetId }).delete();
            relationUpdate.assetRevision = Number(asset.revision ?? 1);
          }
          await trx("o_assets2Storyboard").where({ storyboardId, assetId: selection.assetId }).update(relationUpdate);
        }
        return { flowId };
      });
      res.status(200).send(success(result));
    } catch (cause) {
      res.status(400).send(error(cause instanceof Error ? cause.message : "保存画布失败"));
    }
  },
);
