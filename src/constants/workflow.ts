import { z } from "zod";

export const workflowStepValues = [
  "extractOriginalAssets",
  "polishOriginalAssetPrompts",
  "generateOriginalAssetImages",
  "generateDerivedAssets",
  "polishDerivedAssetPrompts",
  "generateDerivedAssetImages",
  "generateStoryboardImages",
  "generateVideoPrompts",
  "generateVideos",
] as const;

export const workflowStepSchema = z.enum(workflowStepValues);

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export type WorkflowStepConfig = {
  key: WorkflowStep;
  label: string;
  description: string;
  progressKey: string;
  targetApi: string;
  order: number;
};

export const workflowStepConfigs: WorkflowStepConfig[] = [
  {
    key: "extractOriginalAssets",
    label: "提取原始资产",
    description: "从剧本中提取角色、场景、道具等原始资产。",
    progressKey: "originalAssets",
    targetApi: "/api/script/extractAssets",
    order: 10,
  },
  {
    key: "polishOriginalAssetPrompts",
    label: "润色原始资产提示词",
    description: "根据项目画风和资产描述补全原始资产生成提示词。",
    progressKey: "originalAssetPrompts",
    targetApi: "/api/assetsGenerate/batchPolishAssetsPrompt",
    order: 20,
  },
  {
    key: "generateOriginalAssetImages",
    label: "生成原始资产图",
    description: "批量生成原始角色、场景、道具图片。",
    progressKey: "originalAssetImages",
    targetApi: "/api/assetsGenerate/batchGenerateImageAssets",
    order: 30,
  },
  {
    key: "generateDerivedAssets",
    label: "生成衍生资产",
    description: "根据原始资产、剧本和分镜上下文生成衍生资产建议。",
    progressKey: "derivedAssets",
    targetApi: "/api/production/workflow/generateDerivedAssets",
    order: 40,
  },
  {
    key: "polishDerivedAssetPrompts",
    label: "润色衍生资产提示词",
    description: "根据父级资产和衍生资产描述补全衍生资产提示词。",
    progressKey: "derivedAssetPrompts",
    targetApi: "/api/assetsGenerate/batchPolishAssetsPrompt",
    order: 50,
  },
  {
    key: "generateDerivedAssetImages",
    label: "生成衍生资产图",
    description: "批量生成衍生角色、场景、道具图片。",
    progressKey: "derivedAssetImages",
    targetApi: "/api/production/assets/batchGenerateAssetsImage",
    order: 60,
  },
  {
    key: "generateStoryboardImages",
    label: "生成分镜图",
    description: "根据分镜面板和关联资产生成分镜图片。",
    progressKey: "storyboardImages",
    targetApi: "/api/production/storyboard/batchGenerateImage",
    order: 70,
  },
  {
    key: "generateVideoPrompts",
    label: "生成视频提示词",
    description: "按视频轨道整合分镜和资产信息，生成视频模型提示词。",
    progressKey: "videoPrompts",
    targetApi: "/api/production/workbench/batchGeneratePrompt",
    order: 80,
  },
  {
    key: "generateVideos",
    label: "生成视频",
    description: "按视频轨道提交视频生成任务。",
    progressKey: "videos",
    targetApi: "/api/production/workbench/batchGenerateVideo",
    order: 90,
  },
];

export const workflowStepTargetApiMap = workflowStepConfigs.reduce<Record<WorkflowStep, string>>(
  (result, item) => {
    result[item.key] = item.targetApi;
    return result;
  },
  {} as Record<WorkflowStep, string>,
);

export function getWorkflowStepTargetApi(step: WorkflowStep) {
  return workflowStepTargetApiMap[step];
}
