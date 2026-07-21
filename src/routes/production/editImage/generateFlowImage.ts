import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { registerInfiniteCanvasArtifact, requireInfiniteCanvasArtifactInputs, updateInfiniteCanvasArtifact } from "@/lib/infiniteCanvas/service";
import axios from "axios";
const router = express.Router();

async function urlToBase64(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("/oss/")) {
    return await u.oss.getImageBase64(u.replaceUrl(imageUrl).replace("/smallImage", ""));
  }
  imageUrl = await u.oss.getFileUrl(u.replaceUrl(imageUrl));
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const contentType = response.headers["content-type"] || "image/png";
  const base64 = Buffer.from(response.data, "binary").toString("base64");
  return `data:${contentType};base64,${base64}`;
}
export default router.post(
  "/",
  validateFields({
    model: z.string(),
    references: z.array(z.string()).optional(),
    quality: z.string(),
    ratio: z.string(),
    prompt: z.string(),
    projectId: z.number(),
    canvasContext: z.object({
      nodeId: z.string(),
      inputSignature: z.string().optional(),
      inputArtifactIds: z.array(z.number()).optional(),
    }).optional(),
  }),
  async (req, res) => {
    const { model, references = [], quality, ratio, prompt, projectId, canvasContext } = req.body;
    let canvasArtifact: any = null;
    try {
      const canvasInputs = canvasContext ? await requireInfiniteCanvasArtifactInputs(projectId, canvasContext.inputArtifactIds || [], "image") : null;
      if (canvasContext) {
        canvasArtifact = await registerInfiniteCanvasArtifact({
          projectId,
          nodeId: canvasContext.nodeId,
          origin: "generated",
          mediaType: "image",
          state: "generating",
          prompt,
          model,
          params: { quality, ratio },
          inputSignature: canvasContext.inputSignature || "",
          inputArtifactIds: canvasContext.inputArtifactIds || [],
        });
      }
      const imageClass = await u.Ai.Image(model).run(
        {
          prompt: prompt,
          referenceList: await (async () => {
            const list: { type: "image"; base64: string }[] = [];
            if (canvasInputs) {
              for (const artifact of canvasInputs) list.push({ type: "image", base64: await u.oss.getMediaBase64(artifact.filePath) });
            } else {
              for (const url of references) list.push({ type: "image", base64: await urlToBase64(url) });
            }
            return list;
          })(),
          size: quality,
          aspectRatio: ratio,
        },
        {
          taskClass: "工作流图片生成",
          describe: "工作流图片生成",
          relatedObjects: JSON.stringify(req.body),
          projectId: projectId,
        },
      );
      const savePath = `${projectId}/workFlow/${u.uuid()}.jpg`;
      await imageClass.save(savePath);

      const url = await u.oss.getSmallImageUrl(savePath);
      if (canvasArtifact) canvasArtifact = await updateInfiniteCanvasArtifact(canvasArtifact.id, { state: "success", filePath: savePath });
      return res.status(200).send(success(canvasContext ? { url, filePath: savePath, artifact: canvasArtifact } : { url }));
    } catch (e) {
      if (canvasArtifact?.id) await updateInfiniteCanvasArtifact(canvasArtifact.id, { state: "failed", errorReason: u.error(e).message });
      res.status(400).send(error(u.error(e).message));
    }
  },
);
