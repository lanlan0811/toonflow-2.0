import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { getInfiniteCanvasWorkspace } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => getInfiniteCanvasWorkspace(requiredId(req.body.projectId, "项目 ID")));
