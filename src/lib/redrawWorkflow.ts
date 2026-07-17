import fs from "node:fs/promises";
import crypto from "node:crypto";
import { jsonSchema, tool } from "ai";
import { z } from "zod";
import type { RedrawAgentKey, RedrawStep } from "@/constants/redraw";
import { redrawTargetStyleSchema } from "@/constants/redraw";
import {
  assertStepConfirmed,
  createRedrawId,
  invalidateRedrawAfter,
  parseJson,
  redrawDb,
  requireRedrawProject,
  stableHash,
  validateShotTimeline,
} from "@/lib/redrawCommon";
import {
  assembleRedrawVideo,
  burnSrtSubtitles,
  buildSrt,
  createAnalysisProxy,
  detectShotCandidates,
  extractKeyframe,
  extractSegment,
  planInternalSegments,
  probeSourceVideo,
} from "@/lib/redrawMedia";
import { assertRedrawProjectModels, assertResolvedRedrawAgentModel, getConfiguredModel, hasReferenceMode } from "@/lib/redrawModel";
import u from "@/utils";
import type { ReferenceList } from "@/utils/ai";

type RunOptions = { retryFailed?: boolean; compulsory?: boolean; confirmCost?: boolean };

async function runToolAgent<T>(options: {
  agent: RedrawAgentKey;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  files?: { path: string; mediaType: string }[];
}): Promise<T> {
  await assertResolvedRedrawAgentModel(options.agent);
  let collected: T | null = null;
  const resultTool: any = (tool as any)({
    description: "保存当前转绘步骤的结构化结果；完成任务时必须调用一次。",
    inputSchema: jsonSchema((options.schema as any).toJSONSchema()),
    execute: async (value: T) => {
      collected = options.schema.parse(value);
      return "结果已保存，不要再输出其他内容";
    },
  });
  const content: any[] = [{ type: "text", text: options.prompt }];
  for (const file of options.files ?? []) {
    content.push({ type: "file", data: await fs.readFile(file.path), mediaType: file.mediaType });
  }
  await u.Ai.Text(options.agent).invoke({
    system: options.system,
    messages: [{ role: "user", content }],
    tools: { resultTool },
    toolChoice: { type: "tool", toolName: "resultTool" },
  });
  if (!collected) throw new Error(`${options.agent} 未调用保存工具，结果未落库`);
  return collected;
}

async function runVideoAnalysisAgent<T>(options: {
  schema: z.ZodType<T>;
  sourceMetadata: any;
  boundaries: number[];
  shotIndex: number;
  clipPath: string;
  keyframePath: string;
  startMs: number;
  endMs: number;
}): Promise<T> {
  await assertResolvedRedrawAgentModel("redrawAgent:videoAnalysisAgent");
  let collected: T | null = null;
  const called = new Set<string>();
  const emptySchema = z.object({});
  const controlledTools: any = {
    probe_source_video: (tool as any)({
      description: "读取源视频的媒体、音轨和字幕流信息。",
      inputSchema: jsonSchema((emptySchema as any).toJSONSchema()),
      execute: async () => {
        called.add("probe_source_video");
        const metadata = options.sourceMetadata;
        return {
          durationMs: metadata.durationMs,
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          formatName: metadata.formatName,
          videoCodec: metadata.videoCodec,
          audioCodec: metadata.audioCodec,
          hasAudio: metadata.hasAudio,
          hasSubtitleStream: metadata.hasSubtitle,
        };
      },
    }),
    list_shot_candidates: (tool as any)({
      description: "读取本地媒体工具生成的镜头边界候选。",
      inputSchema: jsonSchema((emptySchema as any).toJSONSchema()),
      execute: async () => {
        called.add("list_shot_candidates");
        return options.boundaries.map((startMs, index) => ({
          shotIndex: index,
          startMs,
          endMs: options.boundaries[index + 1] ?? null,
        })).slice(0, -1);
      },
    }),
    load_segment_evidence: (tool as any)({
      description: "授权读取指定候选镜头；片段与关键帧已作为当前消息的受控附件提供。",
      inputSchema: jsonSchema((z.object({ shotIndex: z.number().int().nonnegative() }) as any).toJSONSchema()),
      execute: async ({ shotIndex }: { shotIndex: number }) => {
        if (shotIndex !== options.shotIndex) throw new Error("只能读取当前受控镜头证据");
        called.add("load_segment_evidence");
        return {
          shotIndex,
          startMs: options.startMs,
          endMs: options.endMs,
          attachments: ["source-segment.mp4", "source-keyframe.jpg"],
        };
      },
    }),
    save_shot_analysis: (tool as any)({
      description: "保存当前镜头的动作、对白、场景、运镜、音效和资产线索。",
      inputSchema: jsonSchema((options.schema as any).toJSONSchema()),
      execute: async (value: T) => {
        called.add("save_shot_analysis");
        collected = options.schema.parse(value);
        return "当前镜头分析已保存";
      },
    }),
    validate_timeline: (tool as any)({
      description: "检查镜头候选时间轴连续、无重叠、无缺口。",
      inputSchema: jsonSchema((emptySchema as any).toJSONSchema()),
      execute: async () => {
        const timeline = options.boundaries.slice(0, -1).map((startMs, index) => ({ startMs, endMs: options.boundaries[index + 1] }));
        validateShotTimeline(timeline, options.sourceMetadata.durationMs, options.sourceMetadata.fps ? 1000 / options.sourceMetadata.fps : 0);
        called.add("validate_timeline");
        return { valid: true, shotCount: timeline.length, durationMs: options.sourceMetadata.durationMs };
      },
    }),
  };
  await u.Ai.Text("redrawAgent:videoAnalysisAgent").invoke({
    system:
      "你是转绘视频分析 Agent。你只能使用提供的 5 个受控工具并根据源片段记录事实，不得补写剧情、改写对白或推测片段外内容。必须依次调用 probe_source_video、list_shot_candidates、load_segment_evidence、save_shot_analysis 和 validate_timeline；逐字保留可辨识对白和原语言。save_shot_analysis 必须调用一次。",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `分析候选镜头 ${options.shotIndex + 1}，时间码 ${options.startMs}ms-${options.endMs}ms。记录场景、人物、动作、情绪、景别/视角/运镜、对白、音效、源资产线索、源画面风格，并判断画面中是否存在永久烧录的硬字幕。` },
        { type: "file", data: await fs.readFile(options.clipPath), mediaType: "video/mp4" },
        { type: "file", data: await fs.readFile(options.keyframePath), mediaType: "image/jpeg" },
      ],
    }],
    tools: controlledTools,
  });
  const requiredTools = ["probe_source_video", "list_shot_candidates", "load_segment_evidence", "save_shot_analysis", "validate_timeline"];
  const missingTools = requiredTools.filter((name) => !called.has(name));
  if (missingTools.length) throw new Error(`视频分析 Agent 未按要求调用工具：${missingTools.join("、")}`);
  if (!collected) throw new Error("视频分析 Agent 未保存当前镜头分析");
  return collected;
}

