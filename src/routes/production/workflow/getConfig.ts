import express from "express";
import { success } from "@/lib/responseFormat";
import { projectTypeLabels } from "@/constants/project";
import { workflowStepConfigs } from "@/constants/workflow";

const router = express.Router();

export default router.post("/", async (_, res) => {
  res.status(200).send(
    success({
      projectTypes: Object.entries(projectTypeLabels).map(([value, label]) => ({ value, label })),
      steps: workflowStepConfigs.sort((a, b) => a.order - b.order),
      stateLabels: {
        idle: "未开始",
        ready: "可执行",
        generating: "生成中",
        success: "已完成",
        failed: "失败",
        partial: "部分完成",
      },
    }),
  );
});
