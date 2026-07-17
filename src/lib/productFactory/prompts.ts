import crypto from "crypto";
import {
  PRODUCT_PROMPT_TEMPLATE_VERSION,
  type ArtifactSlot,
  type ProductFactoryPromptResult,
  type ProductFactoryPromptSections,
  type PromptLanguage,
} from "@/lib/productFactory/types";

export interface PromptCompileInput {
  mediaType: "image" | "video";
  slotKey: ArtifactSlot;
  aspectRatio: string;
  model: string;
  size?: "1K" | "2K" | "4K";
  mode?: string | string[];
  duration?: number;
  resolution?: string;
  audio?: boolean;
  brandName?: string | null;
  campaignBrief?: string | null;
  visualTone?: string | null;
  forbiddenContent?: string | null;
  sku: string;
  productName: string;
  category?: string | null;
  description?: string | null;
  sellingPoints?: string[];
  attributes?: Record<string, unknown>;
  referenceLabels?: string[];
  promptLanguage?: PromptLanguage;
  overrides?: Partial<ProductFactoryPromptSections>;
}

const IMAGE_CREATIVE_ZH: Record<string, string> = {
  main_clean: "仅呈现一个完整商品，使用干净的浅色或中性背景，商品轮廓完整、透视准确、居中且留有自然呼吸空间；不添加装饰道具。",
  scene_studio: "将商品置于克制高级的专业棚拍环境，使用简洁台面与少量几何背景，形成稳定英雄构图和真实接触阴影，所有陪衬必须弱于商品主体。",
  scene_lifestyle: "基于商品类别构建真实可信的使用环境，环境与道具只用于说明商品定位，不遮挡商品，不添加人物、手部或未经提供的使用效果。",
  scene_detail: "使用可信的近景或微距构图，只强调参考图中真实可见的材质、接口、纹理、边缘或工艺细节，不展示或虚构不可见内部结构。",
};

const IMAGE_CREATIVE_EN: Record<string, string> = {
  main_clean: "Show exactly one complete product on a clean light or neutral background. Preserve the full silhouette and correct perspective, keep a balanced centered composition, and add no decorative props.",
  scene_studio: "Place the product in a restrained premium studio setup with a simple surface and minimal geometric background. Use a stable hero composition and a physically plausible contact shadow; every supporting element must remain subordinate.",
  scene_lifestyle: "Build a plausible usage environment from the product category. The environment and props may explain positioning but must never obscure the product. Do not add people, hands, or unverified usage effects.",
  scene_detail: "Use a credible close-up or macro composition to emphasize only materials, ports, textures, edges, or craftsmanship that are visibly supported by the references. Never invent hidden internal structures.",
};

const VIDEO_CREATIVE_ZH: Record<string, string> = {
  video_hero: "商品保持静止且始终位于视觉中心，只使用缓慢推进或小幅平滑环绕中的一种主运镜，展示轮廓、材质与真实反射，结尾回到清晰稳定的英雄定帧。",
  video_lifestyle: "商品始终为视觉中心，环境只发生轻微、真实、连续的自然运动；镜头使用单一平滑运镜建立使用氛围，但不演示未经商品资料确认的功能或效果。",
};

const VIDEO_CREATIVE_EN: Record<string, string> = {
  video_hero: "Keep the product stationary and visually dominant. Use one primary camera move only: either a slow push-in or a subtle smooth orbit. Reveal the silhouette, materials, and realistic reflections, then finish on a sharp stable hero frame.",
  video_lifestyle: "Keep the product as the visual focus while the environment shows only subtle, physically plausible, continuous motion. Use one smooth camera move to establish context without demonstrating any unverified feature or effect.",
};

function compact(values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean).join("；");
}

function normalizedMode(value: PromptCompileInput["mode"]) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return "singleImage";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function videoModeInstruction(input: PromptCompileInput, language: "zh" | "en") {
  const mode = normalizedMode(input.mode);
  const isMultiReference = Array.isArray(mode) && mode.some((entry) => typeof entry === "string" && entry.startsWith("imageReference:"));
  if (isMultiReference) {
    return language === "zh"
      ? "按提交顺序绑定商品和场景参考，所有参考只用于身份与视觉一致性，不得混合或复制不同参考中的商品；引用数量不得超过模型上限。"
      : "Bind product and scene references in submission order. Use every reference only for identity and visual consistency; never merge or duplicate products across references, and stay within the model reference limit.";
  }
  if (mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional") {
    const requiredSameFrame = mode === "startEndRequired";
    return language === "zh"
      ? requiredSameFrame
        ? "将同一张已批准图片同时绑定为首帧和尾帧，镜头在中间完成连续运动并自然回到一致定帧；商品不得变形、换色或增减部件。"
        : "将已批准图片作为首帧；仅在确实提交尾帧时才约束尾帧，首尾之间必须连续过渡，商品不得变形、换色或增减部件。"
      : requiredSameFrame
        ? "Bind the same approved image as both the start and end frame. Complete a continuous camera move between them and return naturally to the matching hold without deformation, color shifts, or added or missing parts."
        : "Use the approved image as the first frame. Constrain an end frame only when one is actually supplied, and maintain a continuous transition without deformation, color shifts, or added or missing parts.";
  }
  return language === "zh"
    ? "将已批准图片作为首帧和商品身份依据，不描述或假定不存在的尾帧。"
    : "Use the approved image as both the first frame and product identity reference; do not describe or assume an end frame that was not supplied.";
}

