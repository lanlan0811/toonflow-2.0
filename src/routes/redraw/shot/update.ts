import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { invalidateRedrawFrom, redrawDb, requireRedrawProject, validateShotTimeline } from "@/lib/redrawCommon";
import u from "@/utils";

const router = express.Router();
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    id: z.number().int().positive(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    scene: z.string(),
    characters: z.array(z.string()),
    actions: z.string(),
    emotion: z.string().optional(),
    camera: z.string(),
    dialogue: z.string(),
    sound: z.string(),
    assetClues: z.array(z.any()).optional(),
  }),
  async (req, res) => {
    try {
      await requireRedrawProject(req.body.projectId);
      const row = await redrawDb("o_redrawShot").where({ id: req.body.id, projectId: req.body.projectId }).first();
      if (!row) throw new Error("源镜头不存在");
      const source = await redrawDb("o_redrawSource").where("id", row.sourceId).first();
      const all = await redrawDb("o_redrawShot").where("sourceId", row.sourceId).orderBy("shotIndex");
      const timeline = all.map((item: any) => (item.id === row.id ? { ...item, startMs: req.body.startMs, endMs: req.body.endMs } : item));
      validateShotTimeline(timeline, source.durationMs, source.fps ? 1000 / source.fps : 0);
      const { startMs, endMs, scene, characters, actions, emotion, camera, dialogue, sound, assetClues } = req.body;
      await redrawDb("o_redrawShot").where("id", row.id).update({
        startMs,
        endMs,
        scene,
        characters: JSON.stringify(characters),
        actions,
        emotion: emotion ?? "",
        camera,
        dialogue,
        sound,
        assetClues: JSON.stringify(assetClues ?? []),
        confirmed: false,
        updateTime: Date.now(),
      });
      await redrawDb("o_redrawSource").where("id", row.sourceId).update({ confirmed: false, updateTime: Date.now() });
      await invalidateRedrawFrom(req.body.projectId, "createScript", "镜头边界、对白或动作已修改");
      res.status(200).send(success(await redrawDb("o_redrawShot").where("id", row.id).first()));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