function serializeShots(shots: any[]) {
  return shots.map((shot) => ({
    shotIndex: shot.shotIndex,
    startMs: shot.startMs,
    endMs: shot.endMs,
    scene: shot.scene,
    characters: parseJson(shot.characters, []),
    actions: shot.actions,
    emotion: shot.emotion,
    camera: shot.camera,
    dialogue: shot.dialogue,
    sound: shot.sound,
    assetClues: parseJson(shot.assetClues, []),
  }));
}

async function getSource(projectId: number) {
  const source = await redrawDb("o_redrawSource").where("projectId", projectId).first();
  if (!source?.filePath) throw new Error("请先上传源视频");
  return source;
}

async function ensurePreviousSuccess(projectId: number, step: RedrawStep) {
  const run = await redrawDb("o_workflowStepRun").where({ projectId, step }).whereIn("state", ["success", "empty", "confirmed"]).orderBy("id", "desc").first();
  if (!run || run.state === "stale") throw new Error(`前置步骤 ${step} 尚未成功或结果已过期`);
}

async function analyzeSource(projectId: number) {
  const source = await getSource(projectId);
  const style = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
  if (!style.description.trim() && !style.visualManual.trim() && !style.referenceIds.length) throw new Error("开始分析前必须填写目标风格或上传风格参考图");
  await assertResolvedRedrawAgentModel("redrawAgent:videoAnalysisAgent");
  const sourcePath = await u.oss.getLocalPath(source.filePath);
  const sourceMetadata = await probeSourceVideo(sourcePath);
  const proxyRel = `${projectId}/redraw/analysis/source-${source.id}-proxy.mp4`;
  const proxyPath = await u.oss.getLocalPath(proxyRel);
  await redrawDb("o_redrawSource").where("id", source.id).update({ analysisState: "running", errorReason: null, confirmed: false, updateTime: Date.now() });
  await u.oss.deleteDirectory(`${projectId}/redraw/analysis`).catch(() => {});
  await createAnalysisProxy(sourcePath, proxyPath);
  const boundaries = await detectShotCandidates(proxyPath, source.durationMs);
  await redrawDb("o_redrawShot").where("sourceId", source.id).delete();

  const shotSchema = z.object({
    sourceStyle: z.string().default(""),
    scene: z.string(),
    characters: z.array(z.string()).default([]),
    actions: z.string(),
    emotion: z.string().default(""),
    camera: z.string(),
    dialogue: z.string().default(""),
    sound: z.string().default(""),
    hasHardSubtitles: z.boolean().default(false),
    assetClues: z.array(z.object({ name: z.string(), type: z.enum(["role", "scene", "tool"]), description: z.string().default("") })).default([]),
  });
  let sourceStyle = "";
  let hasHardSubtitles = false;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index];
    const endMs = boundaries[index + 1];
    const clipRel = `${projectId}/redraw/analysis/shot-${String(index + 1).padStart(4, "0")}.mp4`;
    const keyframeRel = `${projectId}/redraw/analysis/shot-${String(index + 1).padStart(4, "0")}.jpg`;
    const clipPath = await u.oss.getLocalPath(clipRel);
    const keyframePath = await u.oss.getLocalPath(keyframeRel);
    await extractSegment(sourcePath, clipPath, startMs, endMs);
    await extractKeyframe(sourcePath, keyframePath, Math.floor((startMs + endMs) / 2));
    const analysis = await runVideoAnalysisAgent({
      schema: shotSchema,
      sourceMetadata,
      boundaries,
      shotIndex: index,
      clipPath,
      keyframePath,
      startMs,
      endMs,
    });
    if (analysis.sourceStyle && !sourceStyle) sourceStyle = analysis.sourceStyle;
    hasHardSubtitles ||= analysis.hasHardSubtitles;
    await redrawDb("o_redrawShot").insert({
      projectId,
      sourceId: source.id,
      shotIndex: index,
      startMs,
      endMs,
      scene: analysis.scene,
      characters: JSON.stringify(analysis.characters),
      actions: analysis.actions,
      emotion: analysis.emotion,
      camera: analysis.camera,
      dialogue: analysis.dialogue,
      sound: analysis.sound,
      assetClues: JSON.stringify(analysis.assetClues),
      keyframes: JSON.stringify([keyframeRel]),
      confirmed: false,
      createTime: Date.now(),
      updateTime: Date.now(),
    });
  }
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  validateShotTimeline(shots, source.durationMs, source.fps ? 1000 / source.fps : 0);
  await redrawDb("o_redrawSource").where("id", source.id).update({
    sourceStyle,
    hasSubtitle: Boolean(source.hasSubtitle) || hasHardSubtitles,
    analysisState: "success",
    errorReason: null,
    updateTime: Date.now(),
  });
  return shots.length;
}

