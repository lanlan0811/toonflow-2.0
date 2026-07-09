import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

import { workflowStepSchema, WorkflowStep, getWorkflowStepTargetApi } from "@/constants/workflow";

const router = express.Router();

type AssetRow = {
  id?: number;
  name?: string | null;
  describe?: string | null;
  prompt?: string | null;
  type?: string | null;
  assetsId?: number | null;
  promptState?: string | null;
  imageState?: string | null;
  filePath?: string | null;
};

type StoryboardRow = {
  id?: number;
  scriptId?: number | null;
  prompt?: string | null;
  videoDesc?: string | null;
  duration?: string | null;
  trackId?: number | null;
  state?: string | null;
  shouldGenerateImage?: number | null;
  filePath?: string | null;
};

type TrackRow = {
  id?: number;
  scriptId?: number | null;
  prompt?: string | null;
  state?: string | null;
  duration?: number | null;
};

const assetTypes = ["role", "scene", "tool"];

function imageReady(state?: string | null) {
  return state === "已完成" || state === "生成成功";
}

function imageGenerating(state?: string | null) {
  return state === "生成中";
}

function promptGenerating(state?: string | null) {
  return state === "生成中";
}

async function getProject(projectId: number) {
  return await u.db("o_project").where("id", projectId).select("id", "imageModel", "imageQuality", "videoModel", "mode").first();
}

async function getScripts(projectId: number, scriptId?: number | null) {
  const query = u.db("o_script").where("projectId", projectId);
  if (scriptId) query.where("id", scriptId);
  return await query.select("id", "name", "extractState");
}

async function getAssets(projectId: number, scriptIds: number[]) {
  return (await u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .modify((qb) => {
      if (scriptIds.length) qb.where((builder) => builder.whereIn("o_assets.scriptId", scriptIds).orWhereNull("o_assets.scriptId"));
    })
    .whereIn("o_assets.type", assetTypes)
    .select(
      "o_assets.id",
      "o_assets.name",
      "o_assets.describe",
      "o_assets.prompt",
      "o_assets.type",
      "o_assets.assetsId",
      "o_assets.promptState",
      "o_image.state as imageState",
      "o_image.filePath",
    )) as AssetRow[];
}

async function getStoryboards(projectId: number, scriptId?: number | null) {
  const query = u.db("o_storyboard").where("projectId", projectId);
  if (scriptId) query.where("scriptId", scriptId);
  return (await query.select("id", "scriptId", "prompt", "videoDesc", "duration", "trackId", "state", "shouldGenerateImage", "filePath")) as StoryboardRow[];
}

async function getTracks(projectId: number, scriptId?: number | null) {
  const query = u.db("o_videoTrack").where("projectId", projectId);
  if (scriptId) query.where("scriptId", scriptId);
  return (await query.select("id", "scriptId", "prompt", "state", "duration")) as TrackRow[];
}