export function resolvePromptLanguage(model: string, declared?: PromptLanguage): PromptLanguage {
  if (declared) return declared;
  const value = model.toLowerCase();
  if (/(seedance|seedream|wan|kling|vidu|doubao|jimeng|可灵|即梦|万相)/i.test(value)) return "zh";
  if (/(openai|gpt-image|flux|runway|luma|midjourney)/i.test(value)) return "en";
  return "bilingual";
}

function buildFacts(input: PromptCompileInput, language: PromptLanguage) {
  const attributes = Object.entries(input.attributes || {}).map(([key, value]) => `${key}: ${String(value)}`);
  const refs = input.referenceLabels?.length ? input.referenceLabels.join("、") : language === "en" ? "the supplied product references" : "已提供的商品参考图";
  const zh = compact([
    `SKU：${input.sku}`,
    `商品：${input.productName}`,
    input.category && `类别：${input.category}`,
    input.description && `已确认描述：${input.description}`,
    input.sellingPoints?.length && `已确认卖点：${input.sellingPoints.join("、")}`,
    attributes.length && `已确认属性：${attributes.join("、")}`,
    `事实依据：${refs}`,
  ]);
  const en = compact([
    `SKU: ${input.sku}`,
    `Product: ${input.productName}`,
    input.category && `Category: ${input.category}`,
    input.description && `Confirmed description: ${input.description}`,
    input.sellingPoints?.length && `Confirmed selling points: ${input.sellingPoints.join(", ")}`,
    attributes.length && `Confirmed attributes: ${attributes.join(", ")}`,
    `Ground truth: ${refs}`,
  ]);
  return language === "zh" ? zh : language === "en" ? en : `${zh}\n${en}`;
}

