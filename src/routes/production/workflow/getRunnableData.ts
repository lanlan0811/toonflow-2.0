import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

const runnableAssetTypes = ["role", "scene", "tool"];

type AssetRunnableRow = {
  id?: number;
  name?: string | null;
  describe?: string | null;
  prompt?: string | null;
  type?: string | null;
  assetsId?: number | null;
  promptState?: string | null;
  promptErrorReason?: string | null;
  imageState?: string | null;
  imageErrorReason?: string | null;
  filePath?: string | null;
};

function getImageStatus(state?: string | null) {
  if (state === "已完成" || state === "生成成功") return "success";
  if (state === "生成中") return "generating";
  if (state === "生成失败") return "failed";
  return "idle";
}

function getPromptStatus(state?: string | null, prompt?: string | null) {
  if (state === "已完成" || prompt) return "success";
  if (state === "生成中") return "generating";
  if (state === "生成失败" || state === "失败") return "failed";
  return "idle";
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
  }),
  async (req, res) => {
    const { projectId, scriptId } = req.body;
    const project = await u.db("o_project").where("id", projectId).select("id", "imageModel", "imageQuality", "videoModel", "mode").first();
    const scriptsQuery = u.db("o_script").where("projectId", projectId);
    if (scriptId) scriptsQuery.where("id", scriptId);
    const scripts = await scriptsQuery.select("id", "name", "extractState", "errorReason");
    const scriptIds = scriptId ? [scriptId] : scripts.map((item) => item.id!).filter(Boolean);

    const assets = (await u
      .db("o_assets")
      .leftJoin("o_image", "o_assets.imageId", "o_image.id")
      .where("o_assets.projectId", projectId)
      .modify((qb) => {
        if (scriptIds.length) qb.where((builder) => builder.whereIn("o_assets.scriptId", scriptIds).orWhereNull("o_assets.scriptId"));
      })
      .whereIn("o_assets.type", runnableAssetTypes)
      .select(
        "o_assets.id",
        "o_assets.name",
        "o_assets.describe",
        "o_assets.prompt",
        "o_assets.type",
        "o_assets.assetsId",
        "o_assets.promptState",
        "o_assets.promptErrorReason",
        "o_image.state as imageState",
        "o_image.errorReason as imageErrorReason",
        "o_image.filePath",
      )) as AssetRunnableRow[];

    const originalAssets = assets.filter((item) => !item.assetsId);
    const derivedAssets = assets.filter((item) => item.assetsId);
    const mapAsset = (item: (typeof assets)[number]) => ({
      id: item.id,
      name: item.name,
      describe: item.describe,
      prompt: item.prompt,
      type: item.type,
      parentId: item.assetsId ?? null,
      promptState: getPromptStatus(item.promptState, item.prompt),
      promptErrorReason: item.promptErrorReason ?? null,
      imageState: getImageStatus(item.imageState),
      imageErrorReason: item.imageErrorReason ?? null,
      hasImage: !!item.filePath,
    });

    const storyboardQuery = u.db("o_storyboard").where("projectId", projectId);
    if (scriptId) storyboardQuery.where("scriptId", scriptId);
    const storyboards = await storyboardQuery.select("id", "scriptId", "prompt", "videoDesc", "duration", "track", "trackId", "state", "shouldGenerateImage", "filePath", "reason");
    const storyboardIds = storyboards.map((item) => item.id!).filter(Boolean);
    const assets2StoryboardRows = storyboardIds.length
      ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).orderBy("rowid").select("storyboardId", "assetId")
      : [];
    const storyboardAssetMap = assets2StoryboardRows.reduce<Record<number, number[]>>((result, item) => {
      if (!result[item.storyboardId!]) result[item.storyboardId!] = [];
      result[item.storyboardId!].push(item.assetId!);
      return result;
    }, {});

    const storyboardItems = storyboards.map((item) => ({
      id: item.id,
      scriptId: item.scriptId,
      prompt: item.prompt,
      videoDesc: item.videoDesc,
      duration: Number(item.duration ?? 0),
      track: item.track,
      trackId: item.trackId,
      shouldGenerateImage: item.shouldGenerateImage,
      imageState: getImageStatus(item.state),
      reason: item.reason ?? null,
      hasImage: !!item.filePath,
      associateAssetsIds: storyboardAssetMap[item.id!] ?? [],
    }));

    const trackQuery = u.db("o_videoTrack").where("projectId", projectId);
    if (scriptId) trackQuery.where("scriptId", scriptId);
    const tracks = await trackQuery.select("id", "scriptId", "prompt", "state", "reason", "duration");
    const trackIds = tracks.map((item) => item.id!).filter(Boolean);
    const videos = trackIds.length ? await u.db("o_video").whereIn("videoTrackId", trackIds).select("id", "state", "videoTrackId", "errorReason") : [];
    const videoMap = videos.reduce<Record<number, typeof videos>>((result, item) => {
      if (!result[item.videoTrackId!]) result[item.videoTrackId!] = [];
      result[item.videoTrackId!].push(item);
      return result;
    }, {});

    const trackItems = tracks.map((item) => ({
      id: item.id,
      scriptId: item.scriptId,
      duration: item.duration ?? 0,
      prompt: item.prompt ?? "",
      promptState: getPromptStatus(item.state, item.prompt),
      reason: item.reason ?? null,
      storyboardIds: storyboardItems.filter((storyboard) => storyboard.trackId === item.id).map((storyboard) => storyboard.id),
      videos: (videoMap[item.id!] ?? []).map((video) => ({
        id: video.id,
        state: getImageStatus(video.state),
        errorReason: video.errorReason ?? null,
      })),
    }));

    res.status(200).send(
      success({
        project,
        scripts,
        runnable: {
          extractOriginalAssets: scripts.filter((item) => item.extractState !== 0 && item.extractState !== 2).map((item) => item.id),
          polishOriginalAssetPrompts: originalAssets.filter((item) => getPromptStatus(item.promptState, item.prompt) !== "generating").map(mapAsset),
          generateOriginalAssetImages: originalAssets.filter((item) => item.prompt && getImageStatus(item.imageState) !== "generating").map(mapAsset),
          polishDerivedAssetPrompts: derivedAssets.filter((item) => getPromptStatus(item.promptState, item.prompt) !== "generating").map(mapAsset),
          generateDerivedAssetImages: derivedAssets.filter((item) => item.prompt && getImageStatus(item.imageState) !== "generating").map(mapAsset),
          generateStoryboardImages: storyboardItems.filter((item) => item.shouldGenerateImage !== 0 && item.imageState !== "generating"),
          generateVideoPrompts: trackItems.filter((item) => item.promptState !== "generating" && item.storyboardIds.length),
          generateVideos: trackItems.filter((item) => item.prompt && item.promptState === "success"),
        },
      }),
    );
  },
);