async function createScript(projectId: number) {
  const source = await getSource(projectId);
  if (!source.confirmed) throw new Error("请先逐镜检查并确认视频分析结果");
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  const scriptSchema = z.object({ content: z.string().min(1) });
  const result = await runToolAgent({
    agent: "redrawAgent:scriptAgent",
    schema: scriptSchema,
    system:
      "你是转绘剧本 Agent。按输入镜头顺序和原始时间码编排剧本。严禁增加、删除、翻译、润色或改写剧情事件与对白；必须保留每个镜头、动作和声音信息。必须调用 resultTool。",
    prompt: `请制作一份逐镜转绘剧本：\n${JSON.stringify(serializeShots(shots))}`,
  });
  for (const shot of shots) {
    const dialogue = String(shot.dialogue ?? "").trim();
    if (dialogue && !result.content.includes(dialogue)) throw new Error(`剧本保真校验失败：第 ${shot.shotIndex + 1} 镜对白被遗漏或改写`);
  }
  const scriptId = source.scriptId || createRedrawId();
  const existing = await redrawDb("o_script").where({ id: scriptId, projectId }).first();
  if (existing) await redrawDb("o_script").where("id", scriptId).update({ name: "转绘剧本", content: result.content, extractState: 1, errorReason: null });
  else await redrawDb("o_script").insert({ id: scriptId, projectId, name: "转绘剧本", content: result.content, extractState: 1, createTime: Date.now(), errorReason: null });
  await redrawDb("o_redrawSource").where("id", source.id).update({ scriptId, updateTime: Date.now() });
  return 1;
}

const assetSchema = z.object({
  assets: z.array(z.object({ name: z.string(), type: z.enum(["role", "scene", "tool"]), description: z.string(), prompt: z.string() })),
});

async function createOriginalAssets(projectId: number) {
  await assertStepConfirmed(projectId, "createScript");
  const source = await getSource(projectId);
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  const targetStyle = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
  const result = await runToolAgent({
    agent: "redrawAgent:assetMappingAgent",
    schema: assetSchema,
    system:
      "你是转绘资产映射 Agent。只为输入镜头中确实存在的角色、场景和重要道具建立目标风格标准资产，不得新增剧情资产。prompt 必须体现目标风格。必须调用 resultTool。",
    prompt: `目标风格：${JSON.stringify(targetStyle)}\n源风格：${source.sourceStyle ?? ""}\n镜头分析：${JSON.stringify(serializeShots(shots))}`,
  });
  const oldAssets = await redrawDb("o_assets").where({ projectId, scriptId: source.scriptId });
  const oldIds = oldAssets.map((item: any) => item.id);
  if (oldIds.length) {
    const oldImageIds = oldAssets.map((item: any) => item.imageId).filter(Boolean);
    await redrawDb("o_assets2Storyboard").whereIn("assetId", oldIds).delete();
    await redrawDb("o_scriptAssets").whereIn("assetId", oldIds).delete();
    await redrawDb("o_assets").whereIn("id", oldIds).update({ imageId: null });
    if (oldImageIds.length) await redrawDb("o_image").whereIn("id", oldImageIds).delete();
    await redrawDb("o_assets").whereIn("id", oldIds).delete();
  }
  await redrawDb("o_redrawReference").where({ projectId, kind: "sourceEvidence" }).delete();
  for (const asset of result.assets) {
    const id = createRedrawId();
    await redrawDb("o_assets").insert({
      id,
      projectId,
      scriptId: source.scriptId,
      name: asset.name,
      type: asset.type,
      describe: asset.description,
      prompt: asset.prompt,
      remark: "redraw:original",
      promptState: "已完成",
      startTime: Date.now(),
    });
    await redrawDb("o_scriptAssets").insert({ scriptId: source.scriptId, assetId: id });
    const evidencePaths = shots
      .filter((shot: any) => {
        const clues = parseJson<any[]>(shot.assetClues, []);
        return clues.some((clue) => clue.name === asset.name) || parseJson<string[]>(shot.characters, []).includes(asset.name) || shot.scene === asset.name;
      })
      .flatMap((shot: any) => parseJson<string[]>(shot.keyframes, []))
      .slice(0, 2);
    for (const filePath of evidencePaths) {
      await redrawDb("o_redrawReference").insert({ projectId, sourceId: source.id, assetId: id, kind: "sourceEvidence", label: `${asset.name} · 源视频证据`, filePath, createTime: Date.now() });
    }
  }
  return result.assets.length;
}

async function getImageReferences(projectId: number, paths: string[] = [], limit = 8) {
  const rows = await redrawDb("o_redrawReference").where("projectId", projectId).whereNot("kind", "sourceEvidence").orderBy("id");
  const all = [...paths, ...rows.map((row: any) => row.filePath)].filter(Boolean).slice(0, limit);
  const result: Extract<ReferenceList, { type: "image" }>[] = [];
  for (const filePath of all) {
    try {
      result.push({ type: "image", base64: await u.oss.getImageBase64(filePath) });
    } catch {}
  }
  return result;
}

