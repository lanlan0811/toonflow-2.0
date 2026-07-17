import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType } from "@/constants/project";
import { ProjectTypes } from "@/constants/project";
import { assertRedrawProjectModels } from "@/lib/redrawModel";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    projectType: z.string(),
    name: z.string(),
    intro: z.string(),
    type: z.string(),
    artStyle: z.string(),
    directorManual: z.string(),
    videoRatio: z.string(),
    imageModel: z.string(),
    videoModel: z.string(),
    imageQuality: z.string(),
    mode: z.string(),
  }),
  async (req, res) => {
    const { projectType, name, intro, type, directorManual, artStyle, videoRatio, imageModel, videoModel, imageQuality, mode } = req.body;
    const normalizedProjectType = normalizeProjectType(projectType);
    if (!normalizedProjectType) return res.status(400).send(error("项目类型仅支持：基于小说原文、基于剧本、基于分镜表、转绘"));
    if (normalizedProjectType === ProjectTypes.redraw) {
      try {
        await assertRedrawProjectModels(imageModel, videoModel);
      } catch (cause) {
        return res.status(400).send(error(cause instanceof Error ? cause.message : "转绘模型配置不兼容"));
      }
    }

    await u.db("o_project").insert({
      id: Date.now(),
      projectType: normalizedProjectType,
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      userId: 1,
      imageModel,
      videoModel,
      createTime: Date.now(),
      imageQuality,
      mode,
    });

    res.status(200).send(success({ message: "新增项目成功" }));
  },
);
