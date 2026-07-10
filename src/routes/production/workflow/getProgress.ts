import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

type WorkflowState = "idle" | "ready" | "generating" | "success" | "failed" | "partial";
type ItemState = "pending" | "success" | "failed" | "generating";

type AssetProgressRow = {
  id?: number;
  assetsId?: number | null;
  type?: string | null;
  prompt?: string | null;
  promptState?: string | null;
  imageState?: string | null;
};

function getProgressState(total: number, pending: number, successCount: number, failed: number, generating: number): WorkflowState {
  if (!total) return "idle";
  if (generating) return "generating";
  if (failed && successCount) return "partial";
  if (failed) return "failed";
  if (successCount === total) return "success";
  if (pending) return "ready";
  return "idle";
}

function getImageState(state?: string | null): ItemState {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "生成中") return "generating";
  return "pending";
}

function getPromptState(state?: string | null, prompt?: string | null): ItemState {
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "已完成" || state === "生成成功" || !!prompt) return "success";
  return "pending";
}

function getExtractState(state?: number | null): ItemState {
  if (state === 1) return "success";
  if (state === -1) return "failed";
  if (state === 0 || state === 2) return "generating";
  return "pending";
}

function getVideoState(state?: string | null): ItemState {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "生成中") return "generating";
  return "pending";
}

