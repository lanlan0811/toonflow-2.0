import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ReferenceList } from "@/utils/ai";
const router = express.Router();

type Type = "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";
interface UploadItem {
  fileType: "image" | "video" | "audio";
  type: Type;
  sources?: "assets" | "storyboard";
  id?: number;
  src?: string;
  label?: string;
  prompt?: string;
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackData: z.array(
      z.object({
        uploadData: z.array(
          z.object({
            id: z.number(),
            sources: z.string(),
          }),
        ),
        trackId: z.number(),
        prompt: z.string(),
        duration: z.number(),
      }),
    ),
    model: z.string(),
    mode: z.string(),
    resolution: z.string(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    const { scriptId, projectId, trackData, model, resolution, audio, mode } = req.body;

    let modeData = [];
    if (Array.isArray(mode)) {
    } else if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
      try {
        modeData = JSON.parse(mode);
      } catch (e) {}
    }

    // 获取生成视频比例
    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();

    // 先为每条轨道创建视频记录，确保后续任何预处理错误都有可更新的任务状态。
    const tasks = await Promise.all(
      (trackData as { uploadData: { id: number; sources: string }[]; trackId: number; prompt: string; duration: number }[]).map(async (track) => {
        const videoPath = `/${projectId}/video/${uuidv4()}.mp4`;
        const [videoId] = await u.db("o_video").insert({
          filePath: videoPath,
          time: Date.now(),
          state: "生成中",
          scriptId,
          projectId,
          videoTrackId: track.trackId,
        });
        return { ...track, videoId, videoPath };
      }),
    );

    res.status(200).send(success(tasks.map((task) => ({ videoId: task.videoId, trackId: task.trackId }))));

    const generateSingleVideo = async (task: (typeof tasks)[number]) => {
      const { videoId, videoPath, prompt, duration, uploadData } = task;
      try {
        const images = await Promise.all(
          uploadData.map(async (item) => {
            if (item.sources === "storyboard") {
              const storyboard = await u.db("o_storyboard").where({ id: item.id, projectId, scriptId }).select("filePath").first();
              if (!storyboard?.filePath) throw new Error(`分镜 ${item.id} 没有可用图片`);
              return { path: storyboard.filePath, sources: "storyBoard" };
            }
            if (item.sources === "assets") {
              const asset = await u
                .db("o_assets")
                .where({ "o_assets.id": item.id, "o_assets.projectId": projectId })
                .leftJoin("o_image", "o_assets.imageId", "o_image.id")
                .select("o_image.filePath", "o_image.type")
                .first();
              if (!asset?.filePath) throw new Error(`资产 ${item.id} 没有可用图片`);
              return { path: asset.filePath, sources: asset.type };
            }
            throw new Error(`不支持的参考资源类型：${item.sources}`);
          }),
        );
        const references = await Promise.all(
          images.map(async (item) => ({
            base64: await u.oss.getImageBase64(item.path),
            type: item.sources === "audio" ? "audio" : "image",
          })),
        );
        const relatedObjects = { projectId, videoId, scriptId, type: "视频" };
        const aiVideo = u.Ai.Video(model);
        await aiVideo.run(
          {
            prompt,
            referenceList: references as ReferenceList[],
            mode: modeData.length > 0 ? modeData : mode,
            duration,
            aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
            resolution,
            audio,
          },
          {
            projectId,
            taskClass: "视频生成",
            describe: "根据提示词生成视频",
            relatedObjects: JSON.stringify(relatedObjects),
          },
        );
        await aiVideo.save(videoPath);
        await u.db("o_video").where("id", videoId).update({ state: "生成成功", errorReason: null });
      } catch (taskError) {
        const errorReason = u.error(taskError).message;
        try {
          await u.db("o_video").where("id", videoId).update({ state: "生成失败", errorReason });
        } catch (updateError) {
          console.error(`视频任务 ${videoId} 失败状态写入失败`, updateError);
        }
      }
    };

    // 后台并发执行，并显式兜底整个 Promise 链，避免未处理拒绝。
    void Promise.all(tasks.map(generateSingleVideo)).catch((taskError) => {
      console.error("批量视频后台任务执行失败", taskError);
    });
  },
);
