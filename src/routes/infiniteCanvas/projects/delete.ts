import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { requireInfiniteCanvasProject } from "@/lib/infiniteCanvas/service";
import { deleteProjectById } from "@/routes/project/delProject";

export default createInfiniteCanvasRoute(async (req) => {
  const projectId = requiredId(req.body.projectId, "项目 ID");
  const project = await requireInfiniteCanvasProject(projectId);
  if (String(req.body.confirmationName || "").trim() !== String(project.name || "").trim()) throw new Error("请输入完整画布名称以确认删除");
  await deleteProjectById(projectId);
  return { deleted: projectId };
});
