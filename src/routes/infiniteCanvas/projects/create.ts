import { createInfiniteCanvasRoute } from "@/lib/infiniteCanvas/http";
import { createInfiniteCanvasProject } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async (req) => createInfiniteCanvasProject(req.body || {}));
