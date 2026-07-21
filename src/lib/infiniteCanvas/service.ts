import path from "node:path";
import u from "@/utils";
import { ProjectTypes } from "@/constants/project";
import ensureInfiniteCanvasSchema from "@/lib/infiniteCanvas/schema";
import {
  DEFAULT_INFINITE_CANVAS_SETTINGS,
  emptyInfiniteCanvasGraph,
  safeJson,
  type InfiniteCanvasArtifactOrigin,
  type InfiniteCanvasArtifactState,
  type InfiniteCanvasGraph,
  type InfiniteCanvasMediaType,
  type InfiniteCanvasNodeType,
  type InfiniteCanvasSettings,
} from "@/lib/infiniteCanvas/types";

const ALLOWED_UPLOADS: Record<string, { extension: string; compatibleExtensions: string[]; mediaType: InfiniteCanvasMediaType; limit: number }> = {
  "image/jpeg": { extension: "jpg", compatibleExtensions: ["jpg", "jpeg"], mediaType: "image", limit: 20 * 1024 * 1024 },
  "image/png": { extension: "png", compatibleExtensions: ["png"], mediaType: "image", limit: 20 * 1024 * 1024 },
  "image/webp": { extension: "webp", compatibleExtensions: ["webp"], mediaType: "image", limit: 20 * 1024 * 1024 },
  "video/mp4": { extension: "mp4", compatibleExtensions: ["mp4"], mediaType: "video", limit: 64 * 1024 * 1024 },
  "video/webm": { extension: "webm", compatibleExtensions: ["webm"], mediaType: "video", limit: 64 * 1024 * 1024 },
};

function cleanText(value: unknown, fallback: unknown = ""): string {
  return typeof value === "string" ? value.trim() : typeof fallback === "string" ? fallback : "";
}

function normalizeMode(value: unknown): string | string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return "text";
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try { const parsed = JSON.parse(trimmed); if (Array.isArray(parsed)) return parsed.map(String); } catch { /* use literal */ }
  }
  return trimmed || "text";
}

function storedMode(value: unknown) {
  const normalized = normalizeMode(value);
  return Array.isArray(normalized) ? JSON.stringify(normalized) : normalized;
}

function normalizeSettings(value: unknown): InfiniteCanvasSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const duration = Math.round(Number(source.defaultVideoDuration));
  return {
    defaultVideoResolution: cleanText(source.defaultVideoResolution, DEFAULT_INFINITE_CANVAS_SETTINGS.defaultVideoResolution) || DEFAULT_INFINITE_CANVAS_SETTINGS.defaultVideoResolution,
    defaultVideoDuration: Number.isFinite(duration) ? Math.max(1, Math.min(30, duration)) : DEFAULT_INFINITE_CANVAS_SETTINGS.defaultVideoDuration,
    defaultVideoAudio: source.defaultVideoAudio === true,
  };
}

function assertFinitePosition(value: unknown, label: string) {
  if (!value || typeof value !== "object") throw new Error(`${label}位置无效`);
  const point = value as Record<string, unknown>;
  if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) throw new Error(`${label}位置无效`);
}

