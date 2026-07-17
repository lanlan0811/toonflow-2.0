import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { redrawDb, requireRedrawProject } from "@/lib/redrawCommon";
import u from "@/utils";

const router = express.Router();
export default router.post("/", validateFields({ projectId: z.number().int().positive(), segmentId: z.number().int().positive(), accepted: z.boolean() }), async (req, res) => {
  try {
    await requireRedrawProject(req.body.projectId);
    const segment = await redrawDb("o_redrawSegment").where({ id: req.body.segmentId, projectId: req.body.projectId }).first();
    if (!segment) throw new Error("转绘片段不存在");
    if (req.body.accepted && !segment.videoId) throw new Error("片段尚无可人工接受的生成视频");
    await redrawDb("o_redrawSegment").where("id", segment.id).update({ accepted: req.body.accepted, state: req.body.accepted ? "manually_accepted" : "needs_review", updateTime: Date.now() });
    if (req.body.accepted) await redrawDb("o_videoTrack").where("id", segment.trackId).update({ selectVideoId: segment.videoId });
    res.status(200).send(success({ segmentId: segment.id, accepted: req.body.accepted }));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