function buildSections(input: PromptCompileInput, language: PromptLanguage): ProductFactoryPromptSections {
  const isImage = input.mediaType === "image";
  const brandZh = compact([
    input.brandName && `品牌：${input.brandName}`,
    input.campaignBrief && `活动目标：${input.campaignBrief}`,
    input.visualTone && `视觉基调：${input.visualTone}`,
    input.forbiddenContent && `额外禁用内容：${input.forbiddenContent}`,
  ]) || "保持专业、克制、可信的商业视觉，不添加未经提供的品牌元素。";
  const brandEn = compact([
    input.brandName && `Brand: ${input.brandName}`,
    input.campaignBrief && `Campaign objective: ${input.campaignBrief}`,
    input.visualTone && `Visual direction: ${input.visualTone}`,
    input.forbiddenContent && `Additional exclusions: ${input.forbiddenContent}`,
  ]) || "Maintain a professional, restrained, credible commercial look. Add no brand element that was not supplied.";

  const goalZh = isImage
    ? `生成可用于电商与品牌传播的高质量商品视觉，输出比例 ${input.aspectRatio}，目标画质 ${input.size || "2K"}，商品清晰可信。`
    : `生成一条独立的单镜头商品短视频，比例 ${input.aspectRatio}，${input.resolution || "720p"}，约 ${input.duration || 5} 秒。`;
  const goalEn = isImage
    ? `Create a high-quality product visual for ecommerce and brand use in ${input.aspectRatio} at ${input.size || "2K"} target quality, with a clear and credible product presentation.`
    : `Create one independent single-shot product clip in ${input.aspectRatio}, ${input.resolution || "720p"}, approximately ${input.duration || 5} seconds.`;

  const identityZh = "参考图中的商品是唯一事实来源。严格保持商品数量、结构、比例、颜色、材质、包装、接口、标签位置和可见品牌标识；不得增加、删除、替换或重画任何产品部件，不得虚构功能、参数、认证或使用效果。";
  const identityEn = "The referenced product is the only source of truth. Preserve its count, structure, proportions, colors, materials, packaging, ports, label placement, and visible brand marks. Never add, remove, replace, or redesign a component, and never invent a feature, specification, certification, or performance claim.";

  const creativeZh = isImage ? IMAGE_CREATIVE_ZH[input.slotKey] || IMAGE_CREATIVE_ZH.main_clean : VIDEO_CREATIVE_ZH[input.slotKey] || VIDEO_CREATIVE_ZH.video_hero;
  const creativeEn = isImage ? IMAGE_CREATIVE_EN[input.slotKey] || IMAGE_CREATIVE_EN.main_clean : VIDEO_CREATIVE_EN[input.slotKey] || VIDEO_CREATIVE_EN.video_hero;

  const craftZh = isImage
    ? "使用专业商业摄影的受控光线、真实接触阴影、准确透视与自然动态范围；材质反射应符合物理规律，边缘干净，细节锐利但不过度锐化。"
    : `参考图作为商品身份与开始状态依据。${videoModeInstruction(input, "zh")}全片只使用一种主要运镜，运动路径平滑可控；曝光、白平衡、景深、边缘和材质反射保持连续。${/(seedance|wan|kling|vidu|runway)/i.test(input.model) ? "按开场、主体展示、结尾定帧的顺序组织时序，结尾稳定停留。" : "按自然先后顺序描述动作，结尾保留稳定可停留的商品定帧。"}${input.audio ? "不使用对白，仅允许克制的真实环境声。" : "不要生成对白、配乐或额外音效。"}`;
  const craftEn = isImage
    ? "Use controlled professional commercial lighting, a physically plausible contact shadow, correct perspective, and natural dynamic range. Material reflections must follow physical behavior; keep edges clean and details sharp without oversharpening."
    : `Use the reference as the product identity and starting state. ${videoModeInstruction(input, "en")} Use one primary camera move only with a smooth controlled path. Keep exposure, white balance, depth of field, edges, and material reflections continuous. ${/(seedance|wan|kling|vidu|runway)/i.test(input.model) ? "Structure the timing as opening, main product reveal, and final stable hold." : "Describe actions in natural sequence and finish with a stable hold on the product."}${input.audio ? " Use no speech; only restrained, realistic ambient sound is allowed." : " Generate no speech, music, or additional sound effects."}`;

  const brandProtectZh = `${brandZh}。保留参考图中真实存在且清晰可见的 Logo；看不清的文字不得擅自补写。不要生成额外标签、标题、价格、字幕、水印或新 Logo。`;
  const brandProtectEn = `${brandEn} Preserve only the real, clearly visible logo from the references; never reconstruct illegible text. Generate no additional label, headline, price, subtitle, watermark, or new logo.`;

  const qualityZh = isImage
    ? "禁止重复商品、结构变形、漂浮、穿插、错误透视、廉价塑料感、脏污边缘、过曝、死黑、噪点、模糊、锯齿和无关元素。"
    : "禁止商品融化、闪烁、漂移、重影、复制、突然缩放、镜头跳切、部件增减、穿模、透视突变、背景突变、错误文字、字幕和水印。";
  const qualityEn = isImage
    ? "Avoid duplicate products, structural deformation, floating, intersections, incorrect perspective, cheap plastic appearance, dirty edges, clipping, crushed blacks, noise, blur, aliasing, and unrelated elements."
    : "Avoid melting, flicker, drift, ghosting, duplication, sudden zooms, jump cuts, added or missing parts, intersections, perspective shifts, background discontinuity, incorrect text, subtitles, and watermarks.";

  const choose = (zh: string, en: string) => language === "zh" ? zh : language === "en" ? en : `${zh}\n${en}`;
  return {
    goal: choose(goalZh, goalEn),
    facts: buildFacts(input, language),
    identity: choose(identityZh, identityEn),
    creative: choose(creativeZh, creativeEn),
    craft: choose(craftZh, craftEn),
    brand: choose(brandProtectZh, brandProtectEn),
    quality: choose(qualityZh, qualityEn),
  };
}

function compileSections(sections: ProductFactoryPromptSections) {
  const labels: Record<keyof ProductFactoryPromptSections, string> = {
    goal: "Goal / 制作目标",
    facts: "Product facts / 商品事实",
    identity: "Identity lock / 主体锁定",
    creative: "Creative direction / 创意方向",
    craft: "Craft / 制作要求",
    brand: "Brand protection / 品牌保护",
    quality: "Quality guardrails / 质量限制",
  };
  return (Object.keys(labels) as (keyof ProductFactoryPromptSections)[]).map((key) => `[${labels[key]}]\n${sections[key]}`).join("\n\n");
}

export function compileProductPrompt(input: PromptCompileInput): ProductFactoryPromptResult {
  const language = resolvePromptLanguage(input.model, input.promptLanguage);
  const base = buildSections(input, language);
  const editable = ["goal", "creative", "craft"] as (keyof ProductFactoryPromptSections)[];
  for (const key of editable) {
    const value = input.overrides?.[key];
    if (typeof value === "string" && value.trim()) base[key] = value.trim();
  }
  return {
    templateId: `pf.${input.mediaType}.${input.slotKey}.v${PRODUCT_PROMPT_TEMPLATE_VERSION}`,
    templateVersion: PRODUCT_PROMPT_TEMPLATE_VERSION,
    language,
    sections: base,
    editableSectionKeys: editable,
    lockedSectionKeys: ["facts", "identity", "brand", "quality"],
    compiledPrompt: compileSections(base),
  };
}

export function promptInputSignature(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
