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
    items: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        model: z.string(),
        modelName: z.string(),
        vendorId: z.string().nullable(),
        desc: z.string(),
        temperature: z.number().optional(),
        maxOutputTokens: z.number().optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { items } = req.body;
    const ids = items.map((item: any) => item.id);
    const currentItems = await u.db("o_agentDeploy").whereIn("id", ids).select("id", "key");
    try {
      for (const item of items) {
        const current = currentItems.find((value) => value.id === item.id);
        if (current?.key?.startsWith("redrawAgent") && item.modelName) {
          await assertRedrawAgentModel(current.key, item.modelName);
        }
      }
    } catch (cause) {
      return res.status(400).send(error(cause instanceof Error ? cause.message : "模型能力不兼容"));
    }
    for (const item of items) {
      const { id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens } = item;
      await u.db("o_agentDeploy").where({ id }).update({ id, name, model, modelName, vendorId, desc, temperature, maxOutputTokens });
    }
    res.status(200).send(success("批量配置成功"));
  },
);
