import express from "express";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import { copyCanvasImageToAsset, normalizeCanvasGraph } from "@/lib/storyboardCanvas";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    scriptId: z.number().int().positive(),
    storyboardId: z.number().int().positive(),
    assetId: z.number().int().positive().optional().nullable(),
    expectedRevision: z.number().int().positive().optional().nullable(),
    type: z.enum(["role", "scene", "tool"]),
    name: z.string().min(1),
    describe: z.string().optional().nullable(),
    prompt: z.string().optional().nullable(),
    imageUrl: z.string().min(1),
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }),
  async (req, res) => {
    let permanentPath = "";
    let committed = false;
    try {
      const { projectId, scriptId, storyboardId, type } = req.body;
      const project = await u.db("o_project").where("id", projectId).select("projectType").first();
      if (!project || normalizeProjectType(project.projectType ?? "") !== ProjectTypes.storyboard) {
        throw new Error("该能力仅适用于“基于分镜表”项目");
      }
      const script = await u.db("o_script").where({ id: scriptId, projectId }).first();
      const storyboard = await u.db("o_storyboard").where({ id: storyboardId, scriptId, projectId }).first();
      if (!script || !storyboard) throw new Error("剧本或分镜不存在");

      const requestedAssetId = Number(req.body.assetId || 0);
      if (requestedAssetId) {
        const current = await u
          .db("o_assets")
          .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
          .where({ "o_assets.id": requestedAssetId, "o_assets.projectId": projectId, "o_assets.type": type, "o_scriptAssets.scriptId": scriptId })
          .select("o_assets.revision")
          .first();
        if (!current) throw new Error("资产不存在、类型不匹配或已跨项目");
        if (!req.body.expectedRevision || Number(current.revision ?? 1) !== Number(req.body.expectedRevision)) {
          throw new Error("正式资产已被其他操作更新，请刷新画布后重试");
        }
      } else {
        const duplicate = await u
          .db("o_assets")
          .where({ projectId, type })
          .whereRaw("trim(name) = ?", [String(req.body.name).trim()])
          .first("id", "name");
        if (duplicate) throw new Error(`项目内已存在同类型同名资产“${duplicate.name}”，请改用已有资产`);
      }

      permanentPath = await copyCanvasImageToAsset(projectId, scriptId, type, req.body.imageUrl);
      const permanentSrc = await u.oss.getSmallImageUrl(permanentPath);
      const permanentOriginalSrc = await u.oss.getFileUrl(permanentPath);
      const graph = normalizeCanvasGraph(req.body.nodes, req.body.edges);
      const result = await u.db.transaction(async (trx) => {
        const [flowId] = await trx("o_imageFlow").insert({ flowData: JSON.stringify(graph) });
        let assetId = requestedAssetId;
        let revision = 1;
        if (assetId) {
          const asset = await trx("o_assets")
            .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
            .where({ "o_assets.id": assetId, "o_assets.projectId": projectId, "o_assets.type": type, "o_scriptAssets.scriptId": scriptId })
            .select("o_assets.*")
            .first();
          if (!asset || Number(asset.revision ?? 1) !== Number(req.body.expectedRevision)) {
            throw new Error("正式资产版本冲突，请刷新后重试");
          }
          revision = Number(asset.revision ?? 1) + 1;
        }

        const [imageId] = await trx("o_image").insert({
          filePath: permanentPath,
          state: "已完成",
          assetsId: assetId || null,
        });
        if (assetId) {
          await trx("o_assets").where({ id: assetId, projectId, type }).update({
            name: String(req.body.name).trim(),
            describe: req.body.describe ?? "",
            prompt: req.body.prompt ?? "",
            imageId,
            flowId,
            revision,
            promptState: "已完成",
          });
        } else {
          [assetId] = await trx("o_assets").insert({
            name: String(req.body.name).trim(),
            type,
            describe: req.body.describe ?? "",
            prompt: req.body.prompt ?? "",
            projectId,
            scriptId,
            imageId,
            flowId,
            revision,
            startTime: Date.now(),
            promptState: "已完成",
          });
          await trx("o_image").where("id", imageId).update({ assetsId: assetId });
        }

        await trx("o_scriptAssets").insert({ scriptId, assetId }).onConflict(["scriptId", "assetId"]).ignore();
        await trx("o_assets2Storyboard")
          .insert({ storyboardId, assetId, assetRevision: revision, referenceEnabled: 1 })
          .onConflict(["storyboardId", "assetId"])
          .merge({ assetRevision: revision, referenceEnabled: 1 });
        await trx("o_storyboardAssetOverride").where({ storyboardId, assetId }).delete();
        await trx("o_storyboardAssetExclusion").where({ storyboardId, assetId }).delete();

        const affected = await trx("o_assets2Storyboard")
          .where("assetId", assetId)
          .where("referenceEnabled", 1)
          .whereNot("storyboardId", storyboardId)
          .whereNotExists(function () {
            this.select(trx.raw("1"))
              .from("o_storyboardAssetOverride")
              .whereRaw("o_storyboardAssetOverride.storyboardId = o_assets2Storyboard.storyboardId")
              .whereRaw("o_storyboardAssetOverride.assetId = o_assets2Storyboard.assetId");
          })
          .count("storyboardId as total")
          .first();
        return { assetId, imageId, flowId, revision, affectedStoryboardCount: Number(affected?.total ?? 0) };
      });
      committed = true;
      res.status(200).send(
        success({
          ...result,
          name: String(req.body.name).trim(),
          type,
          describe: req.body.describe ?? "",
          prompt: req.body.prompt ?? "",
          src: permanentSrc,
          originalSrc: permanentOriginalSrc,
        }),
      );
    } catch (cause) {
      if (permanentPath && !committed) {
        try {
          await u.oss.deleteFile(permanentPath);
        } catch {
          // Best-effort cleanup for a file written before a rejected transaction.
        }
      }
      res.status(400).send(error(cause instanceof Error ? cause.message : "发布资产失败"));
    }
  },
);