function countByState<T>(list: T[], stateGetter: (item: T) => ItemState) {
  return list.reduce(
    (result, item) => {
      result[stateGetter(item)] += 1;
      return result;
    },
    { pending: 0, success: 0, failed: 0, generating: 0 },
  );
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body as { projectId: number; scriptId?: number | null };
    const project = await u.db("o_project").where("id", projectId).first();
    if (!project) return res.status(400).send(error("项目不存在"));

    const scriptQuery = u.db("o_script").where("projectId", projectId);
    if (scriptId) scriptQuery.where("id", scriptId);
    const scripts = await scriptQuery.select("id", "extractState", "errorReason");
    if (scriptId && !scripts.length) return res.status(400).send(error("剧本不存在或不属于当前项目"));

    const [novelTotalRow, novelPendingRow, eventSuccessRow, eventFailedRow] = await Promise.all([
      u.db("o_novel").where("projectId", projectId).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", 0).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", 1).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", -1).count("id as total").first(),
    ]);

    const assetQuery = u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .whereIn("o_assets.type", ["role", "scene", "tool"]);
    if (scriptId) {
      assetQuery
        .join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id")
        .where("o_scriptAssets.scriptId", scriptId);
    }
    const assets = (await assetQuery.distinct(
      "o_assets.id",
      "o_assets.assetsId",
      "o_assets.type",
      "o_assets.prompt",
      "o_assets.promptState",
      "o_image.state as imageState",
    )) as AssetProgressRow[];

    const originalAssets = assets.filter((item) => !item.assetsId);
    const derivedAssets = assets.filter((item) => !!item.assetsId);
    const originalPromptCounts = countByState(originalAssets, (item) => getPromptState(item.promptState, item.prompt));
    const derivedPromptCounts = countByState(derivedAssets, (item) => getPromptState(item.promptState, item.prompt));
    const originalImageCounts = countByState(originalAssets, (item) => getImageState(item.imageState));
    const derivedImageCounts = countByState(derivedAssets, (item) => getImageState(item.imageState));
    const scriptExtractCounts = countByState(scripts, (item) => getExtractState(item.extractState));
    const originalAssetState: WorkflowState = scriptExtractCounts.generating
      ? "generating"
      : scriptExtractCounts.failed && originalAssets.length
        ? "partial"
        : scriptExtractCounts.failed
          ? "failed"
          : originalAssets.length
            ? "success"
            : scripts.length
              ? "ready"
              : "idle";

    const storyboardQuery = u.db("o_storyboard").where("projectId", projectId);
    if (scriptId) storyboardQuery.where("scriptId", scriptId);
    const storyboards = await storyboardQuery.select("id", "state", "shouldGenerateImage");
    const imageStoryboards = storyboards.filter((item) => item.shouldGenerateImage !== 0);
    const storyboardImageCounts = countByState(imageStoryboards, (item) => getImageState(item.state));

    const trackQuery = u.db("o_videoTrack").where("projectId", projectId);
    if (scriptId) trackQuery.where("scriptId", scriptId);
    const tracks = await trackQuery.select("id", "state", "prompt", "selectVideoId");
    const trackIds = tracks.map((item) => item.id!).filter(Boolean);
    const videos = trackIds.length
      ? await u.db("o_video").whereIn("videoTrackId", trackIds).select("id", "state", "videoTrackId", "time")
      : [];
    const videoPromptCounts = countByState(tracks, (item) => getPromptState(item.state, item.prompt));
    const representativeVideos = tracks.map((track) => {
      const candidates = videos
        .filter((video) => video.videoTrackId === track.id)
        .sort((a, b) => Number(b.time ?? b.id ?? 0) - Number(a.time ?? a.id ?? 0));
      return candidates.find((video) => video.id === track.selectVideoId) ?? candidates.find((video) => getVideoState(video.state) === "success") ?? candidates[0];
    });
    const videoCounts = countByState(representativeVideos, (item) => getVideoState(item?.state));

    const novelTotal = Number((novelTotalRow as { total?: number })?.total ?? 0);
    const novelPending = Number((novelPendingRow as { total?: number })?.total ?? 0);
    const eventSuccess = Number((eventSuccessRow as { total?: number })?.total ?? 0);
    const eventFailed = Number((eventFailedRow as { total?: number })?.total ?? 0);

    const steps = {
      importContent: {
        state: scripts.length || novelTotal || storyboards.length ? "success" : "idle",
        total: scripts.length + novelTotal + storyboards.length,
        scripts: scripts.length,
        novels: novelTotal,
        storyboards: storyboards.length,
      },
      novelEvents: {
        state: getProgressState(novelTotal, novelPending, eventSuccess, eventFailed, 0),
        total: novelTotal,
        pending: novelPending,
        success: eventSuccess,
        failed: eventFailed,
      },
      originalAssets: {
        state: originalAssetState,
        total: originalAssets.length,
        sourceScripts: scripts.length,
        extract: scriptExtractCounts,
      },
      originalAssetPrompts: {
        state: getProgressState(originalAssets.length, originalPromptCounts.pending, originalPromptCounts.success, originalPromptCounts.failed, originalPromptCounts.generating),
        total: originalAssets.length,
        ...originalPromptCounts,
      },
      originalAssetImages: {
        state: getProgressState(originalAssets.length, originalImageCounts.pending, originalImageCounts.success, originalImageCounts.failed, originalImageCounts.generating),
        total: originalAssets.length,
        ...originalImageCounts,
      },
      derivedAssets: {
        state: derivedAssets.length ? "success" : originalAssets.length ? "ready" : "idle",
        total: derivedAssets.length,
      },
      derivedAssetPrompts: {
        state: getProgressState(derivedAssets.length, derivedPromptCounts.pending, derivedPromptCounts.success, derivedPromptCounts.failed, derivedPromptCounts.generating),
        total: derivedAssets.length,
        ...derivedPromptCounts,
      },
      derivedAssetImages: {
        state: getProgressState(derivedAssets.length, derivedImageCounts.pending, derivedImageCounts.success, derivedImageCounts.failed, derivedImageCounts.generating),
        total: derivedAssets.length,
        ...derivedImageCounts,
      },
      storyboardPanel: {
        state: storyboards.length ? "success" : scripts.length || derivedAssets.length ? "ready" : "idle",
        total: storyboards.length,
      },
      storyboardImages: {
        state: getProgressState(imageStoryboards.length, storyboardImageCounts.pending, storyboardImageCounts.success, storyboardImageCounts.failed, storyboardImageCounts.generating),
        total: imageStoryboards.length,
        skipped: storyboards.length - imageStoryboards.length,
        ...storyboardImageCounts,
      },
      videoPrompts: {
        state: getProgressState(tracks.length, videoPromptCounts.pending, videoPromptCounts.success, videoPromptCounts.failed, videoPromptCounts.generating),
        total: tracks.length,
        ...videoPromptCounts,
      },
      videos: {
        state: getProgressState(tracks.length, videoCounts.pending, videoCounts.success, videoCounts.failed, videoCounts.generating),
        total: tracks.length,
        attempts: videos.length,
        ...videoCounts,
      },
    };

    return res.status(200).send(
      success({
        project: {
          id: project.id,
          name: project.name,
          projectType: project.projectType,
        },
        scriptId: scriptId ?? null,
        steps,
      }),
    );
  },
);
