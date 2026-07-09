import express from "express";
import axios from "axios";
import { z } from "zod";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { workflowStepSchema } from "@/constants/workflow";

const router = express.Router();

type PreparedStep = {
  step: string;
  targetApi: string;
  requestBody: Record<string, unknown>;
  total: number;
};

function getBaseUrl(req: express.Request) {
  return `${req.protocol}://${req.get("host")}`;
}

function getAuthHeaders(req: express.Request) {
  return req.headers.authorization ? { authorization: req.headers.authorization } : undefined;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    step: workflowStepSchema,
    concurrentCount: z.number().int().min(1).optional(),
    groupSize: z.number().int().min(1).optional(),
    otherTextPrompt: z.string().optional(),
    compulsory: z.boolean().optional(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    try {
      const baseUrl = getBaseUrl(req);
      const headers = getAuthHeaders(req);
      const prepareRes = await axios.post(`${baseUrl}/api/production/workflow/prepareStepRequest`, req.body, { headers });
      const prepared = prepareRes.data?.data as PreparedStep | undefined;
      if (!prepared) return res.status(400).send(error("流程步骤请求体准备失败"));
      if (!prepared.total) {
        return res.status(200).send(
          success({
            status: "skipped",
            reason: "没有可执行对象",
            prepared,
          }),
        );
      }

      const runRes = await axios.post(`${baseUrl}${prepared.targetApi}`, prepared.requestBody, { headers });
      return res.status(200).send(
        success({
          status: "started",
          prepared,
          result: runRes.data,
        }),
      );
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
  },
);
