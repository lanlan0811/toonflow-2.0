import u from "@/utils";
import { ProjectTypes } from "@/constants/project";
import { compileProductPrompt, promptInputSignature, type PromptCompileInput } from "@/lib/productFactory/prompts";
import {
  DEFAULT_PRODUCT_FACTORY_PACK,
  LEGACY_PROMO_MARKER,
  PRODUCT_FACTORY_MARKER,
  safeJsonParse,
  type ProductFactoryGraph,
  type ProductFactoryItemState,
  type ProductFactoryPack,
  type ProductFactoryPromptSections,
  type PromptLanguage,
} from "@/lib/productFactory/types";
import { createDefaultProductWorkflow, normalizeFactoryPack, validateProductWorkflow } from "@/lib/productFactory/workflow";

export interface ProductFactoryConfigInput {
  brandName?: string | null;
  campaignBrief?: string | null;
  visualTone?: string | null;
  forbiddenContent?: string | null;
  defaultPack?: Partial<ProductFactoryPack>;
  promptPolicy?: Record<string, unknown>;
  imageConcurrency?: number;
  videoConcurrency?: number;
}

export interface ProductFactoryItemInput {
  id?: number;
  sku: string;
  name: string;
  category?: string | null;
  description?: string | null;
  sellingPoints?: string[] | string | null;
  attributes?: Record<string, unknown> | string | null;
}

export interface ProductFactoryPromptRequest {
  projectId: number;
  productId: number;
  mediaType: "image" | "video";
  slotKey: string;
  aspectRatio: string;
  overrides?: Partial<ProductFactoryPromptSections>;
  runtime?: { mode?: string | string[]; duration?: number; resolution?: string; audio?: boolean };
}

export interface ProductFactoryModelMetadata {
  promptLanguage?: PromptLanguage;
  maxReferenceImages: number;
  modes: unknown[];
  raw: Record<string, unknown> | null;
}

function referenceLimitFromModes(modes: unknown[]) {
  let limit = 0;
  for (const mode of modes) {
    if (mode === "multiReference") limit = Math.max(limit, 10);
    if (!Array.isArray(mode)) continue;
    for (const entry of mode) {
      const match = typeof entry === "string" ? entry.match(/^imageReference:(\d+)$/) : null;
      if (match) limit = Math.max(limit, Number(match[1]));
    }
  }
  return limit;
}

export function modelSupportsProductReference(metadata: ProductFactoryModelMetadata, type: "image" | "video") {
  if (!metadata.raw) return true;
  if (typeof metadata.raw.type === "string" && metadata.raw.type !== type) return false;
  if (!metadata.modes.length) return true;
  if (type === "image") return metadata.modes.some((mode) => mode === "singleImage" || mode === "multiReference");
  return metadata.modes.some((mode) =>
    mode === "singleImage" || mode === "startFrameOptional" || mode === "endFrameOptional" || mode === "startEndRequired" ||
    (Array.isArray(mode) && mode.some((entry) => typeof entry === "string" && entry.startsWith("imageReference:"))),
  );
}

const defaultPromptPolicy = {
  templateVersion: 2,
  aiPolish: false,
  protectFacts: true,
};

const modelMetadataCache = new Map<string, { expiresAt: number; value: ProductFactoryModelMetadata }>();

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sellingPointsFromRow(value: unknown) {
  const parsed = safeJsonParse<unknown>(value, null);
  if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  return normalizeString(value).split(/[|\n]/).map((item) => item.trim()).filter(Boolean);
}