async function generateAssetImages(projectId: number, derived: boolean, options: RunOptions) {
  const project = await requireRedrawProject(projectId);
  const source = await getSource(projectId);
  await assertRedrawProjectModels(project.imageModel, project.videoModel);
  const assets = await redrawDb("o_assets")
    .where({ projectId, scriptId: source.scriptId })
    [derived ? "whereNotNull" : "whereNull"]("assetsId")
    .orderBy("id");
  const sourceShots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  let completed = 0;
  for (const asset of assets) {
    if (options.retryFailed && asset.imageId) {
      const current = await redrawDb("o_image").where("id", asset.imageId).first();
      if (current?.state === "已完成") continue;
    }
    const imageId = createRedrawId();
    const filePath = `${projectId}/redraw/generated/assets/${asset.id}-${crypto.randomUUID()}.png`;
    const currentImage = asset.imageId ? await redrawDb("o_image").where("id", asset.imageId).first() : null;
    if (currentImage) await redrawDb("o_image").where("id", currentImage.id).update({ filePath, state: "生成中", errorReason: null, model: project.imageModel, resolution: project.imageQuality });
    else {
      await redrawDb("o_image").insert({ id: imageId, assetsId: asset.id, filePath, type: "assets", model: project.imageModel, resolution: project.imageQuality, state: "生成中" });
      await redrawDb("o_assets").where("id", asset.id).update({ imageId });
    }
    const useImageId = currentImage?.id ?? imageId;
    try {
      const sourcePaths: string[] = sourceShots
        .filter((shot: any) => {
          const clues = parseJson<any[]>(shot.assetClues, []);
          return clues.some((clue) => clue.name === asset.name) || parseJson<string[]>(shot.characters, []).includes(asset.name) || shot.scene === asset.name;
        })
        .flatMap((shot: any) => parseJson<string[]>(shot.keyframes, []))
        .slice(0, 4);
      if (derived && asset.assetsId) {
        const parent = await redrawDb("o_assets").where("id", asset.assetsId).first();
        if (parent?.imageId) {
          const image = await redrawDb("o_image").where("id", parent.imageId).first();
          if (image?.filePath) sourcePaths.push(image.filePath);
        }
      }
      const references = await getImageReferences(projectId, sourcePaths);
      await u.Ai.Image(project.imageModel).run(
        { prompt: asset.prompt, referenceList: references, size: project.imageQuality, aspectRatio: project.videoRatio },
        { projectId, taskClass: derived ? "转绘衍生资产图" : "转绘原始资产图", describe: asset.name, relatedObjects: JSON.stringify({ assetId: asset.id }) },
      ).then((image: any) => image.save(filePath));
      await redrawDb("o_image").where("id", useImageId).update({ state: "已完成", errorReason: null });
      if (currentImage?.filePath && currentImage.filePath !== filePath) await u.oss.deleteFile(currentImage.filePath).catch(() => {});
      completed += 1;
    } catch (cause) {
      await redrawDb("o_image").where("id", useImageId).update({ state: "生成失败", errorReason: u.error(cause).message });
      throw cause;
    }
  }
  return completed;
}

async function createDerivedAssets(projectId: number) {
  await ensurePreviousSuccess(projectId, "generateOriginalAssetImages");
  const source = await getSource(projectId);
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  const parents = await redrawDb("o_assets").where({ projectId, scriptId: source.scriptId }).whereNull("assetsId");
  const derivedSchema = z.object({
    assets: z.array(z.object({ parentName: z.string(), name: z.string(), description: z.string(), prompt: z.string() })).default([]),
  });
  const result = await runToolAgent({
    agent: "redrawAgent:assetMappingAgent",
    schema: derivedSchema,
    system: "你是转绘衍生资产映射 Agent。仅当同一资产在镜头中确有服装、状态、时间或场景变化时才创建变体；没有变化则返回空数组。不得新增剧情。必须调用 resultTool。",
    prompt: `原始资产：${JSON.stringify(parents.map((item: any) => ({ name: item.name, type: item.type, description: item.describe })))}\n镜头：${JSON.stringify(serializeShots(shots))}`,
  });
  const oldDerived = await redrawDb("o_assets").where({ projectId, scriptId: source.scriptId }).whereNotNull("assetsId");
  const oldDerivedIds = oldDerived.map((item: any) => item.id);
  if (oldDerivedIds.length) {
    const oldImageIds = oldDerived.map((item: any) => item.imageId).filter(Boolean);
    await redrawDb("o_assets2Storyboard").whereIn("assetId", oldDerivedIds).delete();
    await redrawDb("o_scriptAssets").whereIn("assetId", oldDerivedIds).delete();
    await redrawDb("o_assets").whereIn("id", oldDerivedIds).update({ imageId: null });
    if (oldImageIds.length) await redrawDb("o_image").whereIn("id", oldImageIds).delete();
    await redrawDb("o_assets").whereIn("id", oldDerivedIds).delete();
  }
  let count = 0;
  for (const asset of result.assets) {
    const parent = parents.find((item: any) => item.name === asset.parentName);
    if (!parent) continue;
    const id = createRedrawId();
    await redrawDb("o_assets").insert({ id, projectId, scriptId: source.scriptId, assetsId: parent.id, name: asset.name, type: parent.type, describe: asset.description, prompt: asset.prompt, remark: "redraw:derived", promptState: "已完成", startTime: Date.now() });
    await redrawDb("o_scriptAssets").insert({ scriptId: source.scriptId, assetId: id });
    count += 1;
  }
  return count;
}

function modelDurations(model: any): number[] {
  const durations: number[] = (model.durationResolutionMap ?? [])
    .flatMap((item: any) => item.duration ?? [])
    .map((item: unknown) => Number(item))
    .filter((item: number) => item > 0);
  return Array.from(new Set<number>(durations)).sort((a, b) => a - b);
}

