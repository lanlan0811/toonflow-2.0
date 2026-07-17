import u from "@/utils";
import { ProjectTypes } from "@/constants/project";
import {
  ensureProductFactoryConfig,
  ensureProductWorkflow,
  upsertProductFactoryItem,
  updateProductWorkflow,
} from "@/lib/productFactory/service";
import { LEGACY_PROMO_MARKER, PRODUCT_FACTORY_MARKER } from "@/lib/productFactory/types";

interface LegacyNode {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
  position?: { x?: number; y?: number };
}

function legacyNodes(value: unknown): LegacyNode[] {
  if (!value || typeof value !== "object") return [];
  const nodes = (value as { nodes?: unknown }).nodes;
  return Array.isArray(nodes) ? nodes.filter((node): node is LegacyNode => Boolean(node && typeof node === "object")) : [];
}

function isLegacyBuiltInPrompt(node: LegacyNode, project: { intro?: string | null }) {
  const prompt = typeof node.data?.prompt === "string" ? node.data.prompt.trim() : "";
  if (!prompt) return true;
  const description = String(project.intro || "").split("\n").slice(1).join("\n").trim();
  if (node.type === "image") {
    return prompt.startsWith("【制作目标】为企业品牌宣传片制作可直接用于商业发布的产品主视觉关键帧") ||
      [description, "突出产品主体，商业摄影质感，细节清晰，光影高级", "商业产品摄影，主体清晰，光影精致"].filter(Boolean).includes(prompt);
  }
  const subject = description || "产品展示";
  return prompt.startsWith("【制作目标】制作一条企业生产级的单镜头产品宣传片") ||
    [
      `${subject}。镜头运动自然，突出产品卖点，商业宣传片质感。`,
      `${subject}。镜头运动流畅，突出产品主体与质感。`,
      "产品展示。镜头运动自然，突出产品卖点，商业宣传片质感。",
      "产品展示。镜头运动流畅，突出产品主体与质感。",
    ].includes(prompt);
}

