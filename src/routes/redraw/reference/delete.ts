import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { invalidateRedrawFrom, redrawDb, requireRedrawProject } from "@/lib/redrawCommon";
import { parseJson } from "@/lib/redrawCommon";
import { redrawTargetStyleSchema } from "@/constants/redraw";
import u from "@/utils";

const router = express.Router();
export default router.post("/", validateFields({ projectId: z.number().int().positive(), id: z.number().int().positive() }), async (req, res) => {
  try {
    await requireRedrawProject(req.body.projectId);
    const row = await redrawDb("o_redrawReference").where({ id: req.body.id, projectId: req.body.projectId }).first();
    if (!row) throw new Error("参考图不存在");
    if (row.kind === "sourceEvidence") throw new Error("源视频证据由分析流程管理，不能作为目标参考图删除");
    await redrawDb("o_redrawReference").where("id", row.id).delete();
    await u.oss.deleteFile(row.filePath).catch(() => {});
    const source = await redrawDb("o_redrawSource").where("projectId", req.body.projectId).first();
    if (source) {
      const targetStyle = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
      targetStyle.referenceIds = targetStyle.referenceIds.filter((id) => id !== row.id);
      await redrawDb("o_redrawSource").where("id", source.id).update({ targetStyle: JSON.stringify(targetStyle), updateTime: Date.now() });
    }
    await invalidateRedrawFrom(req.body.projectId, "createOriginalAssets", "目标参考图已修改");
    res.status(200).send(success(null));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