export function validateInfiniteCanvasGraph(value: unknown): InfiniteCanvasGraph {
  if (!value || typeof value !== "object") throw new Error("画布数据无效");
  const graph = value as InfiniteCanvasGraph;
  if (Number(graph.version) !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("画布数据版本无效");
  if (!graph.viewport || !Number.isFinite(Number(graph.viewport.x)) || !Number.isFinite(Number(graph.viewport.y)) || !Number.isFinite(Number(graph.viewport.zoom))) throw new Error("画布视图无效");
  if (Number(graph.viewport.zoom) < .25 || Number(graph.viewport.zoom) > 2) throw new Error("画布缩放超出范围");
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!node || !["material", "image", "video"].includes(node.type)) throw new Error("画布包含未知节点");
    if (!node.id || ids.has(node.id)) throw new Error("画布节点 ID 重复");
    ids.add(node.id); assertFinitePosition(node.position, `节点 ${node.id}`);
  }
  const edgeIds = new Set<string>();
  const pairIds = new Set<string>();
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!edge?.id || edgeIds.has(edge.id)) throw new Error("画布连线 ID 重复");
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) throw new Error("画布连线端点无效");
    const pair = `${edge.source}:${edge.sourcePort || "media"}->${edge.target}:${edge.targetPort || "input"}`;
    if (pairIds.has(pair)) throw new Error("画布包含重复连线");
    edgeIds.add(edge.id); pairIds.add(pair); outgoing.get(edge.source)!.push(edge.target);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("画布不能包含循环连接");
    if (visited.has(id)) return;
    visiting.add(id); for (const target of outgoing.get(id) || []) visit(target); visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return {
    version: 1,
    nodes: graph.nodes.map((node) => ({ ...node, position: { x: Number(node.position.x), y: Number(node.position.y) }, data: node.data && typeof node.data === "object" ? node.data : {} })),
    edges: graph.edges.map((edge, index) => ({ ...edge, sourcePort: edge.sourcePort || "media", targetPort: edge.targetPort || "input", order: Number.isFinite(Number(edge.order)) ? Number(edge.order) : index })),
    viewport: { x: Number(graph.viewport.x), y: Number(graph.viewport.y), zoom: Number(graph.viewport.zoom) },
  };
}

export async function requireInfiniteCanvasProject(projectId: number) {
  await ensureInfiniteCanvasSchema(u.db);
  const project = await u.db("o_project").where("id", projectId).first();
  if (!project) throw new Error("画布项目不存在");
  if (project.projectType !== ProjectTypes.canvas) throw new Error("该项目不是无限画布项目");
  return project;
}

export async function requireInfiniteCanvasNode(projectId: number, nodeIdValue: unknown, expectedType?: InfiniteCanvasNodeType | InfiniteCanvasNodeType[]) {
  await requireInfiniteCanvasProject(projectId);
  const nodeId = cleanText(nodeIdValue);
  if (!nodeId || nodeId.length > 160) throw new Error("节点 ID 无效");
  const workspace = await u.db("o_infiniteCanvasWorkspace").where("projectId", projectId).first();
  if (!workspace) throw new Error("画布工作区不存在");
  const graph = validateInfiniteCanvasGraph(safeJson(workspace.graphData, emptyInfiniteCanvasGraph()));
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("画布节点不存在或已从画布移除");
  const expected = expectedType ? (Array.isArray(expectedType) ? expectedType : [expectedType]) : [];
  if (expected.length && !expected.includes(node.type)) throw new Error(`节点类型不匹配，需要${expected.join(" 或 ")}节点`);
  return node;
}

async function requireConfiguredModel(modelKey: string, type: "image" | "video") {
  const [vendorId, modelName] = cleanText(modelKey).split(/:(.+)/);
  if (!vendorId || !modelName) throw new Error(`请选择${type === "image" ? "图片" : "视频"}模型`);
  const models = await u.vendor.getModelList(vendorId);
  const model = models.find((item: any) => item.modelName === modelName && item.type === type);
  if (!model) throw new Error(`所选${type === "image" ? "图片" : "视频"}模型不存在或已停用`);
  return model;
}