export async function importLegacyProductPromo(projectId: number, legacyCanvas?: unknown) {
  const project = await u.db("o_project").where("id", projectId).first();
  if (!project) throw new Error("项目不存在");
  const isLegacy = String(project.intro || "").includes(LEGACY_PROMO_MARKER);
  if (project.projectType !== ProjectTypes.commerce && !isLegacy) throw new Error("项目不是可迁移的旧产品宣传片");
  if (project.projectType !== ProjectTypes.commerce) {
    const description = String(project.intro || "").split("\n").slice(1).join("\n").trim();
    await u.db("o_project").where("id", projectId).update({
      projectType: ProjectTypes.commerce,
      intro: `${PRODUCT_FACTORY_MARKER}\n${description}`.trim(),
    });
  }
  const config = await ensureProductFactoryConfig(projectId);
  const existing = await u.db("o_productFactoryItem").where({ projectId, sku: `LEGACY-${projectId}` }).first();
  const item = existing || await upsertProductFactoryItem(projectId, {
    sku: `LEGACY-${projectId}`,
    name: project.name || `旧产品宣传片 ${projectId}`,
    description: "由旧版产品宣传片自动迁移",
  });
  const productId = Number(item.id);
  const workflow = await ensureProductWorkflow(projectId, productId);
  const nodes = legacyNodes(legacyCanvas);
  const imageNode = nodes.find((node) => node.type === "image");
  const videoNode = nodes.find((node) => node.type === "video");
  const uploadNode = nodes.find((node) => node.type === "upload");
  if (nodes.length) {
    const source = workflow.graph.nodes.find((node) => node.type === "source");
    if (source) source.data.legacy = { nodeId: uploadNode?.id, url: uploadNode?.data?.url || "", migratedAt: Date.now() };
    for (const target of workflow.graph.nodes.filter((node) => node.type === "image")) {
      const prompt = typeof imageNode?.data?.prompt === "string" ? imageNode.data.prompt.trim() : "";
      if (prompt && imageNode && !isLegacyBuiltInPrompt(imageNode, project)) {
        target.data.promptOverride = { creative: prompt };
        target.data.promptCustomized = true;
      }
    }
    for (const target of workflow.graph.nodes.filter((node) => node.type === "video")) {
      const prompt = typeof videoNode?.data?.prompt === "string" ? videoNode.data.prompt.trim() : "";
      if (prompt && videoNode && !isLegacyBuiltInPrompt(videoNode, project)) {
        target.data.promptOverride = { creative: prompt };
        target.data.promptCustomized = true;
      }
    }
    await updateProductWorkflow(projectId, productId, workflow.graph, true);
  }
  let importedArtifacts = 0;
  const legacyMedia: Array<{ mediaType: "image" | "video"; filePath: string; prompt: string; model: string; aspectRatio: string; sourceId: string }> = nodes
    .filter((candidate) => candidate.type === "image" || candidate.type === "video")
    .map((node) => ({
      mediaType: node.type === "video" ? "video" : "image",
      filePath: u.replaceUrl(String(node.data?.resultUrl || "")),
      prompt: String(node.data?.prompt || "旧版提示词"),
      model: String(node.data?.model || (node.type === "video" ? project.videoModel : project.imageModel) || "legacy"),
      aspectRatio: String(node.data?.ratio || project.videoRatio || "16:9"),
      sourceId: String(node.id || node.type),
    }));
  const [databaseImages, databaseVideos] = await Promise.all([
    u.db("o_assets").where("o_assets.projectId", projectId).leftJoin("o_image", "o_assets.imageId", "o_image.id").whereNotNull("o_image.filePath").select("o_image.id", "o_image.filePath", "o_image.model"),
    u.db("o_video").where("projectId", projectId).whereNotNull("filePath").select("id", "filePath", "model"),
  ]);
  legacyMedia.push(
    ...databaseImages.map((row) => ({ mediaType: "image" as const, filePath: row.filePath || "", prompt: "旧版数据库图片", model: row.model || project.imageModel || "legacy", aspectRatio: project.videoRatio || "16:9", sourceId: `db-image-${row.id}` })),
    ...databaseVideos.map((row) => ({ mediaType: "video" as const, filePath: row.filePath || "", prompt: "旧版数据库视频", model: row.model || project.videoModel || "legacy", aspectRatio: project.videoRatio || "16:9", sourceId: `db-video-${row.id}` })),
  );
  for (const media of legacyMedia) {
    const filePath = u.replaceUrl(media.filePath);
    if (!filePath || !(await u.oss.fileExists(filePath))) continue;
    const duplicate = await u.db("o_productFactoryArtifact").where({ projectId, productId, filePath }).first();
    if (duplicate) continue;
    const timestamp = Date.now();
    await u.db("o_productFactoryArtifact").insert({
      projectId,
      productId,
      jobId: null,
      mediaType: media.mediaType,
      slotKey: "legacy",
      aspectRatio: media.aspectRatio,
      version: 1,
      templateId: "pf.legacy.v1",
      templateVersion: 1,
      promptLanguage: null,
      promptSections: null,
      prompt: media.prompt,
      model: media.model,
      params: JSON.stringify({ migrated: true, legacySourceId: media.sourceId }),
      inputSignature: `legacy:${projectId}:${media.sourceId}:${filePath}`,
      inputArtifactIds: "[]",
      filePath,
      state: "success",
      errorReason: null,
      approved: media.mediaType === "image" ? 1 : 0,
      isCurrent: 1,
      inputChanged: 0,
      createTime: timestamp,
      updateTime: timestamp,
    });
    importedArtifacts += 1;
  }
  await u.db("o_productFactoryConfig").where("projectId", projectId).update({ migrationVersion: 1, updateTime: Date.now() });
  return {
    projectId,
    productId,
    migrated: Number(config.migrationVersion || 0) < 1,
    importedArtifacts,
    warning: nodes.length ? null : `未收到旧版 localStorage 画布，已迁移可定位的数据库媒体 ${importedArtifacts} 个`,
  };
}