async function buildStoryboards(projectId: number) {
  await assertStepConfirmed(projectId, "generateDerivedAssetImages");
  const project = await requireRedrawProject(projectId);
  const source = await getSource(projectId);
  const { model } = await getConfiguredModel(project.videoModel);
  const durations = modelDurations(model);
  if (!durations.length) throw new Error("视频模型未声明可用时长");
  const minDurationMs = durations[0] * 1000;
  const maxDurationMs = durations[durations.length - 1] * 1000;
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  const assets = await redrawDb("o_assets").where({ projectId, scriptId: source.scriptId });
  const oldStoryboards = await redrawDb("o_storyboard").where("projectId", projectId).select("id");
  const oldStoryboardIds = oldStoryboards.map((item: any) => item.id);
  if (oldStoryboardIds.length) await redrawDb("o_assets2Storyboard").whereIn("storyboardId", oldStoryboardIds).delete();
  await redrawDb("o_redrawSegment").where("projectId", projectId).delete();
  await redrawDb("o_video").where("projectId", projectId).delete();
  await redrawDb("o_storyboard").where("projectId", projectId).delete();
  await redrawDb("o_videoTrack").where("projectId", projectId).delete();
  const sourcePath = await u.oss.getLocalPath(source.filePath);
  let segmentCount = 0;
  for (const shot of shots) {
    const storyboardId = createRedrawId();
    const trackId = createRedrawId();
    const videoDesc = JSON.stringify(serializeShots([shot])[0]);
    await redrawDb("o_videoTrack").insert({ id: trackId, projectId, scriptId: source.scriptId, state: "未生成", prompt: "", duration: Math.ceil((shot.endMs - shot.startMs) / 1000) });
    await redrawDb("o_storyboard").insert({ id: storyboardId, projectId, scriptId: source.scriptId, trackId, track: "main", prompt: "", filePath: "", duration: String((shot.endMs - shot.startMs) / 1000), state: "未生成", reason: null, videoDesc, shouldGenerateImage: 1, index: shot.shotIndex, createTime: Date.now() });
    const clues = parseJson<any[]>(shot.assetClues, []);
    const names = new Set([...parseJson<string[]>(shot.characters, []), shot.scene, ...clues.map((item) => item.name)].filter(Boolean));
    for (const asset of assets.filter((item: any) => names.has(item.name) || (item.assetsId && names.has(assets.find((candidate: any) => candidate.id === item.assetsId)?.name)))) {
      await redrawDb("o_assets2Storyboard").insert({ storyboardId, assetId: asset.id });
    }
    const segments = planInternalSegments(shot.startMs, shot.endMs, maxDurationMs, minDurationMs);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const segmentId = createRedrawId();
      const clipRel = `${projectId}/redraw/segments/${segmentId}.mp4`;
      await extractSegment(sourcePath, await u.oss.getLocalPath(clipRel), segment.startMs, segment.endMs);
      await redrawDb("o_redrawSegment").insert({ id: segmentId, projectId, sourceId: source.id, shotId: shot.id, segmentIndex, startMs: segment.startMs, endMs: segment.endMs, generationDurationMs: segment.generationDurationMs, sourceClipPath: clipRel, storyboardId, trackId, state: "pending", retryCount: 0, accepted: false, createTime: Date.now(), updateTime: Date.now() });
      segmentCount += 1;
    }
  }
  return segmentCount;
}

async function generateStoryboardImages(projectId: number, options: RunOptions) {
  await ensurePreviousSuccess(projectId, "buildStoryboards");
  const project = await requireRedrawProject(projectId);
  const source = await getSource(projectId);
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  const storyboards = await redrawDb("o_storyboard").where({ projectId, scriptId: source.scriptId }).orderBy("index");
  let count = 0;
  for (const storyboard of storyboards) {
    if (options.retryFailed && storyboard.state === "已完成" && storyboard.filePath) continue;
    const shot = shots.find((item: any) => item.shotIndex === storyboard.index);
    const keyframes = parseJson<string[]>(shot?.keyframes, []);
    const relations = await redrawDb("o_assets2Storyboard").where("storyboardId", storyboard.id);
    const assetRows = relations.length ? await redrawDb("o_assets").whereIn("id", relations.map((item: any) => item.assetId)) : [];
    const imageRows = assetRows.length ? await redrawDb("o_image").whereIn("id", assetRows.map((item: any) => item.imageId).filter(Boolean)).where("state", "已完成") : [];
    const references = await getImageReferences(projectId, [...keyframes, ...imageRows.map((item: any) => item.filePath)]);
    const filePath = `${projectId}/redraw/generated/storyboards/${storyboard.id}-${crypto.randomUUID()}.png`;
    const targetStyle = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
    const prompt = `严格保持源关键帧构图、人物数量、动作、景别和运镜意图，仅将人物、服装、场景、道具和媒介质感转换为目标风格。目标风格：${targetStyle.description} ${targetStyle.visualManual}。镜头事实：${storyboard.videoDesc}`;
    await redrawDb("o_storyboard").where("id", storyboard.id).update({ prompt, state: "生成中", reason: null });
    try {
      await u.Ai.Image(project.imageModel).run({ prompt, referenceList: references, size: project.imageQuality, aspectRatio: project.videoRatio }, { projectId, taskClass: "转绘分镜图", describe: `镜头 ${storyboard.index + 1}`, relatedObjects: JSON.stringify({ storyboardId: storyboard.id }) }).then((image: any) => image.save(filePath));
      await redrawDb("o_storyboard").where("id", storyboard.id).update({ filePath, state: "已完成", reason: null });
      if (storyboard.filePath && storyboard.filePath !== filePath) await u.oss.deleteFile(storyboard.filePath).catch(() => {});
      count += 1;
    } catch (cause) {
      await redrawDb("o_storyboard").where("id", storyboard.id).update({ state: "生成失败", reason: u.error(cause).message });
      throw cause;
    }
  }
  return count;
}

async function generateVideoPrompts(projectId: number) {
  await assertStepConfirmed(projectId, "generateStoryboardImages");
  const source = await getSource(projectId);
  const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
  const storyboards = await redrawDb("o_storyboard").where({ projectId, scriptId: source.scriptId }).orderBy("index");
  const promptSchema = z.object({ prompt: z.string().min(1) });
  for (const storyboard of storyboards) {
    const shot = shots.find((item: any) => item.shotIndex === storyboard.index);
    const targetStyle = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
    const result = await runToolAgent({
      agent: "redrawAgent:storyboardAgent",
      schema: promptSchema,
      system: "你是转绘分镜视频提示词 Agent。提示词必须要求完全保持源片段的人物数量、身份、事件顺序、对白、动作发生时间、景别、构图和运镜；只改变指定视觉风格。不得增加或删除剧情。必须调用 resultTool。",
      prompt: `目标风格：${JSON.stringify(targetStyle)}\n源镜头：${JSON.stringify(serializeShots([shot])[0])}\n分镜图提示词：${storyboard.prompt}`,
    });
    if (shot.dialogue?.trim() && !result.prompt.includes(shot.dialogue.trim())) throw new Error(`第 ${storyboard.index + 1} 镜视频提示词遗漏或改写了对白`);
    await redrawDb("o_videoTrack").where("id", storyboard.trackId).update({ prompt: result.prompt, state: "已完成", reason: null });
  }
  return storyboards.length;
}

