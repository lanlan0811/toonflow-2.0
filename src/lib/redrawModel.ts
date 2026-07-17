import { redrawAgentConfigs, type RedrawAgentKey } from "@/constants/redraw";
import u from "@/utils";

type Capability = "text" | "image" | "video" | "audio" | "toolCalling";

export async function getConfiguredModel(modelId: string) {
  const [vendorId, modelName] = modelId.split(/:(.+)/);
  if (!vendorId || !modelName) throw new Error(`模型配置格式无效：${modelId || "未配置"}`);
  const models = await u.vendor.getModelList(vendorId);
  const model = models.find((item: any) => item.modelName === modelName);
  if (!model) throw new Error(`未找到模型：${modelId}`);
  return { vendorId, model: model as any };
}

export function getInputCapabilities(model: any): Set<Capability> {
  const result = new Set<Capability>();
  if (model?.type === "text") result.add("text");
  for (const value of model?.inputCapabilities ?? []) result.add(value as Capability);
  if (model?.toolCalling === true) result.add("toolCalling");
  return result;
}

export async function assertRedrawAgentModel(agentKey: string, modelId: string) {
  const config = redrawAgentConfigs.find((item) => item.key === agentKey);
  if (!config || !modelId) return;
  const { model } = await getConfiguredModel(modelId);
  if (model.type !== "text") throw new Error(`${config.name} 必须绑定文本/多模态语言模型`);
  const actual = getInputCapabilities(model);
  const missing = config.capabilities.filter((capability) => !actual.has(capability));
  if (missing.length) throw new Error(`${config.name} 所选模型缺少能力：${missing.join("、")}`);
}

export async function assertResolvedRedrawAgentModel(agentKey: RedrawAgentKey) {
  const mode = await u.db("o_setting").where("key", "agentUseMode").first();
  const configKey = mode?.value === "1" ? agentKey : "redrawAgent";
  const deployment = await u.db("o_agentDeploy").where("key", configKey).first();
  if (!deployment?.modelName) throw new Error(`${configKey} 尚未配置模型`);
  await assertRedrawAgentModel(agentKey, deployment.modelName);
  return deployment.modelName as string;
}

export function hasReferenceMode(model: any, prefix: "videoReference:" | "imageReference:") {
  const modes = (model?.mode ?? []).flat(Infinity).filter((item: unknown) => typeof item === "string") as string[];
  return modes.some((mode) => mode.startsWith(prefix) && Number(mode.slice(prefix.length)) > 0);
}

export async function assertRedrawProjectModels(imageModelId: string, videoModelId: string) {
  const { model: imageModel } = await getConfiguredModel(imageModelId);
  if (imageModel.type !== "image") throw new Error("转绘项目必须选择图片生成模型");
  if (!(imageModel.mode ?? []).includes("multiReference")) throw new Error("转绘图片模型必须支持 multiReference 多参考图输入");

  const { model: videoModel } = await getConfiguredModel(videoModelId);
  if (videoModel.type !== "video") throw new Error("转绘项目必须选择视频生成模型");
  if (!hasReferenceMode(videoModel, "videoReference:")) throw new Error("转绘视频模型必须在 mode 中声明 videoReference:N 能力");
}