export async function createInfiniteCanvasProject(input: Record<string, unknown>) {
  await ensureInfiniteCanvasSchema(u.db);
  const name = cleanText(input.name);
  if (!name) throw new Error("请输入画布名称");
  const imageModel = cleanText(input.imageModel); const videoModel = cleanText(input.videoModel);
  await Promise.all([requireConfiguredModel(imageModel, "image"), requireConfiguredModel(videoModel, "video")]);
  let projectId = Date.now();
  while (await u.db("o_project").where("id", projectId).first()) projectId += 1;
  const timestamp = Date.now(); const settings = normalizeSettings(input.settings);
  let scriptId = 0;
  await u.db.transaction(async (trx) => {
    await trx("o_project").insert({
      id: projectId, projectType: ProjectTypes.canvas, name, intro: cleanText(input.intro), type: "无限画布", artStyle: "", directorManual: "",
      videoRatio: cleanText(input.videoRatio, "16:9") || "16:9", imageModel, videoModel,
      imageQuality: cleanText(input.imageQuality, "2K") || "2K", mode: storedMode(input.mode), createTime: timestamp, userId: 1,
    });
    const ids = await trx("o_script").insert({ name: "__TOONFLOW_INFINITE_CANVAS__", content: "", projectId, createTime: timestamp });
    scriptId = Number(ids[0]);
    await trx("o_infiniteCanvasWorkspace").insert({ projectId, scriptId, settingsData: JSON.stringify(settings), graphData: JSON.stringify(emptyInfiniteCanvasGraph()), revision: 1, createTime: timestamp, updateTime: timestamp });
  });
  return getInfiniteCanvasWorkspace(projectId);
}

export async function listInfiniteCanvasProjects() {
  await ensureInfiniteCanvasSchema(u.db);
  const rows = await u.db("o_project as p")
    .leftJoin("o_infiniteCanvasWorkspace as w", "w.projectId", "p.id")
    .where("p.projectType", ProjectTypes.canvas)
    .select("p.*", "w.updateTime as workspaceUpdateTime", "w.revision", "w.settingsData")
    .orderBy([{ column: "w.updateTime", order: "desc" }, { column: "p.createTime", order: "desc" }]);
  return Promise.all(rows.map(async (row: any) => {
    const artifact = await u.db("o_infiniteCanvasArtifact").where({ projectId: row.id, isCurrent: 1, state: "success" }).whereNotNull("filePath").orderBy("updateTime", "desc").first();
    const { settingsData, ...project } = row;
    return { ...project, mode: normalizeMode(row.mode), settings: normalizeSettings(safeJson(settingsData, DEFAULT_INFINITE_CANVAS_SETTINGS)), thumbnailUrl: artifact ? await artifactUrl(artifact) : "" };
  }));
}

export async function getInfiniteCanvasWorkspace(projectId: number) {
  const project = await requireInfiniteCanvasProject(projectId);
  let row = await u.db("o_infiniteCanvasWorkspace").where("projectId", projectId).first();
  if (!row) throw new Error("画布工作区不存在");
  const graph = validateInfiniteCanvasGraph(safeJson(row.graphData, emptyInfiniteCanvasGraph()));
  const artifacts = await listInfiniteCanvasArtifacts(projectId);
  return { project: { ...project, mode: normalizeMode(project.mode) }, settings: normalizeSettings(safeJson(row.settingsData, DEFAULT_INFINITE_CANVAS_SETTINGS)), graph, revision: Number(row.revision), scriptId: Number(row.scriptId), artifacts };
}

export async function updateInfiniteCanvasProject(projectId: number, input: Record<string, unknown>) {
  const previous = await requireInfiniteCanvasProject(projectId);
  const imageModel = cleanText(input.imageModel, previous.imageModel); const videoModel = cleanText(input.videoModel, previous.videoModel);
  await Promise.all([requireConfiguredModel(imageModel, "image"), requireConfiguredModel(videoModel, "video")]);
  const name = cleanText(input.name, previous.name); if (!name) throw new Error("请输入画布名称");
  const workspace = await u.db("o_infiniteCanvasWorkspace").where("projectId", projectId).first();
  if (!workspace) throw new Error("画布工作区不存在");
  const settings = normalizeSettings(input.settings ?? safeJson(workspace.settingsData, DEFAULT_INFINITE_CANVAS_SETTINGS));
  await u.db.transaction(async (trx) => {
    await trx("o_project").where("id", projectId).update({ name, intro: cleanText(input.intro, previous.intro), imageModel, videoModel, imageQuality: cleanText(input.imageQuality, previous.imageQuality || "2K"), videoRatio: cleanText(input.videoRatio, previous.videoRatio || "16:9"), mode: storedMode(input.mode ?? previous.mode) });
    await trx("o_infiniteCanvasWorkspace").where("projectId", projectId).update({ settingsData: JSON.stringify(settings), updateTime: Date.now() });
  });
  return getInfiniteCanvasWorkspace(projectId);
}