function attributesFromRow(value: unknown) {
  const parsed = safeJsonParse<Record<string, unknown>>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export async function requireProductFactoryProject(projectId: number, allowLegacy = false) {
  const project = await u.db("o_project").where("id", projectId).first();
  if (!project) throw new Error("项目不存在");
  const legacy = normalizeString(project.intro).includes(LEGACY_PROMO_MARKER);
  if (project.projectType !== ProjectTypes.commerce && !(allowLegacy && legacy)) throw new Error("该项目不是商品视觉工厂项目");
  return project;
}

export async function ensureProductFactoryConfig(projectId: number) {
  await requireProductFactoryProject(projectId, true);
  let config = await u.db("o_productFactoryConfig").where("projectId", projectId).first();
  if (!config) {
    const timestamp = Date.now();
    await u.db("o_productFactoryConfig").insert({
      projectId,
      brandName: "",
      campaignBrief: "",
      visualTone: "高级、克制、真实的商业摄影",
      forbiddenContent: "",
      defaultPack: JSON.stringify(DEFAULT_PRODUCT_FACTORY_PACK),
      promptPolicy: JSON.stringify(defaultPromptPolicy),
      imageConcurrency: 2,
      videoConcurrency: 1,
      migrationVersion: 0,
      createTime: timestamp,
      updateTime: timestamp,
    });
    config = await u.db("o_productFactoryConfig").where("projectId", projectId).first();
  }
  if (!config) throw new Error("商品视觉工厂配置初始化失败");
  return config;
}

export async function getProductFactoryModelMetadata(modelValue: string): Promise<ProductFactoryModelMetadata> {
  const cacheKey = normalizeString(modelValue);
  const cached = modelMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [vendorId, modelName] = normalizeString(modelValue).split(/:(.+)/);
  if (!vendorId || !modelName) return { maxReferenceImages: 1, modes: [], raw: null };
  try {
    const models = await u.vendor.getModelList(vendorId);
    const raw = (models.find((item: any) => item.modelName === modelName) || null) as Record<string, unknown> | null;
    const declaredLanguage = raw?.promptLanguage;
    const promptLanguage = declaredLanguage === "zh" || declaredLanguage === "en" || declaredLanguage === "bilingual" ? declaredLanguage : undefined;
    const modes = Array.isArray(raw?.mode) ? raw.mode : Array.isArray(raw?.modes) ? raw.modes : [];
    const inferredLimit = referenceLimitFromModes(modes);
    const maxReferenceImages = clampInt(
      raw?.maxReferenceImages ?? raw?.referenceImageMax ?? raw?.maxImages ?? raw?.imageMax ?? inferredLimit,
      1,
      10,
      1,
    );
    const value: ProductFactoryModelMetadata = { promptLanguage, maxReferenceImages, modes, raw };
    modelMetadataCache.set(cacheKey, { expiresAt: Date.now() + 5_000, value });
    return value;
  } catch {
    return { maxReferenceImages: 1, modes: [], raw: null };
  }
}

export async function getProductFactoryWorkspace(projectId: number) {
  const project = await requireProductFactoryProject(projectId, true);
  const config = await ensureProductFactoryConfig(projectId);
  const brandReferenceRows = await u.db("o_productFactoryReference").where({ projectId, scope: "brand" }).orderBy("sortIndex", "asc");
  const universalAi = await u.db("o_agentDeploy").where("key", "universalAi").first();
  const counts = await u.db("o_productFactoryItem")
    .where("projectId", projectId)
    .select("state")
    .count({ count: "id" })
    .groupBy("state");
  return {
    marker: PRODUCT_FACTORY_MARKER,
    project,
    config: {
      ...config,
      defaultPack: normalizeFactoryPack(safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK)),
      promptPolicy: safeJsonParse(config.promptPolicy, defaultPromptPolicy),
    },
    brandReferences: await Promise.all(brandReferenceRows.map(async (reference) => ({ ...reference, url: await u.oss.getFileUrl(reference.filePath) }))),
    aiPolishAvailable: Boolean(universalAi?.modelName),
    counts: Object.fromEntries(counts.map((item: any) => [item.state, Number(item.count)])),
  };
}