function selectGenerationDuration(model: any, requestedMs: number): number {
  const durations = modelDurations(model);
  const requested = requestedMs / 1000;
  return durations.find((value: number) => value >= requested) ?? durations[durations.length - 1];
}

async function reviewFidelity(sourcePath: string, generatedPath: string, prompt: string) {
  const schema = z.object({ score: z.number().min(0).max(100), hardFailures: z.array(z.string()).default([]), feedback: z.string().default("") });
  return runToolAgent({
    agent: "redrawAgent:fidelitySupervisorAgent",
    schema,
    system: "你是逐镜保真监督 Agent。比较源片段和生成片段：人物数量与身份、剧情动作与事件顺序、景别构图运镜、动作发生时间。新增/缺失关键动作、增删剧情事件或镜头顺序错误必须列入 hardFailures。只评价内容保真，不因目标视觉风格变化扣分。必须调用 resultTool。",
    prompt: `用于生成的严格约束提示词：${prompt}\n给出 0-100 分；85 分为通过线。第一个视频是源片段，第二个是生成片段。`,
    files: [
      { path: sourcePath, mediaType: "video/mp4" },
      { path: generatedPath, mediaType: "video/mp4" },
    ],
  });
}

async function generateVideos(projectId: number, options: RunOptions) {
  await ensurePreviousSuccess(projectId, "generateVideoPrompts");
  if (!options.confirmCost) throw new Error("生成前必须确认费用：单片段最多生成 3 次（含 2 次自动保真重试）");
  const project = await requireRedrawProject(projectId);
  await assertRedrawProjectModels(project.imageModel, project.videoModel);
  const { model } = await getConfiguredModel(project.videoModel);
  if (!hasReferenceMode(model, "videoReference:")) throw new Error("视频模型缺少 videoReference:N 能力");
  const mode = (model.mode ?? []).find((item: any) => Array.isArray(item) && item.some((value: string) => value.startsWith("videoReference:")));
  if (!mode) throw new Error("视频模型未提供可执行的多参考模式");
  const imageLimit = Number(String(mode.find((value: string) => value.startsWith("imageReference:")) ?? "imageReference:0").split(":")[1]);
  const segments = await redrawDb("o_redrawSegment").where("projectId", projectId).orderBy(["startMs", "segmentIndex"]);
  let completed = 0;
  for (const segment of segments) {
    if (options.retryFailed && segment.state === "approved") continue;
    const track = await redrawDb("o_videoTrack").where("id", segment.trackId).first();
    const storyboard = await redrawDb("o_storyboard").where("id", segment.storyboardId).first();
    if (!track?.prompt) throw new Error(`片段 ${segment.id} 缺少视频提示词`);
    const sourcePath = await u.oss.getLocalPath(segment.sourceClipPath);
    const references: ReferenceList[] = [{ type: "video", base64: await u.oss.getImageBase64(segment.sourceClipPath) }];
    if (imageLimit > 0 && storyboard?.filePath) references.push({ type: "image", base64: await u.oss.getImageBase64(storyboard.filePath) });
    const relations = imageLimit > 1 ? await redrawDb("o_assets2Storyboard").where("storyboardId", storyboard.id) : [];
    if (relations.length) {
      const assets = await redrawDb("o_assets").whereIn("id", relations.map((item: any) => item.assetId));
      const images = await redrawDb("o_image").whereIn("id", assets.map((item: any) => item.imageId).filter(Boolean)).where("state", "已完成");
      for (const image of images.slice(0, Math.max(0, imageLimit - 1))) references.push({ type: "image", base64: await u.oss.getImageBase64(image.filePath) });
    }
    let feedback = "";
    let approved = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const videoId = createRedrawId();
      const filePath = `${projectId}/redraw/generated/videos/${segment.id}-attempt-${attempt + 1}-${crypto.randomUUID()}.mp4`;
      await redrawDb("o_video").insert({ id: videoId, filePath, time: Date.now(), state: "生成中", scriptId: (await getSource(projectId)).scriptId, projectId, videoTrackId: segment.trackId });
      await redrawDb("o_redrawSegment").where("id", segment.id).update({ state: "generating", retryCount: attempt, errorReason: null, updateTime: Date.now() });
      try {
        const prompt = `${track.prompt}\n严格保真修正：${feedback || "无。只转绘视觉风格，绝不改变剧情内容和动作时序。"}`;
        await u.Ai.Video(project.videoModel).run(
          { duration: selectGenerationDuration(model, segment.generationDurationMs), resolution: String((model.durationResolutionMap?.[0]?.resolution ?? [project.videoRatio === "9:16" ? "768x1152" : "1152x768"])[0]), aspectRatio: project.videoRatio as "16:9" | "9:16", prompt, referenceList: references, audio: false, mode },
          { projectId, taskClass: "转绘视频片段", describe: `片段 ${segment.id} 尝试 ${attempt + 1}`, relatedObjects: JSON.stringify({ segmentId: segment.id, attempt: attempt + 1 }) },
        ).then((video: any) => video.save(filePath));
        await redrawDb("o_video").where("id", videoId).update({ state: "生成成功", errorReason: null });
        await redrawDb("o_redrawSegment").where("id", segment.id).update({ state: "reviewing", videoId, updateTime: Date.now() });
        const report = await reviewFidelity(sourcePath, await u.oss.getLocalPath(filePath), prompt);
        approved = report.score >= 85 && report.hardFailures.length === 0;
        await redrawDb("o_redrawSegment").where("id", segment.id).update({ videoId, fidelityScore: report.score, fidelityReport: JSON.stringify(report), retryCount: attempt, state: approved ? "approved" : attempt === 2 ? "needs_review" : "retrying", errorReason: approved ? null : report.feedback, updateTime: Date.now() });
        if (approved) {
          await redrawDb("o_videoTrack").where("id", segment.trackId).update({ selectVideoId: videoId });
          completed += 1;
          break;
        }
        feedback = `${report.feedback}；硬失败：${report.hardFailures.join("、")}`;
      } catch (cause) {
        await redrawDb("o_video").where("id", videoId).update({ state: "生成失败", errorReason: u.error(cause).message });
        if (attempt === 2) await redrawDb("o_redrawSegment").where("id", segment.id).update({ state: "failed", errorReason: u.error(cause).message, retryCount: attempt, updateTime: Date.now() });
        else feedback = u.error(cause).message;
      }
    }
  }
  return completed;
}

