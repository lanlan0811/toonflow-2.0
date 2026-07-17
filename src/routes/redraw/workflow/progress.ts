import express from "express";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { getLatestStepRuns, redrawDb, requireRedrawProject } from "@/lib/redrawCommon";
import u from "@/utils";

const router = express.Router();
export default router.post("/", validateFields({ projectId: z.number().int().positive() }), async (req, res) => {
  try {
    await requireRedrawProject(req.body.projectId);
    const steps = await getLatestStepRuns(req.body.projectId);
    const running = steps.find((item) => item.run?.state === "running") ?? null;
    const segments = await redrawDb("o_redrawSegment").where("projectId", req.body.projectId).select("state");
    const segmentSummary = segments.reduce((summary: Record<string, number>, row: any) => {
      summary[row.state] = (summary[row.state] ?? 0) + 1;
      return summary;
    }, {});
    res.status(200).send(success({ steps, running, segmentSummary }));
  } catch (cause) {
    res.status(400).send(error(u.error(cause).message));
  }
});