async function getStoryboardInfoByTrack(storyboards: StoryboardRow[]) {
  return storyboards.reduce<Record<number, { id: number; sources: "storyboard" }[]>>((result, storyboard) => {
    if (!storyboard.id || !storyboard.trackId) return result;
    if (!result[storyboard.trackId]) result[storyboard.trackId] = [];
    result[storyboard.trackId].push({ id: storyboard.id, sources: "storyboard" });
    return result;
  }, {});
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    step: workflowStepSchema,
    concurrentCount: z.number().int().min(1).optional(),
    groupSize: z.number().int().min(1).optional(),
    otherTextPrompt: z.string().optional(),
    compulsory: z.boolean().optional(),
    audio: z.boolean().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, step, concurrentCount = 5, groupSize = 5, otherTextPrompt = "", compulsory = false, audio = false } = req.body as {
      projectId: number;
      scriptId?: number | null;
      step: WorkflowStep;
      concurrentCount?: number;
      groupSize?: number;
      otherTextPrompt?: string;
      compulsory?: boolean;
      audio?: boolean;
    };

    const project = await getProject(projectId);
    if (!project) return res.status(400).send(error("项目不存在"));

    const scripts = await getScripts(projectId, scriptId);
    const scriptIds = scriptId ? [scriptId] : scripts.map((item) => item.id!).filter(Boolean);
    const targetApi = getWorkflowStepTargetApi(step);

    if (step === "extractOriginalAssets") {
      const runnableScriptIds = scripts.filter((item) => item.extractState !== 0 && item.extractState !== 2).map((item) => item.id).filter(Boolean);
      return res.status(200).send(success({ step, targetApi, requestBody: { scriptIds: runnableScriptIds, projectId, groupSize }, total: runnableScriptIds.length }));
    }

    const assets = await getAssets(projectId, scriptIds);
    const originalAssets = assets.filter((item) => !item.assetsId);
    const derivedAssets = assets.filter((item) => item.assetsId);

    if (step === "polishOriginalAssetPrompts" || step === "polishDerivedAssetPrompts") {
      const list = step === "polishOriginalAssetPrompts" ? originalAssets : derivedAssets;
      const items = list
        .filter((item) => !promptGenerating(item.promptState))
        .map((item) => ({ assetsId: item.id, type: item.type, name: item.name ?? "", describe: item.describe ?? "" }));
      return res.status(200).send(success({ step, targetApi, requestBody: { items, projectId, concurrentCount, otherTextPrompt }, total: items.length }));
    }

    if (step === "generateOriginalAssetImages") {
      const items = originalAssets
        .filter((item) => item.prompt && !imageGenerating(item.imageState))
        .map((item) => ({ id: item.id, type: item.type, name: item.name ?? "", prompt: item.prompt ?? "", base64: null }));
      return res.status(200).send(
        success({
          step,
          targetApi,
          requestBody: {
            projectId,
            model: project.imageModel,
            resolution: project.imageQuality,
            concurrentCount,
            items,
          },
          total: items.length,
        }),
      );
    }

    if (step === "generateDerivedAssetImages") {
      if (!scriptId) return res.status(400).send(error("生成衍生资产图需要指定 scriptId"));
      const assetIds = derivedAssets.filter((item) => item.prompt && !imageGenerating(item.imageState)).map((item) => item.id).filter(Boolean);
      return res.status(200).send(success({ step, targetApi, requestBody: { assetIds, projectId, scriptId, concurrentCount }, total: assetIds.length }));
    }

    const storyboards = await getStoryboards(projectId, scriptId);

    if (step === "generateStoryboardImages") {
      if (!scriptId && storyboards.some((item) => item.scriptId !== storyboards[0]?.scriptId)) return res.status(400).send(error("跨剧本生成分镜图需要指定 scriptId"));
      const realScriptId = scriptId ?? storyboards[0]?.scriptId;
      if (!realScriptId) return res.status(400).send(error("未找到可生成分镜图的剧本"));
      const storyboardIds = storyboards.filter((item) => item.shouldGenerateImage !== 0 && !imageGenerating(item.state)).map((item) => item.id).filter(Boolean);
      return res.status(200).send(success({ step, targetApi, requestBody: { storyboardIds, projectId, scriptId: realScriptId, concurrentCount, compulsory }, total: storyboardIds.length }));
    }

    const tracks = await getTracks(projectId, scriptId);
    const storyboardInfoByTrack = await getStoryboardInfoByTrack(storyboards);

    if (step === "generateVideoPrompts") {
      const trackData = tracks
        .filter((item) => !promptGenerating(item.state) && storyboardInfoByTrack[item.id!]?.length)
        .map((item) => ({ trackId: item.id, info: storyboardInfoByTrack[item.id!] }));
      return res.status(200).send(success({ step, targetApi, requestBody: { projectId, trackData, mode: project.mode ?? "", model: project.videoModel, concurrentCount }, total: trackData.length }));
    }

    if (step === "generateVideos") {
      if (!scriptId && tracks.some((item) => item.scriptId !== tracks[0]?.scriptId)) return res.status(400).send(error("跨剧本生成视频需要指定 scriptId"));
      const realScriptId = scriptId ?? tracks[0]?.scriptId;
      if (!realScriptId) return res.status(400).send(error("未找到可生成视频的剧本"));
      const trackData = tracks
        .filter((item) => item.prompt && storyboardInfoByTrack[item.id!]?.length)
        .map((item) => ({
          trackId: item.id,
          prompt: item.prompt ?? "",
          duration: item.duration ?? 5,
          uploadData: (storyboardInfoByTrack[item.id!] ?? []).filter((storyboard) => {
            const row = storyboards.find((item) => item.id === storyboard.id);
            return row?.filePath && imageReady(row.state);
          }),
        }))
        .filter((item) => item.uploadData.length);
      return res.status(200).send(
        success({
          step,
          targetApi,
          requestBody: {
            projectId,
            scriptId: realScriptId,
            trackData,
            model: project.videoModel,
            mode: project.mode ?? "",
            resolution: project.imageQuality,
            audio,
          },
          total: trackData.length,
        }),
      );
    }

    return res.status(400).send(error("不支持的流程步骤"));
  },
);
