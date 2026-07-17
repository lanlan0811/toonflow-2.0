import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { requireRedrawProject } from "@/lib/redrawCommon";
import { resetRedrawWorkflow } from "@/lib/redrawReset";
import u from "@/utils";

const router = express.Router();
export default router.post("/", validateFields({ projectId: z.number().int().positive() }), async (req, res) => {
  try {
    await requireRedrawProject(req.body.projectId);
    await resetRedrawWorkflow(req.body.projectId);
    res.status(200).send(success({ message: "转绘流程已重置，源视频和风格参考图已保留" }));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
