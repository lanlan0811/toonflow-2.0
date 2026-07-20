import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureExactRoleAssociations } from "@/lib/storyboardAssetAssociations";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
  }),
  async (req, res) => {
    const { id, prompt, videoDesc } = req.body;
    await u.db("o_storyboard").where({ id }).update({
      prompt,
      videoDesc,
    });
    const storyboard = await u.db("o_storyboard").where({ id }).select("projectId", "scriptId").first();
    if (storyboard?.projectId && storyboard?.scriptId) {
      await ensureExactRoleAssociations(u.db, {
        storyboardId: id,
        projectId: Number(storyboard.projectId),
        scriptId: Number(storyboard.scriptId),
        prompt,
        videoDesc,
      });
    }
    res.status(200).send(success({ message: "更新提示词成功" }));
  },
);