export async function markProductFactoryArtifactsInputChanged(projectId: number, productIds?: number[]) {
  let query = u.db("o_productFactoryArtifact").where({ projectId, state: "success", inputChanged: 0 });
  const ids = [...new Set((productIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length) query = query.whereIn("productId", ids);
  return query.update({ inputChanged: 1, updateTime: Date.now() });
}

export async function updateProductFactoryWorkspace(projectId: number, input: ProductFactoryConfigInput) {
  const current = await ensureProductFactoryConfig(projectId);
  const patch = {
    brandName: input.brandName === undefined ? current.brandName : normalizeString(input.brandName),
    campaignBrief: input.campaignBrief === undefined ? current.campaignBrief : normalizeString(input.campaignBrief),
    visualTone: input.visualTone === undefined ? current.visualTone : normalizeString(input.visualTone),
    forbiddenContent: input.forbiddenContent === undefined ? current.forbiddenContent : normalizeString(input.forbiddenContent),
    defaultPack: input.defaultPack === undefined
      ? current.defaultPack
      : JSON.stringify(normalizeFactoryPack({ ...safeJsonParse(current.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK), ...input.defaultPack })),
    promptPolicy: input.promptPolicy === undefined
      ? current.promptPolicy
      : JSON.stringify({ ...safeJsonParse(current.promptPolicy, defaultPromptPolicy), ...input.promptPolicy }),
    imageConcurrency: input.imageConcurrency === undefined ? current.imageConcurrency : clampInt(input.imageConcurrency, 1, 5, 2),
    videoConcurrency: input.videoConcurrency === undefined ? current.videoConcurrency : clampInt(input.videoConcurrency, 1, 2, 1),
    updateTime: Date.now(),
  };
  const generationInputsChanged = ["brandName", "campaignBrief", "visualTone", "forbiddenContent", "defaultPack", "promptPolicy"]
    .some((key) => String((current as any)[key] ?? "") !== String((patch as any)[key] ?? ""));
  await u.db("o_productFactoryConfig").where("projectId", projectId).update(patch);
  if (generationInputsChanged) await markProductFactoryArtifactsInputChanged(projectId);

  if (input.defaultPack !== undefined) {
    const workflows = await u.db("o_productFactoryWorkflow").where({ projectId, customized: 0 }).select("productId");
    for (const workflow of workflows) {
      await u.db("o_productFactoryWorkflow").where({ projectId, productId: workflow.productId }).update({
        graphData: JSON.stringify(createDefaultProductWorkflow(Number(workflow.productId), safeJsonParse(patch.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK))),
        version: 1,
        updateTime: Date.now(),
      });
    }
  }
  return getProductFactoryWorkspace(projectId);
}

export async function ensureProductWorkflow(projectId: number, productId: number) {
  const item = await u.db("o_productFactoryItem").where({ projectId, id: productId }).first();
  if (!item) throw new Error("商品不存在");
  let workflow = await u.db("o_productFactoryWorkflow").where({ projectId, productId }).first();
  if (!workflow) {
    const config = await ensureProductFactoryConfig(projectId);
    const timestamp = Date.now();
    await u.db("o_productFactoryWorkflow").insert({
      projectId,
      productId,
      version: 1,
      customized: 0,
      graphData: JSON.stringify(createDefaultProductWorkflow(productId, safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK))),
      createTime: timestamp,
      updateTime: timestamp,
    });
    workflow = await u.db("o_productFactoryWorkflow").where({ projectId, productId }).first();
  }
  if (!workflow) throw new Error("商品工作流初始化失败");
  return { ...workflow, graph: safeJsonParse<ProductFactoryGraph>(workflow.graphData, createDefaultProductWorkflow(productId)) };
}

export async function upsertProductFactoryItem(projectId: number, input: ProductFactoryItemInput) {
  await ensureProductFactoryConfig(projectId);
  const sku = normalizeString(input.sku).toUpperCase();
  const name = normalizeString(input.name);
  if (!sku) throw new Error("SKU 不能为空");
  if (!name) throw new Error("商品名称不能为空");
  const sellingPoints = Array.isArray(input.sellingPoints)
    ? input.sellingPoints.map(String).map((item) => item.trim()).filter(Boolean)
    : normalizeString(input.sellingPoints).split(/[|\n]/).map((item) => item.trim()).filter(Boolean);
  const attributes = typeof input.attributes === "string"
    ? safeJsonParse<Record<string, unknown>>(input.attributes, {})
    : input.attributes || {};
  const timestamp = Date.now();
  const existing = input.id
    ? await u.db("o_productFactoryItem").where({ projectId, id: input.id }).first()
    : await u.db("o_productFactoryItem").where({ projectId, sku }).first();
  const data = {
    sku,
    name,
    category: normalizeString(input.category),
    description: normalizeString(input.description),
    sellingPoints: JSON.stringify(sellingPoints),
    attributes: JSON.stringify(attributes),
    updateTime: timestamp,
  };
  let productId: number;
  if (existing?.id) {
    const duplicate = await u.db("o_productFactoryItem").where({ projectId, sku }).whereNot("id", existing.id).first();
    if (duplicate) throw new Error(`SKU 已存在：${sku}`);
    const generationInputsChanged = ["sku", "name", "category", "description", "sellingPoints", "attributes"]
      .some((key) => String((existing as any)[key] ?? "") !== String((data as any)[key] ?? ""));
    await u.db("o_productFactoryItem").where({ projectId, id: existing.id }).update(data);
    productId = Number(existing.id);
    if (generationInputsChanged) await markProductFactoryArtifactsInputChanged(projectId, [productId]);
  } else {
    const inserted = await u.db("o_productFactoryItem").insert({ ...data, projectId, state: "draft", createTime: timestamp });
    productId = Number(inserted[0]);
  }
  await ensureProductWorkflow(projectId, productId);
  await refreshProductFactoryItemState(projectId, productId);
  return getProductFactoryItem(projectId, productId);
}

export async function getProductFactoryItem(projectId: number, productId: number) {
  const item = await u.db("o_productFactoryItem").where({ projectId, id: productId }).first();
  if (!item) throw new Error("商品不存在");
  const [references, artifacts, workflow] = await Promise.all([
    u.db("o_productFactoryReference").where({ projectId, productId }).orderBy("sortIndex", "asc"),
    u.db("o_productFactoryArtifact").where({ projectId, productId }).orderBy("id", "desc"),
    ensureProductWorkflow(projectId, productId),
  ]);
  return {
    ...item,
    sellingPoints: sellingPointsFromRow(item.sellingPoints),
    attributes: attributesFromRow(item.attributes),
    references: await Promise.all(references.map(async (ref) => ({ ...ref, url: await u.oss.getFileUrl(ref.filePath) }))),
    artifacts: await Promise.all(artifacts.map(async (artifact) => ({
      ...artifact,
      url: artifact.filePath ? await u.oss.getFileUrl(artifact.filePath) : null,
      promptSections: safeJsonParse(artifact.promptSections, {}),
      params: safeJsonParse(artifact.params, {}),
    }))),
    workflow,
  };
}

export async function listProductFactoryItems(projectId: number, page = 1, pageSize = 50, search = "") {
  await ensureProductFactoryConfig(projectId);
  const limit = clampInt(pageSize, 1, 100, 50);
  const currentPage = Math.max(1, Math.round(Number(page) || 1));
  let query = u.db("o_productFactoryItem").where("projectId", projectId);
  let countQuery = u.db("o_productFactoryItem").where("projectId", projectId);
  const term = normalizeString(search);
  if (term) {
    const applySearch = (builder: any) => builder.where((nested: any) => nested.whereLike("sku", `%${term}%`).orWhereLike("name", `%${term}%`));
    query = applySearch(query);
    countQuery = applySearch(countQuery);
  }
  const [rows, countRow] = await Promise.all([
    query.orderBy("id", "desc").limit(limit).offset((currentPage - 1) * limit),
    countQuery.count({ count: "id" }).first(),
  ]);
  const productIds = rows.map((row) => Number(row.id));
  let [references, artifacts, workflows] = productIds.length
    ? await Promise.all([
        u.db("o_productFactoryReference").where("projectId", projectId).whereIn("productId", productIds).orderBy("sortIndex", "asc"),
        u.db("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", productIds).orderBy("id", "desc"),
        u.db("o_productFactoryWorkflow").where("projectId", projectId).whereIn("productId", productIds),
      ])
    : [[], [], []];
  if (workflows.length !== productIds.length) {
    const existing = new Set(workflows.map((workflow) => Number(workflow.productId)));
    await Promise.all(productIds.filter((id) => !existing.has(id)).map((id) => ensureProductWorkflow(projectId, id)));
    workflows = await u.db("o_productFactoryWorkflow").where("projectId", projectId).whereIn("productId", productIds);
  }
  const referenceMap = new Map<number, typeof references>();
  const artifactMap = new Map<number, typeof artifacts>();
  for (const reference of references) {
    const id = Number(reference.productId);
    referenceMap.set(id, [...(referenceMap.get(id) || []), reference]);
  }
  for (const artifact of artifacts) {
    const id = Number(artifact.productId);
    artifactMap.set(id, [...(artifactMap.get(id) || []), artifact]);
  }
  const workflowMap = new Map(workflows.map((workflow) => [Number(workflow.productId), workflow]));
  const items = await Promise.all(rows.map(async (row) => {
    const productId = Number(row.id);
    const workflow = workflowMap.get(productId)!;
    return {
      ...row,
      sellingPoints: sellingPointsFromRow(row.sellingPoints),
      attributes: attributesFromRow(row.attributes),
      references: await Promise.all((referenceMap.get(productId) || []).map(async (reference) => ({ ...reference, url: await u.oss.getFileUrl(reference.filePath) }))),
      artifacts: await Promise.all((artifactMap.get(productId) || []).map(async (artifact) => ({
        ...artifact,
        url: artifact.filePath ? await u.oss.getFileUrl(artifact.filePath) : null,
        promptSections: safeJsonParse(artifact.promptSections, {}),
        params: safeJsonParse(artifact.params, {}),
      }))),
      workflow: {
        ...workflow,
        graph: safeJsonParse<ProductFactoryGraph>(workflow.graphData, createDefaultProductWorkflow(productId)),
      },
    };
  }));
  return { items, page: currentPage, pageSize: limit, total: Number((countRow as any)?.count || 0) };
}

export async function deleteProductFactoryItems(projectId: number, productIds: number[]) {
  const ids = [...new Set(productIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return { deleted: 0 };
  const references = await u.db("o_productFactoryReference").where("projectId", projectId).whereIn("productId", ids).select("filePath");
  const artifacts = await u.db("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", ids).select("filePath");
  await u.db.transaction(async (trx) => {
    await trx("o_productFactoryJob").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryArtifact").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryWorkflow").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryReference").where("projectId", projectId).whereIn("productId", ids).delete();
    await trx("o_productFactoryItem").where("projectId", projectId).whereIn("id", ids).delete();
  });
  for (const row of [...references, ...artifacts]) {
    if (!row.filePath) continue;
    try { await u.oss.deleteFile(row.filePath); } catch { /* already removed */ }
  }
  return { deleted: ids.length };
}

export async function updateProductWorkflow(projectId: number, productId: number, graph: ProductFactoryGraph, customized = true, markInputChanged = true) {
  await ensureProductWorkflow(projectId, productId);
  if (Number(graph.productId) !== productId) throw new Error("工作流商品 ID 不匹配");
  validateProductWorkflow(graph);
  graph.customized = customized;
  await u.db("o_productFactoryWorkflow").where({ projectId, productId }).update({
    graphData: JSON.stringify(graph),
    customized: customized ? 1 : 0,
    version: Math.max(1, Number(graph.version || 1)),
    updateTime: Date.now(),
  });
  if (markInputChanged) await markProductFactoryArtifactsInputChanged(projectId, [productId]);
  return ensureProductWorkflow(projectId, productId);
}

export async function syncProductWorkflowTemplate(projectId: number, productId: number) {
  const config = await ensureProductFactoryConfig(projectId);
  return updateProductWorkflow(
    projectId,
    productId,
    createDefaultProductWorkflow(productId, safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK)),
    false,
  );
}

export function findWorkflowPromptOverride(graph: ProductFactoryGraph, mediaType: "image" | "video", slotKey: string, aspectRatio: string) {
  const node = graph.nodes.find((item) => item.type === mediaType && item.data.slotKey === slotKey && item.data.aspectRatio === aspectRatio);
  const value = node?.data.promptOverride;
  return value && typeof value === "object" ? value as Partial<ProductFactoryPromptSections> : undefined;
}

export async function compilePromptForProduct(request: ProductFactoryPromptRequest) {
  const project = await requireProductFactoryProject(request.projectId, true);
  const config = await ensureProductFactoryConfig(request.projectId);
  const item = await u.db("o_productFactoryItem").where({ projectId: request.projectId, id: request.productId }).first();
  if (!item) throw new Error("商品不存在");
  const workflow = await ensureProductWorkflow(request.projectId, request.productId);
  const refs = await u.db("o_productFactoryReference").where({ projectId: request.projectId, productId: request.productId }).orderBy("isPrimary", "desc").orderBy("sortIndex", "asc");
  const brandRefs = await u.db("o_productFactoryReference").where({ projectId: request.projectId, scope: "brand" }).orderBy("sortIndex", "asc");
  const pack = normalizeFactoryPack(safeJsonParse(config.defaultPack, DEFAULT_PRODUCT_FACTORY_PACK));
  const model = normalizeString(request.mediaType === "image" ? project.imageModel : project.videoModel);
  if (!model || !/^[^:]+:.+$/.test(model)) throw new Error(`项目未配置有效的${request.mediaType === "image" ? "图片" : "视频"}模型`);
  const metadata = await getProductFactoryModelMetadata(model);
  const overrides = request.overrides || findWorkflowPromptOverride(workflow.graph, request.mediaType, request.slotKey, request.aspectRatio);
  const input: PromptCompileInput = {
    mediaType: request.mediaType,
    slotKey: request.slotKey as PromptCompileInput["slotKey"],
    aspectRatio: request.aspectRatio,
    model,
    size: pack.imageQuality,
    mode: request.runtime?.mode ?? project.mode ?? undefined,
    duration: request.runtime?.duration ?? pack.videoDuration,
    resolution: request.runtime?.resolution ?? pack.videoResolution,
    audio: request.runtime?.audio ?? pack.videoAudio,
    brandName: config.brandName,
    campaignBrief: config.campaignBrief,
    visualTone: config.visualTone,
    forbiddenContent: config.forbiddenContent,
    sku: item.sku,
    productName: item.name,
    category: item.category,
    description: item.description,
    sellingPoints: sellingPointsFromRow(item.sellingPoints),
    attributes: attributesFromRow(item.attributes),
    referenceLabels: [
      ...refs.map((ref) => `${ref.isPrimary ? "主参考" : "补充参考"}:${ref.fileName}`),
      ...brandRefs.map((ref) => `品牌参考:${ref.fileName}`),
    ],
    promptLanguage: metadata.promptLanguage,
    overrides,
  };
  const result = compileProductPrompt(input);
  return {
    input,
    result,
    signature: promptInputSignature({
      input,
      sections: result.sections,
      references: refs.map((ref) => [ref.id, ref.sha256]),
      brandReferences: brandRefs.map((ref) => [ref.id, ref.sha256]),
      workflowVersion: workflow.version,
    }),
    referenceIds: refs.map((ref) => Number(ref.id)),
    modelMetadata: metadata,
  };
}

export async function saveProductPromptOverride(request: ProductFactoryPromptRequest, overrides: Partial<ProductFactoryPromptSections> | null) {
  const workflow = await ensureProductWorkflow(request.projectId, request.productId);
  const node = workflow.graph.nodes.find((item) => item.type === request.mediaType && item.data.slotKey === request.slotKey && item.data.aspectRatio === request.aspectRatio);
  if (!node) throw new Error("未找到对应的工作流节点");
  node.data.promptOverride = overrides;
  node.data.promptCustomized = Boolean(overrides && Object.keys(overrides).length);
  return updateProductWorkflow(request.projectId, request.productId, workflow.graph, true);
}

export async function refreshProductFactoryItemState(projectId: number, productId: number): Promise<ProductFactoryItemState> {
  const [refs, jobs, artifacts, workflow] = await Promise.all([
    u.db("o_productFactoryReference").where({ projectId, productId }),
    u.db("o_productFactoryJob").where({ projectId, productId }),
    u.db("o_productFactoryArtifact").where({ projectId, productId }),
    ensureProductWorkflow(projectId, productId),
  ]);
  let state: ProductFactoryItemState = refs.some((ref) => ref.isPrimary) ? "ready" : "draft";
  const imageJobs = jobs.filter((job) => job.phase === "image");
  const videoJobs = jobs.filter((job) => job.phase === "video");
  if (imageJobs.some((job) => job.state === "queued" || job.state === "running")) state = "image_generating";
  else {
    const images = artifacts.filter((artifact) => artifact.mediaType === "image" && artifact.state === "success");
    const approvedImages = images.filter((artifact) => artifact.approved);
    const currentImages = images.filter((artifact) => artifact.isCurrent);
    const hasAllVideoMappings = Object.values(workflow.graph.reviewMappings || {}).every((id) => Number(id) > 0);
    if (images.length && (currentImages.some((artifact) => !artifact.approved) || !approvedImages.length || !hasAllVideoMappings)) state = "awaiting_review";
    else if (approvedImages.length && hasAllVideoMappings) state = "video_ready";
    if (videoJobs.some((job) => job.state === "queued" || job.state === "running")) state = "video_generating";
    const videos = artifacts.filter((artifact) => artifact.mediaType === "video" && artifact.state === "success" && artifact.isCurrent);
    const expectedVideos = workflow.graph.nodes.filter((node) => node.type === "video").length;
    if (expectedVideos > 0 && videos.length >= expectedVideos) state = "completed";
  }
  if (jobs.some((job) => job.state === "failed" || job.state === "interrupted") && !jobs.some((job) => job.state === "queued" || job.state === "running")) state = "partial_failed";
  await u.db("o_productFactoryItem").where({ projectId, id: productId }).update({ state, updateTime: Date.now() });
  return state;
}
