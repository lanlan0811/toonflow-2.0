import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

type WorkflowState = "idle" | "ready" | "generating" | "success" | "failed" | "partial";

type AssetProgressRow = {
  id?: number;
  assetsId?: number | null;
  type?: string | null;
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

function getImageState(state?: string | null): "pending" | "success" | "failed" | "generating" {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成失败" || state === "失败") return "failed";
  if (state === "生成中") return "generating";
  return "pending";
}

function getExtractState(state?: number | null): "pending" | "success" | "failed" | "generating" {
  if (state === 1) return "success";
  if (state === -1) return "failed";
  if (state === 0 || state === 2) return "generating";
  return "pending";
}

function getVideoState(state?: string | null): "pending" | "success" | "failed" | "generating" {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成失败") return "failed";
  if (state === "生成中") return "generating";
  return "pending";
}

function countByState<T>(list: T[], stateGetter: (item: T) => "pending" | "success" | "failed" | "generating") {
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
    const { projectId, scriptId } = req.body;
    const project = await u.db("o_project").where("id", projectId).first();
    const scriptQuery = u.db("o_script").where("projectId", projectId);
    if (scriptId) scriptQuery.where("id", scriptId);
    const scripts = await scriptQuery.select("id", "extractState", "errorReason");
    const scriptIds = scriptId ? [scriptId] : scripts.map((item) => item.id!).filter(Boolean);

    const [novelTotalRow, novelPendingRow, eventSuccessRow, eventFailedRow] = await Promise.all([
      u.db("o_novel").where("projectId", projectId).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", 0).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", 1).count("id as total").first(),
      u.db("o_novel").where("projectId", projectId).where("eventState", -1).count("id as total").first(),
    ]);

    const assets = (await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .modify((qb) => {
        if (scriptIds.length) qb.where((builder) => builder.whereIn("o_assets.scriptId", scriptIds).orWhereNull("o_assets.scriptId"));
      })
      .select("o_assets.id", "o_assets.assetsId", "o_assets.type", "o_image.state as imageState")) as AssetProgressRow[];

    const originalAssets = assets.filter((item) => !item.assetsId && ["role", "scene", "tool"].includes(item.type ?? ""));
    const derivedAssets = assets.filter((item) => item.assetsId && ["role", "scene", "tool"].includes(item.type ?? ""));
    const originalImageCounts = countByState(originalAssets, (item) => getImageState(item.imageState));
    const derivedImageCounts = countByState(derivedAssets, (item) => getImageState(item.imageState));
    const scriptExtractCounts = countByState(scripts, (item) => getExtractState(item.extractState));

    const storyboardQuery = u.db("o_storyboard").where("projectId", projectId);
    if (scriptId) storyboardQuery.where("scriptId", scriptId);
    const storyboards = await storyboardQuery.select("id", "state", "shouldGenerateImage");
    const storyboardImageCounts = countByState(storyboards, (item) => getImageState(item.state));

    const trackQuery = u.db("o_videoTrack").where("projectId", projectId);
    if (scriptId) trackQuery.where("scriptId", scriptId);
    const tracks = await trackQuery.select("id", "state", "prompt");
    const trackIds = tracks.map((item) => item.id!).filter(Boolean);
    const videos = trackIds.length ? await u.db("o_video").whereIn("videoTrackId", trackIds).select("id", "state", "videoTrackId") : [];
    const videoPromptCounts = countByState(tracks, (item) => getImageState(item.state));
    const videoCounts = countByState(videos, (item) => getVideoState(item.state));

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
        state: getProgressState(scripts.length, scriptExtractCounts.pending, originalAssets.length, scriptExtractCounts.failed, scriptExtractCounts.generating),
        total: originalAssets.length,
        sourceScripts: scripts.length,
        extract: scriptExtractCounts,
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
        state: getProgressState(storyboards.length, storyboardImageCounts.pending, storyboardImageCounts.success, storyboardImageCounts.failed, storyboardImageCounts.generating),
        total: storyboards.length,
        ...storyboardImageCounts,
      },
      videoPrompts: {
        state: getProgressState(tracks.length, videoPromptCounts.pending, videoPromptCounts.success, videoPromptCounts.failed, videoPromptCounts.generating),
        total: tracks.length,
        ...videoPromptCounts,
      },
      videos: {
        state: getProgressState(tracks.length, tracks.length && !videos.length ? tracks.length : videoCounts.pending, videoCounts.success, videoCounts.failed, videoCounts.generating),
        total: videos.length,
        tracks: tracks.length,
        ...videoCounts,
      },
    };

    res.status(200).send(
      success({
        project: project
          ? {
              id: project.id,
              name: project.name,
              projectType: project.projectType,
            }
          : null,
        scriptId: scriptId ?? null,
        steps,
      }),
    );
  },
);
