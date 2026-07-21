import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { updateInfiniteCanvasProject } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => updateInfiniteCanvasProject(requiredId(req.body.projectId, "项目 ID"), req.body || {}));
