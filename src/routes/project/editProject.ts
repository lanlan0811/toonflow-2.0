import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import { assertRedrawProjectModels } from "@/lib/redrawModel";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    intro: z.string(),
    type: z.string(),
    artStyle: z.string(),
    directorManual: z.string(),
    videoRatio: z.string(),
    imageModel: z.string(),
    videoModel: z.string(),
    projectType: z.string(),
    imageQuality: z.string(),
    mode: z.string(),
  }),
  async (req, res) => {
    const { id, name, intro, type, artStyle, videoRatio, directorManual, imageModel, videoModel, imageQuality, projectType, mode } = req.body;
    const normalizedProjectType = normalizeProjectType(projectType);
    if (!normalizedProjectType) return res.status(400).send(error("项目类型仅支持：基于小说原文、基于剧本、基于分镜表、转绘"));
    if (normalizedProjectType === ProjectTypes.redraw) {
      try {
        await assertRedrawProjectModels(imageModel, videoModel);
      } catch (cause) {
        return res.status(400).send(error(cause instanceof Error ? cause.message : "转绘模型配置不兼容"));
      }
    }

    await u.db("o_project").where("id", id).update({
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      imageModel,
      videoModel,
      imageQuality,
      projectType: normalizedProjectType,
      mode,
    });

    res.status(200).send(success({ message: "编辑项目成功" }));
  },
);
