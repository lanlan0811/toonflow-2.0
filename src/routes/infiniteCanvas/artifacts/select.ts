import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { selectInfiniteCanvasArtifact } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => selectInfiniteCanvasArtifact(requiredId(req.body.projectId, "项目 ID"), requiredId(req.body.artifactId, "产物 ID")));
