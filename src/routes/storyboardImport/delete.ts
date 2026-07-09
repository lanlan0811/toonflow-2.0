import express from "express";
import { db } from "@/utils/db";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { recalculateStoryboardTracks } from "./recalculateTracks";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids, projectId } = req.body as { ids: number[]; projectId: number };
    const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id)))];
    if (!uniqueIds.length) return res.status(400).send(error("请先选择分镜"));

    try {
      const result = await db.transaction(async (trx: any) => {
        const storyboards = await trx("o_storyboard").where({ projectId }).whereIn("id", uniqueIds).select("id", "scriptId", "flowId");
        if (!storyboards.length) throw new Error("当前选择分镜不存在");

        const storyboardIds = storyboards.map((item: { id: number }) => item.id);
        const scriptIds = storyboards.map((item: { scriptId?: number }) => Number(item.scriptId)).filter((id: number) => Number.isFinite(id));
        const flowIds = storyboards.map((item: { flowId?: number | null }) => item.flowId).filter((id: number | null | undefined): id is number => Number.isFinite(id));

        if (flowIds.length) await trx("o_imageFlow").whereIn("id", flowIds).delete();
        await trx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
        await trx("o_storyboard").whereIn("id", storyboardIds).delete();
        await recalculateStoryboardTracks(trx, projectId, scriptIds);

        return { message: "删除分镜成功", total: storyboardIds.length };
      });

      res.status(200).send(success(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除分镜失败";
      res.status(400).send(error(message));
    }
  },
);
