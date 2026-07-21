import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { updateInfiniteCanvasGraph } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => updateInfiniteCanvasGraph(requiredId(req.body.projectId, "项目 ID"), req.body.graph, Number(req.body.baseRevision)));