export async function updateInfiniteCanvasGraph(projectId: number, value: unknown, baseRevision: number) {
  await requireInfiniteCanvasProject(projectId);
  const graph = validateInfiniteCanvasGraph(value); const row = await u.db("o_infiniteCanvasWorkspace").where("projectId", projectId).first();
  if (!row) throw new Error("画布工作区不存在");
  if (!Number.isInteger(baseRevision) || Number(row.revision) !== baseRevision) {
    const error: any = new Error("画布已在另一个窗口更新，请重新加载后再保存"); error.statusCode = 409; throw error;
  }
  const revision = baseRevision + 1; const activeNodeIds = graph.nodes.map((node) => node.id);
  await u.db.transaction(async (trx) => {
    const updated = await trx("o_infiniteCanvasWorkspace").where({ projectId, revision: baseRevision }).update({ graphData: JSON.stringify(graph), revision, updateTime: Date.now() });
    if (!updated) { const error: any = new Error("画布保存冲突，请重新加载"); error.statusCode = 409; throw error; }
    let artifacts = trx("o_infiniteCanvasArtifact").where("projectId", projectId);
    if (activeNodeIds.length) await artifacts.whereNotIn("nodeId", activeNodeIds).update({ detached: 1, updateTime: Date.now() });
    else await artifacts.update({ detached: 1, updateTime: Date.now() });
    if (activeNodeIds.length) await trx("o_infiniteCanvasArtifact").where("projectId", projectId).whereIn("nodeId", activeNodeIds).update({ detached: 0, updateTime: Date.now() });
  });
  return { revision, graph };
}

export interface RegisterArtifactInput {
  projectId: number; nodeId: string; origin: InfiniteCanvasArtifactOrigin; mediaType: InfiniteCanvasMediaType; state: InfiniteCanvasArtifactState;
  fileName?: string; mimeType?: string; filePath?: string | null; videoId?: number | null; prompt?: string; model?: string;
  params?: Record<string, unknown>; inputSignature?: string; inputArtifactIds?: number[]; errorReason?: string | null;
}

export async function registerInfiniteCanvasArtifact(input: RegisterArtifactInput) {
  const nodeId = cleanText(input.nodeId);
  const expectedType: InfiniteCanvasNodeType = input.origin === "upload" ? "material" : input.mediaType;
  await requireInfiniteCanvasNode(input.projectId, nodeId, expectedType);
  let artifactId = 0;
  await u.db.transaction(async (trx) => {
    const versionRow = await trx("o_infiniteCanvasArtifact").where({ projectId: input.projectId, nodeId }).max({ version: "version" }).first();
    const timestamp = Date.now();
    await trx("o_infiniteCanvasArtifact").where({ projectId: input.projectId, nodeId, isCurrent: 1 }).update({ isCurrent: 0, updateTime: timestamp });
    const ids = await trx("o_infiniteCanvasArtifact").insert({
      projectId: input.projectId, nodeId, origin: input.origin, mediaType: input.mediaType, fileName: input.fileName || null, mimeType: input.mimeType || null,
      filePath: input.filePath ? u.replaceUrl(input.filePath) : null, videoId: input.videoId || null, version: Number((versionRow as any)?.version || 0) + 1,
      isCurrent: 1, detached: 0, state: input.state, prompt: input.prompt || "", model: input.model || "", params: JSON.stringify(input.params || {}),
      inputSignature: input.inputSignature || "", inputArtifactIds: JSON.stringify(input.inputArtifactIds || []), errorReason: input.errorReason || null, createTime: timestamp, updateTime: timestamp,
    });
    artifactId = Number(ids[0]);
  });
  return normalizeArtifact(await u.db("o_infiniteCanvasArtifact").where("id", artifactId).first());
}

