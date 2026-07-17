import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { redrawDb, requireRedrawProject, validateShotTimeline } from "@/lib/redrawCommon";
import u from "@/utils";

const router = express.Router();
export default router.post("/", validateFields({ projectId: z.number().int().positive() }), async (req, res) => {
  try {
    await requireRedrawProject(req.body.projectId);
    const source = await redrawDb("o_redrawSource").where("projectId", req.body.projectId).first();
    if (!source) throw new Error("请先上传并分析源视频");
    const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
    validateShotTimeline(shots, source.durationMs, source.fps ? 1000 / source.fps : 0);
    await redrawDb.transaction(async (trx: any) => {
      await trx("o_redrawShot").where("sourceId", source.id).update({ confirmed: true, updateTime: Date.now() });
      await trx("o_redrawSource").where("id", source.id).update({ confirmed: true, updateTime: Date.now() });
    });
    res.status(200).send(success({ confirmed: true, shotCount: shots.length }));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
