import { z } from "zod";

export const redrawAgentConfigs = [
  {
    key: "redrawAgent",
    name: "转绘Agent",
    desc: "用于源视频理解、转绘剧本、资产映射、分镜生产和保真复核",
    capabilities: ["text", "image", "video", "toolCalling"],
  },
  {
    key: "redrawAgent:decisionAgent",
    name: "转绘Agent：决策层",
    desc: "检查前置条件、选择允许的工具和当前工作步骤",
    capabilities: ["text", "toolCalling"],
  },
  {
    key: "redrawAgent:supervisionAgent",
    name: "转绘Agent：监督层",
    desc: "检查分析、剧本、资产和分镜中间结果是否违背一比一规则",
    capabilities: ["text", "image", "toolCalling"],
  },
  {
    key: "redrawAgent:videoAnalysisAgent",
    name: "转绘Agent：视频分析",
    desc: "分析镜头边界、人物动作、对白、场景、运镜、音效和源风格",
    capabilities: ["text", "image", "video", "toolCalling"],
  },
  {
    key: "redrawAgent:scriptAgent",
    name: "转绘Agent：剧本生成",
    desc: "将结构化镜头分析写成不增删剧情的转绘剧本",
    capabilities: ["text", "toolCalling"],
  },
  {
    key: "redrawAgent:assetMappingAgent",
    name: "转绘Agent：资产映射",
    desc: "建立源人物、场景、道具与目标风格资产、衍生状态的映射",
    capabilities: ["text", "image", "toolCalling"],
  },
  {
    key: "redrawAgent:storyboardAgent",
    name: "转绘Agent：分镜生成",
    desc: "生成分镜表、分镜面板内容和分镜图提示词",
    capabilities: ["text", "image", "toolCalling"],
  },
  {
    key: "redrawAgent:fidelitySupervisorAgent",
    name: "转绘Agent：保真监督",
    desc: "比较源片段和生成片段，评分并产生重试修正意见",
    capabilities: ["text", "video", "toolCalling"],
  },
] as const;

export type RedrawAgentKey = (typeof redrawAgentConfigs)[number]["key"];
export const redrawAgentKeys = redrawAgentConfigs.map((item) => item.key) as RedrawAgentKey[];

export const redrawStepValues = [
  "analyzeSource",
  "createScript",
  "createOriginalAssets",
  "generateOriginalAssetImages",
  "createDerivedAssets",
  "generateDerivedAssetImages",
  "buildStoryboards",
  "generateStoryboardImages",
  "generateVideoPrompts",
  "generateVideos",
  "assembleOutput",
] as const;

export const redrawStepSchema = z.enum(redrawStepValues);
export type RedrawStep = z.infer<typeof redrawStepSchema>;

export const redrawStepConfigs = [
  ["analyzeSource", "分析源视频", "提取镜头、对白、动作、风格和源资产。"],
  ["createScript", "制作转绘剧本", "按源时间轴生成不增删剧情的剧本。"],
  ["createOriginalAssets", "生成原始资产", "建立目标风格角色、场景和道具。"],
  ["generateOriginalAssetImages", "生成原始资产图", "使用源证据和目标风格生成标准资产图。"],
  ["createDerivedAssets", "生成衍生资产", "根据镜头状态建立服装、状态和场景变体。"],
  ["generateDerivedAssetImages", "生成衍生资产图", "生成衍生资产图片。"],
  ["buildStoryboards", "生成分镜表与面板", "按镜头时间轴和资产关系创建分镜。"],
  ["generateStoryboardImages", "生成分镜图", "使用源关键帧和目标资产图生成分镜图。"],
  ["generateVideoPrompts", "生成视频提示词", "创建严格引用源片段的转绘视频提示词。"],
  ["generateVideos", "生成转绘视频", "按片段生成并执行保真复核。"],
  ["assembleOutput", "合成短剧", "按源时间轴合成并挂载原音轨和字幕。"],
] as const;

export const redrawStepConfigList = redrawStepConfigs.map(([key, label, description], index) => ({
  key: key as RedrawStep,
  label,
  description,
  order: (index + 1) * 10,
}));

export const redrawTargetStyleSchema = z.object({
  description: z.string().default(""),
  visualManual: z.string().default(""),
  transformCharacters: z.boolean().default(true),
  transformCostumes: z.boolean().default(true),
  transformScenes: z.boolean().default(true),
  transformProps: z.boolean().default(true),
  transformMedium: z.boolean().default(true),
  burnSubtitles: z.boolean().default(true),
  referenceIds: z.array(z.number().int().positive()).default([]),
});

export type RedrawTargetStyle = z.infer<typeof redrawTargetStyleSchema>;

export const REDRAW_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
export const REDRAW_MAX_DURATION_MS = 20 * 60 * 1000;
export const REDRAW_ALLOWED_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
