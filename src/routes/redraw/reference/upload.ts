import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { getOrCreateRedrawSource, invalidateRedrawFrom, redrawDb, requireRedrawProject } from "@/lib/redrawCommon";
import { parseJson } from "@/lib/redrawCommon";
import { redrawTargetStyleSchema } from "@/constants/redraw";
import u from "@/utils";

const router = express.Router();
export default router.post(
  "/",
  validateFields({ projectId: z.number().int().positive(), base64: z.string(), label: z.string().optional(), kind: z.enum(["style", "character", "scene", "prop"]).default("style"), assetId: z.number().int().positive().optional() }),
  async (req, res) => {
    try {
      await requireRedrawProject(req.body.projectId);
      const match = req.body.base64.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) throw new Error("参考图仅支持 PNG、JPEG、WebP base64 数据");
      const data = Buffer.from(match[2], "base64");
      if (!data.length || data.length > 10 * 1024 * 1024) throw new Error("单张参考图必须小于 10MB");
      const source = await getOrCreateRedrawSource(req.body.projectId);
      const ext = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
      const filePath = `${req.body.projectId}/redraw/references/${crypto.randomUUID()}.${ext}`;
      await u.oss.writeFile(filePath, data);
      const [id] = await redrawDb("o_redrawReference").insert({ projectId: req.body.projectId, sourceId: source.id, assetId: req.body.assetId ?? null, kind: req.body.kind, label: req.body.label ?? "", filePath, createTime: Date.now() });
      const targetStyle = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
      targetStyle.referenceIds = [...new Set([...targetStyle.referenceIds, Number(id)])];
      await redrawDb("o_redrawSource").where("id", source.id).update({ targetStyle: JSON.stringify(targetStyle), updateTime: Date.now() });
      await invalidateRedrawFrom(req.body.projectId, "createOriginalAssets", "目标参考图已修改");
      res.status(200).send(success({ ...(await redrawDb("o_redrawReference").where("id", id).first()), url: await u.oss.getFileUrl(filePath) }));
    } catch (cause) {
      res.status(400).send(error(u.error(cause).message));
    }
  },
);
