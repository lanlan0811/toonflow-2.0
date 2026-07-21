import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { listInfiniteCanvasArtifacts } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => listInfiniteCanvasArtifacts(requiredId(req.body.projectId, "项目 ID"), req.body.nodeId ? String(req.body.nodeId) : undefined));
