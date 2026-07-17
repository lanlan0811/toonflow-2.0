import express from "express";
import { error, success } from "@/lib/responseFormat";
import { assertRedrawAgentModel } from "@/lib/redrawModel";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string(),
    model: z.string(),
    modelName: z.string(),
    vendorId: z.string().nullable(),
    desc: z.string(),
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
  }),
  async (req, res) => {
    const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = req.body;
    const current = await u.db("o_agentDeploy").where({ id }).first();
    if (!current) return res.status(404).send(error("Agent 配置不存在"));
    if (current.key?.startsWith("redrawAgent") && modelName) {
      try {
        await assertRedrawAgentModel(current.key, modelName);
      } catch (cause) {
        return res.status(400).send(error(cause instanceof Error ? cause.message : "模型能力不兼容"));
      }
    }
    await u.db("o_agentDeploy").where({ id }).update({ id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
    res.status(200).send(success("配置成功"));
  },
);