async function assembleOutput(projectId: number) {
  await ensurePreviousSuccess(projectId, "generateVideos");
  const source = await getSource(projectId);
  const segments = await redrawDb("o_redrawSegment").where("projectId", projectId).orderBy(["startMs", "segmentIndex"]);
  const blocked = segments.filter((item: any) => item.state !== "approved" && !item.accepted);
  if (blocked.length) throw new Error(`仍有 ${blocked.length} 个片段未通过保真复核或人工接受`);
  const videos = await redrawDb("o_video").whereIn("id", segments.map((item: any) => item.videoId).filter(Boolean));
  const videoMap = new Map(videos.map((item: any) => [item.id, item]));
  const segmentFiles = await Promise.all(segments.map(async (segment: any) => {
    const video = videoMap.get(segment.videoId) as any;
    if (!video?.filePath || video.state !== "生成成功") throw new Error(`片段 ${segment.id} 没有可合成视频`);
    return { path: await u.oss.getLocalPath(video.filePath), startMs: segment.startMs, endMs: segment.endMs };
  }));
  const outputId = createRedrawId();
  const filePath = `${projectId}/redraw/output/${outputId}.mp4`;
  const srtPath = `${projectId}/redraw/output/${outputId}.srt`;
  await redrawDb("o_redrawOutput").insert({ id: outputId, projectId, sourceId: source.id, filePath, srtPath, state: "running", createTime: Date.now(), updateTime: Date.now() });
  try {
    const shots = await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex");
    await u.oss.writeFile(srtPath, Buffer.from(buildSrt(shots), "utf8"));
    const outputLocalPath = await u.oss.getLocalPath(filePath);
    const srtLocalPath = await u.oss.getLocalPath(srtPath);
    await assembleRedrawVideo({ sourcePath: await u.oss.getLocalPath(source.filePath), segments: segmentFiles, outputPath: outputLocalPath, durationMs: source.durationMs, width: source.width, height: source.height, fps: source.fps });
    const targetStyle = redrawTargetStyleSchema.parse(parseJson(source.targetStyle, {}));
    if (source.hasSubtitle && targetStyle.burnSubtitles) {
      const burnedPath = `${outputLocalPath}.subtitled.mp4`;
      await burnSrtSubtitles(outputLocalPath, srtLocalPath, burnedPath);
      await fs.rename(burnedPath, outputLocalPath);
    }
    const outputMetadata = await probeSourceVideo(outputLocalPath);
    const sourceMetadata = await probeSourceVideo(await u.oss.getLocalPath(source.filePath));
    const frameMs = source.fps ? 1000 / source.fps : 40;
    const sourceSyncOffsetMs = sourceMetadata.avSyncOffsetMs ?? 0;
    const outputSyncOffsetMs = outputMetadata.avSyncOffsetMs ?? 0;
    const audioSyncErrorMs = source.hasAudio ? Math.abs(outputSyncOffsetMs - sourceSyncOffsetMs) : 0;
    const metrics = {
      durationErrorMs: Math.abs(outputMetadata.durationMs - source.durationMs),
      frameToleranceMs: frameMs,
      sourceSyncOffsetMs,
      outputSyncOffsetMs,
      audioSyncErrorMs,
      timelineAccepted: Math.abs(outputMetadata.durationMs - source.durationMs) <= frameMs,
      audioAccepted: source.hasAudio ? outputMetadata.hasAudio && audioSyncErrorMs <= 40 : true,
      fidelityThreshold: 85,
    };
    if (!metrics.timelineAccepted || !metrics.audioAccepted) throw new Error("最终成片未通过时长或音轨验收");
    await redrawDb("o_redrawOutput").where("id", outputId).update({ state: "success", metrics: JSON.stringify(metrics), qualityReport: JSON.stringify(segments.map((item: any) => ({ segmentId: item.id, score: item.fidelityScore, accepted: item.accepted }))), errorReason: null, updateTime: Date.now() });
    return 1;
  } catch (cause) {
    await redrawDb("o_redrawOutput").where("id", outputId).update({ state: "failed", errorReason: u.error(cause).message, updateTime: Date.now() });
    throw cause;
  }
}

async function authorizeStep(projectId: number, step: RedrawStep) {
  const source = await redrawDb("o_redrawSource").where("projectId", projectId).first();
  const runs = await redrawDb("o_workflowStepRun").where("projectId", projectId).orderBy("id", "desc").limit(20);
  const schema = z.object({ allowed: z.boolean(), reason: z.string().default("") });
  const result = await runToolAgent({
    agent: "redrawAgent:decisionAgent",
    schema,
    system:
      "你是转绘确定性工作流的决策检查层。你只能检查明显前置条件并允许当前指定步骤，不能更改步骤、跳过人工确认点、选择未列出的工具或授权费用。后端状态机拥有最终决定权。必须调用 resultTool。",
    prompt: `当前请求步骤：${step}\n允许的唯一动作：执行 ${step}\n源视频状态：${JSON.stringify(source && { filePath: !!source.filePath, analysisState: source.analysisState, confirmed: source.confirmed, scriptId: source.scriptId })}\n最近步骤状态：${JSON.stringify(runs.map((run: any) => ({ step: run.step, state: run.state })))}\n请仅返回是否存在明显缺失前置条件。`,
  });
  if (!result.allowed) throw new Error(`转绘决策层拒绝执行：${result.reason || "前置条件不满足"}`);
}