export async function updateInfiniteCanvasArtifact(artifactId: number, patch: { state: InfiniteCanvasArtifactState; filePath?: string | null; errorReason?: string | null }) {
  const row = await u.db("o_infiniteCanvasArtifact").where("id", artifactId).first(); if (!row) return null;
  await u.db("o_infiniteCanvasArtifact").where("id", artifactId).update({ state: patch.state, filePath: patch.filePath ? u.replaceUrl(patch.filePath) : row.filePath, errorReason: patch.errorReason || null, updateTime: Date.now() });
  return normalizeArtifact(await u.db("o_infiniteCanvasArtifact").where("id", artifactId).first());
}

export async function requireInfiniteCanvasArtifact(projectId: number, artifactId: number, requireSuccess = false) {
  await requireInfiniteCanvasProject(projectId);
  const row = await u.db("o_infiniteCanvasArtifact").where({ id: artifactId, projectId }).first();
  if (!row) throw new Error("画布素材不存在或不属于当前项目");
  if (requireSuccess && row.state !== "success") throw new Error("画布素材尚未生成完成");
  if (requireSuccess && !row.filePath) throw new Error("画布素材文件不存在");
  return row;
}

export async function requireInfiniteCanvasArtifactInputs(projectId: number, artifactIds: number[], expectedMediaType?: InfiniteCanvasMediaType) {
  await requireInfiniteCanvasProject(projectId);
  const normalizedIds = artifactIds.map(Number);
  if (normalizedIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error("画布输入素材 ID 无效");
  if (!normalizedIds.length) return [];
  const rows = await u.db("o_infiniteCanvasArtifact").where("projectId", projectId).whereIn("id", [...new Set(normalizedIds)]);
  const byId = new Map(rows.map((row: any) => [Number(row.id), row]));
  return normalizedIds.map((id) => {
    const row: any = byId.get(id);
    if (!row) throw new Error("画布输入素材不存在或不属于当前项目");
    if (row.state !== "success" || !row.filePath) throw new Error("画布输入素材尚未生成完成");
    if (!Number(row.isCurrent) || Number(row.detached)) throw new Error("画布输入素材不是节点的当前有效版本");
    if (expectedMediaType && row.mediaType !== expectedMediaType) throw new Error(`画布输入素材必须是${expectedMediaType === "image" ? "图片" : "视频"}`);
    return row;
  });
}

async function artifactUrl(row: any) {
  if (!row?.filePath) return "";
  return row.mediaType === "image" ? u.oss.getSmallImageUrl(row.filePath) : u.oss.getFileUrl(row.filePath);
}

async function normalizeArtifact(row: any) {
  if (!row) return null;
  return { ...row, id: Number(row.id), projectId: Number(row.projectId), version: Number(row.version), videoId: row.videoId ? Number(row.videoId) : null, isCurrent: Number(row.isCurrent), detached: Number(row.detached), params: safeJson(row.params, {}), inputArtifactIds: safeJson(row.inputArtifactIds, []), url: await artifactUrl(row) };
}

async function syncVideoArtifacts(projectId: number) {
  const rows = await u.db("o_infiniteCanvasArtifact").where({ projectId, mediaType: "video" }).whereNotNull("videoId").whereIn("state", ["generating", "uploading"]);
  if (!rows.length) return;
  const videos = await u.db("o_video").whereIn("id", rows.map((row: any) => Number(row.videoId)));
  for (const row of rows) {
    const video = videos.find((candidate: any) => Number(candidate.id) === Number(row.videoId)); if (!video) continue;
    if (["已完成", "生成成功"].includes(String(video.state))) await u.db("o_infiniteCanvasArtifact").where("id", row.id).update({ state: "success", filePath: video.filePath || row.filePath, errorReason: null, updateTime: Date.now() });
    else if (video.state === "生成失败") await u.db("o_infiniteCanvasArtifact").where("id", row.id).update({ state: "failed", errorReason: video.errorReason || "视频生成失败", updateTime: Date.now() });
  }
}

export async function listInfiniteCanvasArtifacts(projectId: number, nodeId?: string) {
  await requireInfiniteCanvasProject(projectId); await syncVideoArtifacts(projectId);
  let query = u.db("o_infiniteCanvasArtifact").where("projectId", projectId); if (nodeId) query = query.where("nodeId", nodeId);
  const rows = await query.orderBy([{ column: "nodeId", order: "asc" }, { column: "version", order: "desc" }]);
  return Promise.all(rows.map(normalizeArtifact));
}

export async function selectInfiniteCanvasArtifact(projectId: number, artifactId: number) {
  const artifact = await requireInfiniteCanvasArtifact(projectId, artifactId, true);
  await requireInfiniteCanvasNode(projectId, artifact.nodeId);
  await u.db.transaction(async (trx) => {
    await trx("o_infiniteCanvasArtifact").where({ projectId, nodeId: artifact.nodeId }).update({ isCurrent: 0, updateTime: Date.now() });
    await trx("o_infiniteCanvasArtifact").where("id", artifactId).update({ isCurrent: 1, detached: 0, updateTime: Date.now() });
  });
  return normalizeArtifact(await u.db("o_infiniteCanvasArtifact").where("id", artifactId).first());
}

export async function deleteInfiniteCanvasArtifact(projectId: number, artifactId: number) {
  const artifact = await requireInfiniteCanvasArtifact(projectId, artifactId);
  if (Number(artifact.isCurrent)) throw new Error("当前版本不能删除，请先切换到其他版本");
  await u.db("o_infiniteCanvasArtifact").where("id", artifactId).delete();
  if (artifact.videoId) await u.db("o_video").where({ id: artifact.videoId, projectId }).delete();
  if (artifact.filePath) {
    const shared = await u.db("o_infiniteCanvasArtifact").where({ projectId, filePath: artifact.filePath }).first();
    if (!shared && String(artifact.filePath).startsWith(`${projectId}/`)) { try { await u.oss.deleteFile(artifact.filePath); } catch { /* already gone */ } }
  }
  return { deleted: artifactId };
}

export async function uploadInfiniteCanvasMaterial(input: { projectId: number; nodeId: string; fileName: string; dataBase64: string }) {
  await requireInfiniteCanvasNode(input.projectId, input.nodeId, "material");
  const match = cleanText(input.dataBase64).match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("上传文件格式无效");
  const descriptor = ALLOWED_UPLOADS[match[1].toLowerCase()];
  if (!descriptor) throw new Error("仅支持 JPG、PNG、WebP、MP4 和 WebM");
  const safeFileName = path.basename(cleanText(input.fileName, `material.${descriptor.extension}`)).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
  const suppliedExtension = path.extname(safeFileName).slice(1).toLowerCase();
  if (!descriptor.compatibleExtensions.includes(suppliedExtension)) throw new Error("文件扩展名与 MIME 类型不匹配");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > descriptor.limit) throw new Error(`${descriptor.mediaType === "image" ? "图片" : "视频"}大小不能超过 ${descriptor.limit / 1024 / 1024}MB`);
  const filePath = `${input.projectId}/infiniteCanvas/materials/${u.uuid()}.${descriptor.extension}`;
  await u.oss.writeFile(filePath, buffer);
  try {
    return await registerInfiniteCanvasArtifact({ projectId: input.projectId, nodeId: input.nodeId, origin: "upload", mediaType: descriptor.mediaType, state: "success", fileName: safeFileName, mimeType: match[1].toLowerCase(), filePath });
  } catch (error) { try { await u.oss.deleteFile(filePath); } catch { /* ignore cleanup failure */ } throw error; }
}
