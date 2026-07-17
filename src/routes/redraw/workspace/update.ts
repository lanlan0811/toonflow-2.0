import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { redrawTargetStyleSchema } from "@/constants/redraw";
import { error, success } from "@/lib/responseFormat";
import { getOrCreateRedrawSource, invalidateRedrawFrom, parseJson, redrawDb, requireRedrawProject, stableHash } from "@/lib/redrawCommon";
import u from "@/utils";

const router = express.Router();
export default router.post(
  "/",
  validateFields({ projectId: z.number().int().positive(), targetStyle: redrawTargetStyleSchema }),
  async (req, res) => {
    try {
      await requireRedrawProject(req.body.projectId);
      const source = await getOrCreateRedrawSource(req.body.projectId);
      const previous = parseJson(source.targetStyle, {});
      const targetStyle = redrawTargetStyleSchema.parse(req.body.targetStyle);
      await redrawDb("o_redrawSource").where("id", source.id).update({ targetStyle: JSON.stringify(targetStyle), updateTime: Date.now() });
      if (stableHash(previous) !== stableHash(targetStyle)) await invalidateRedrawFrom(req.body.projectId, "createOriginalAssets", "目标风格已修改");
      res.status(200).send(success(targetStyle));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
