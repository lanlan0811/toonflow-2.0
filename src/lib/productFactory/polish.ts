import u from "@/utils";
import {
  compilePromptForProduct,
  type ProductFactoryPromptRequest,
} from "@/lib/productFactory/service";

const EDITABLE_SECTION_KEYS = ["goal", "creative", "craft"] as const;

export async function polishProductFactoryPrompt(request: ProductFactoryPromptRequest) {
  const deployment = await u.db("o_agentDeploy").where("key", "universalAi").first();
  if (!deployment?.modelName) throw new Error("未配置 universalAi；内置商品提示词仍可直接使用");
  const compiled = await compilePromptForProduct(request);
  const editable = Object.fromEntries(
    EDITABLE_SECTION_KEYS.map((key) => [key, compiled.result.sections[key]]),
  ) as Record<(typeof EDITABLE_SECTION_KEYS)[number], string>;
  const response = await u.Ai.Text("universalAi").invoke({
    prompt: `你是商品商业视觉提示词编辑器。只润色以下 JSON 中 goal、creative、craft 三个字段，不增加未经确认的商品功能、参数、认证、文字或品牌，不修改商品事实。保持原语言，返回严格 JSON，不要 Markdown。\n${JSON.stringify(editable)}`,
  });
  let parsed: Record<string, unknown>;
  try {
    const clean = String(response.text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("AI 润色返回格式无效，请重试；原提示词未被修改");
  }
  const candidate = Object.fromEntries(
    EDITABLE_SECTION_KEYS.map((key) => [key, typeof parsed[key] === "string" ? parsed[key].trim() || editable[key] : editable[key]]),
  ) as Record<(typeof EDITABLE_SECTION_KEYS)[number], string>;
  return {
    original: editable,
    candidate,
    lockedSections: Object.fromEntries(compiled.result.lockedSectionKeys.map((key) => [key, compiled.result.sections[key]])),
  };
}
