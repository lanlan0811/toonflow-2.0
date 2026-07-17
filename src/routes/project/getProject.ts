import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { ProjectTypes } from "@/constants/project";
const router = express.Router();

// 获取项目
export default router.post("/", async (req, res) => {
  let query = u.db("o_project");
  if (req.body?.includeCommerce !== true) query = query.whereNot("projectType", ProjectTypes.commerce);
  const data = await query.select("*");
  res.status(200).send(success(data));
});
