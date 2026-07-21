import { createInfiniteCanvasRoute, requiredId } from "@/lib/infiniteCanvas/http";
import { uploadInfiniteCanvasMaterial } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => uploadInfiniteCanvasMaterial({ projectId: requiredId(req.body.projectId, "项目 ID"), nodeId: String(req.body.nodeId || ""), fileName: String(req.body.fileName || ""), dataBase64: String(req.body.dataBase64 || "") }));
