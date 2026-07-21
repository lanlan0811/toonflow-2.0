import { createInfiniteCanvasRoute } from "@/lib/infiniteCanvas/http";
import { listInfiniteCanvasProjects } from "@/lib/infiniteCanvas/service";
export default createInfiniteCanvasRoute(async () => listInfiniteCanvasProjects());