async function superviseIntermediate(projectId: number, step: RedrawStep) {
  const source = await getSource(projectId);
  const [shots, script, assets, storyboards] = await Promise.all([
    redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex"),
    source.scriptId ? redrawDb("o_script").where("id", source.scriptId).first() : null,
    redrawDb("o_assets").where("projectId", projectId).orderBy("id"),
    redrawDb("o_storyboard").where("projectId", projectId).orderBy("index"),
  ]);
  const schema = z.object({ passed: z.boolean(), violations: z.array(z.string()).default([]) });
  const result = await runToolAgent({
    agent: "redrawAgent:supervisionAgent",
    schema,
    system:
      "你是转绘中间结果监督层。检查结果是否增加、删除、翻译或改写源剧情/对白，镜头顺序与时间码是否一致，资产是否来自源镜头，分镜是否保持动作与镜头语言。视觉风格变化不算违规。必须调用 resultTool。",
    prompt: `已完成步骤：${step}\n源镜头：${JSON.stringify(serializeShots(shots))}\n转绘剧本：${script?.content ?? ""}\n资产：${JSON.stringify(assets.map((asset: any) => ({ id: asset.id, parentId: asset.assetsId, name: asset.name, type: asset.type, description: asset.describe })))}\n分镜：${JSON.stringify(storyboards.map((storyboard: any) => ({ index: storyboard.index, duration: storyboard.duration, videoDesc: storyboard.videoDesc, prompt: storyboard.prompt })))}\n只列出可由输入证据确认的违规。`,
  });
  if (!result.passed || result.violations.length) throw new Error(`转绘监督层未通过：${result.violations.join("；") || "中间结果违反一比一规则"}`);
}

async function executeStep(projectId: number, step: RedrawStep, options: RunOptions) {
  await authorizeStep(projectId, step);
  let itemCount = 0;
  switch (step) {
    case "analyzeSource": itemCount = await analyzeSource(projectId); break;
    case "createScript": itemCount = await createScript(projectId); break;
    case "createOriginalAssets": itemCount = await createOriginalAssets(projectId); break;
    case "generateOriginalAssetImages": await ensurePreviousSuccess(projectId, "createOriginalAssets"); itemCount = await generateAssetImages(projectId, false, options); break;
    case "createDerivedAssets": itemCount = await createDerivedAssets(projectId); break;
    case "generateDerivedAssetImages": await ensurePreviousSuccess(projectId, "createDerivedAssets"); itemCount = await generateAssetImages(projectId, true, options); break;
    case "buildStoryboards": itemCount = await buildStoryboards(projectId); break;
    case "generateStoryboardImages": itemCount = await generateStoryboardImages(projectId, options); break;
    case "generateVideoPrompts": itemCount = await generateVideoPrompts(projectId); break;
    case "generateVideos": itemCount = await generateVideos(projectId, options); break;
    case "assembleOutput": itemCount = await assembleOutput(projectId); break;
  }
  if (["analyzeSource", "createScript", "createOriginalAssets", "createDerivedAssets", "buildStoryboards", "generateVideoPrompts"].includes(step)) {
    await superviseIntermediate(projectId, step);
  }
  return itemCount;
}

async function buildStepInputHash(projectId: number, step: RedrawStep) {
  const source = await redrawDb("o_redrawSource").where("projectId", projectId).first();
  const shots = source ? await redrawDb("o_redrawShot").where("sourceId", source.id).orderBy("shotIndex") : [];
  const assets = await redrawDb("o_assets").where("projectId", projectId).orderBy("id");
  const storyboards = await redrawDb("o_storyboard").where("projectId", projectId).orderBy("index");
  return stableHash({ step, source: source && { sha256: source.sha256, targetStyle: source.targetStyle, confirmed: source.confirmed }, shots: serializeShots(shots), assets: assets.map((item: any) => ({ id: item.id, prompt: item.prompt, imageId: item.imageId })), storyboards: storyboards.map((item: any) => ({ id: item.id, prompt: item.prompt, filePath: item.filePath })) });
}

export async function startRedrawStep(projectId: number, step: RedrawStep, options: RunOptions = {}) {
  await requireRedrawProject(projectId);
  const running = await redrawDb("o_workflowStepRun").where({ projectId, step, state: "running" }).first();
  if (running) throw Object.assign(new Error("同一步骤正在运行，请勿重复提交"), { status: 409 });
  await invalidateRedrawAfter(projectId, step, `上游步骤 ${step} 已重新执行`);
  const now = Date.now();
  const [runId] = await redrawDb("o_workflowStepRun").insert({ projectId, scriptId: null, step, state: "running", itemCount: 0, errorReason: null, inputHash: await buildStepInputHash(projectId, step), metadata: JSON.stringify(options), startTime: now, updateTime: now });
  void (async () => {
    try {
      const itemCount = await executeStep(projectId, step, options);
      await redrawDb("o_workflowStepRun").where("id", runId).update({ state: itemCount ? "success" : "empty", itemCount, endTime: Date.now(), updateTime: Date.now() });
    } catch (cause) {
      if (step === "analyzeSource") await redrawDb("o_redrawSource").where("projectId", projectId).update({ analysisState: "failed", errorReason: u.error(cause).message, updateTime: Date.now() });
      await redrawDb("o_workflowStepRun").where("id", runId).update({ state: "failed", errorReason: u.error(cause).message, endTime: Date.now(), updateTime: Date.now() });
      console.error(`[redraw] ${step} failed`, cause);
    }
  })();
  return { runId, step, state: "running" };
}

export async function confirmRedrawStep(projectId: number, step: RedrawStep) {
  await requireRedrawProject(projectId);
  const run = await redrawDb("o_workflowStepRun").where({ projectId, step }).whereIn("state", ["success", "empty"]).orderBy("id", "desc").first();
  if (!run) throw new Error("当前步骤没有可确认的成功结果");
  const metadata = { ...parseJson(run.metadata, {}), confirmedAt: Date.now() };
  await redrawDb("o_workflowStepRun").where("id", run.id).update({ state: "confirmed", metadata: JSON.stringify(metadata), updateTime: Date.now() });
  return { runId: run.id, step, state: "confirmed" };
}
