import express from "express";
import { z } from "zod";
import { redrawStepSchema } from "@/constants/redraw";
import { validateFields } from "@/middleware/middleware";
import { error, success } from "@/lib/responseFormat";
import { confirmRedrawStep, startRedrawStep } from "@/lib/redrawWorkflow";
import u from "@/utils";

const router = express.Router();
export default router.post(
  "/",
  validateFields({
    projectId: z.number().int().positive(),
    step: redrawStepSchema,
    action: z.enum(["run", "complete"]).default("run"),
    retryFailed: z.boolean().optional(),
    compulsory: z.boolean().optional(),
    confirmCost: z.boolean().optional(),
  }),
  async (req, res) => {
    try {
      const result = req.body.action === "complete"
        ? await confirmRedrawStep(req.body.projectId, req.body.step)
        : await startRedrawStep(req.body.projectId, req.body.step, { retryFailed: req.body.retryFailed, compulsory: req.body.compulsory, confirmCost: req.body.confirmCost });
      res.status(200).send(success(result));
    } catch (cause: any) {
      const status = cause?.status === 409 ? 409 : 400;
      res.status(status).send(error(u.error(cause).message, null, status));
    }
  },
);
