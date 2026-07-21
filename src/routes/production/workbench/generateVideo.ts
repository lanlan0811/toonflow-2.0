import path from "node:path";
import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
import { registerInfiniteCanvasArtifact, requireInfiniteCanvasArtifactInputs, requireInfiniteCanvasNode, updateInfiniteCanvasArtifact } from "@/lib/infiniteCanvas/service";

const router = express.Router();

type MediaType = "image" | "video" | "audio";

function mediaTypeFrom(filePath: string, storedType?: string): MediaType {
  const normalized = String(storedType || "").toLowerCase();
  if (normalized === "video" || normalized === "clip") return "video";
  if (normalized === "audio") return "audio";
  const extension = path.extname(filePath || "").toLowerCase();
  if ([".mp4", ".webm"].includes(extension)) return "video";
  if ([".mp3", ".wav"].includes(extension)) return "audio";
  return "image";
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    uploadData: z.array(z.object({
      id: z.number().optional(),
      artifactId: z.number().optional(),
      sources: z.string(),
    })),
    prompt: z.string(),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    duration: z.number(),
    audio: z.boolean().optional(),
    trackId: z.number(),
    canvasContext: z.object({
      nodeId: z.string(),
      inputSignature: z.string().optional(),
      inputArtifactIds: z.array(z.number()).optional(),
    }).optional(),
  }),
  async (req, res) => {
    const { scriptId, projectId, prompt, uploadData, model, duration, resolution, audio, mode, trackId, canvasContext } = req.body;
    let modeData: string[] = [];
    if (typeof mode === "string" && mode.trim().startsWith("[")) {
      try { const parsed = JSON.parse(mode); if (Array.isArray(parsed)) modeData = parsed.map(String); } catch { /* route keeps the original mode */ }
    }

    const canvasInputIds = uploadData.filter((item: any) => item.sources === "canvas").map((item: any) => Number(item.artifactId));
    let canvasInputs: any[] = [];
    if (canvasInputIds.length && !canvasContext) throw new Error("画布素材请求缺少画布上下文");
    if (canvasContext) {
      if (canvasInputIds.length !== uploadData.length) throw new Error("画布生成不能混用其他项目素材来源");
      const declaredInputIds = (canvasContext.inputArtifactIds || []).map(Number);
      if (declaredInputIds.length && JSON.stringify(declaredInputIds) !== JSON.stringify(canvasInputIds)) throw new Error("画布输入素材与输入签名不一致");
      await requireInfiniteCanvasNode(projectId, canvasContext.nodeId, "video");
      const workspace = await u.db("o_infiniteCanvasWorkspace").where({ projectId, scriptId }).first();
      if (!workspace) throw new Error("画布脚本不属于当前项目");
      const track = await u.db("o_videoTrack").where({ id: trackId, projectId, scriptId }).first();
      if (!track) throw new Error("视频轨道不属于当前画布项目");
      canvasInputs = await requireInfiniteCanvasArtifactInputs(projectId, canvasInputIds);
    }

    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
    const videoPath = `${projectId}/video/${uuidv4()}.mp4`;
    let canvasInputIndex = 0;
    const media = await Promise.all(uploadData.map(async (item: any) => {
      if (item.sources === "canvas") {
        const artifact = canvasInputs[canvasInputIndex++];
        if (!artifact) throw new Error("画布素材 ID 无效");
        return { path: artifact.filePath as string, type: artifact.mediaType as MediaType };
      }
      if (!item.id) throw new Error("参考素材 ID 无效");
      if (item.sources === "storyboard") {
        const row = await u.db("o_storyboard").where({ id: item.id, projectId }).select("filePath").first();
        if (!row?.filePath) throw new Error("分镜参考图片不存在");
        return { path: row.filePath as string, type: "image" as const };
      }
      if (item.sources === "assets") {
        const row = await u.db("o_assets")
          .where("o_assets.id", item.id)
          .where("o_assets.projectId", projectId)
          .leftJoin("o_image", "o_assets.imageId", "o_image.id")
          .select("o_image.filePath", "o_image.type")
          .first();
        if (!row?.filePath) throw new Error("资产参考文件不存在");
        return { path: row.filePath as string, type: mediaTypeFrom(row.filePath, row.type) };
      }
      throw new Error("不支持的参考素材来源");
    }));
    const referenceList = await Promise.all(media.map(async (item) => ({ type: item.type, base64: await u.oss.getMediaBase64(item.path) } as ReferenceList)));

    const [videoId] = await u.db("o_video").insert({ filePath: videoPath, time: Date.now(), state: "生成中", scriptId, projectId, videoTrackId: trackId });
    let canvasArtifact: any = null;
    try {
      if (canvasContext) {
        canvasArtifact = await registerInfiniteCanvasArtifact({
          projectId,
          nodeId: canvasContext.nodeId,
          origin: "generated",
          mediaType: "video",
          state: "generating",
          filePath: videoPath,
          videoId: Number(videoId),
          prompt,
          model,
          params: { mode: modeData.length ? modeData : mode, resolution, duration, audio: Boolean(audio), aspectRatio: ratio?.videoRatio || "16:9" },
          inputSignature: canvasContext.inputSignature || "",
          inputArtifactIds: canvasInputIds,
        });
      }
    } catch (error) {
      await u.db("o_video").where("id", videoId).delete();
      throw error;
    }

    res.status(200).send(success(canvasContext ? { videoId: Number(videoId), artifact: canvasArtifact } : Number(videoId)));
    const relatedObjects = { projectId, videoId, scriptId, type: "视频", ...(canvasArtifact ? { infiniteCanvasArtifactId: canvasArtifact.id } : {}) };
    const aiVideo = u.Ai.Video(model);
    aiVideo
      .run(
        {
          prompt,
          referenceList,
          mode: modeData.length > 0 ? modeData : mode,
          duration,
          aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
          resolution,
          audio,
        },
        { projectId, taskClass: "视频生成", describe: "根据提示词生成视频", relatedObjects: JSON.stringify(relatedObjects) },
      )
      .then(async () => await aiVideo.save(videoPath))
      .then(async () => {
        await u.db("o_video").where("id", videoId).update({ state: "生成成功" });
        if (canvasArtifact?.id) await updateInfiniteCanvasArtifact(canvasArtifact.id, { state: "success", filePath: videoPath });
      })
      .catch(async (caught: any) => {
        const reason = u.error(caught).message;
        await u.db("o_video").where("id", videoId).update({ state: "生成失败", errorReason: reason });
        if (canvasArtifact?.id) await updateInfiniteCanvasArtifact(canvasArtifact.id, { state: "failed", errorReason: reason });
      });
  },
);
