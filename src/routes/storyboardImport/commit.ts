import express from "express";
import u from "@/utils";
import { db } from "@/utils/db";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

type RoleSpec = {
  name: string;
  age?: string;
  appearance?: string;
  costume?: string;
  personality?: string;
};

type SceneSpec = {
  name: string;
  time?: string;
  color?: string;
  elements?: string;
  atmosphere?: string;
};

type ImportMeta = {
  roles?: RoleSpec[];
  scenes?: SceneSpec[];
};

type StoryboardImportItem = {
  shotNo?: string;
  index?: number;
  prompt: string;
  duration: number;
  track: string;
  state?: string;
  src?: string | null;
  videoDesc: string;
  shouldGenerateImage: number;
  associateAssetsIds?: number[];
  roleNames?: string[];
  sceneNames?: string[];
  toolNames?: string[];
  props?: string;
};

type StoryboardImportOptions = {
  createScriptAssets?: boolean;
  useReferenceAssetDescriptions?: boolean;
  writeStoryboardIndex?: boolean;
};

type AssetRef = {
  name: string;
  type: AssetType;
  describe: string;
};

const assetNameFields: { key: "roleNames" | "sceneNames" | "toolNames"; type: AssetType }[] = [
  { key: "roleNames", type: "role" },
  { key: "sceneNames", type: "scene" },
  { key: "toolNames", type: "tool" },
];

function normalizeName(name: string) {
  return name.trim();
}

function uniqueNumbers(ids: number[]) {
  return [...new Set(ids.filter((id) => Number.isFinite(id)))];
}

function normalizeStoryboardFilePath(src?: string | null): string {
  const value = src?.trim();
  if (!value || /^data:/i.test(value) || /^\/\//.test(value)) return "";
  const isHttpUrl = /^https?:\/\//i.test(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !isHttpUrl) return "";
  if (isHttpUrl) {
    try {
      if (!/^\/(?:oss|smallImage)\//.test(new URL(value).pathname)) return "";
    } catch {
      return "";
    }
  } else if (value.includes("\\") || /(^|\/)\.\.(\/|$)/.test(value)) {
    return "";
  }
  const filePath = u.replaceUrl(value);
  return !filePath || filePath === "." || /\/$/.test(filePath) ? "" : filePath;
}

function formatDateName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function buildRoleDescribe(role: RoleSpec) {
  return [
    `角色：${role.name}`,
    role.age ? `年龄：${role.age}` : "",
    role.appearance ? `外貌特征：${role.appearance}` : "",
    role.costume ? `服装：${role.costume}` : "",
    role.personality ? `性格关键词：${role.personality}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSceneDescribe(scene: SceneSpec) {
  return [
    `场景：${scene.name}`,
    scene.time ? `时间：${scene.time}` : "",
    scene.color ? `色调：${scene.color}` : "",
    scene.elements ? `元素：${scene.elements}` : "",
    scene.atmosphere ? `氛围：${scene.atmosphere}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildToolDescribe(name: string, item: StoryboardImportItem) {
  return [
    `道具：${name}`,
    item.shotNo ? `出现镜头：${item.shotNo}` : "",
    item.props ? `道具/陈设上下文：${item.props}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function findRoleDescribe(name: string, meta?: ImportMeta) {
  const role = meta?.roles?.find((item) => normalizeName(item.name) === name);
  return role ? buildRoleDescribe(role) : name;
}

function findSceneDescribe(name: string, meta?: ImportMeta) {
  const scene = meta?.scenes?.find((item) => normalizeName(item.name) === name || name.includes(normalizeName(item.name)) || normalizeName(item.name).includes(name));
  return scene ? buildSceneDescribe(scene) : name;
}

function collectAssetRefs(item: StoryboardImportItem, meta?: ImportMeta): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const field of assetNameFields) {
    for (const name of item[field.key] ?? []) {
      const normalizedName = normalizeName(name);
      if (!normalizedName) continue;
      const describe = field.type === "role" ? findRoleDescribe(normalizedName, meta) : field.type === "scene" ? findSceneDescribe(normalizedName, meta) : buildToolDescribe(normalizedName, item);
      refs.push({ name: normalizedName, type: field.type, describe });
    }
  }
  return [...new Map(refs.map((item) => [`${item.type}:${item.name}`, item])).values()];
}

async function ensureAssets(db: any, projectId: number, item: StoryboardImportItem, meta?: ImportMeta, options?: StoryboardImportOptions) {
  const assetRefs = collectAssetRefs(item, meta);
  if (!assetRefs.length) return item.associateAssetsIds ?? [];

  const existingAssets = await db("o_assets")
    .where("projectId", projectId)
    .whereIn(
      "type",
      assetRefs.map((item) => item.type),
    )
    .select("id", "name", "type", "describe");
  const assetKeyMap = new Map(existingAssets.map((asset: { id: number; name: string; type: string }) => [`${asset.type}:${asset.name}`, asset.id]));
  const insertAssets = assetRefs.filter((asset) => !assetKeyMap.has(`${asset.type}:${asset.name}`));

  if (insertAssets.length) {
    await db("o_assets").insert(
      insertAssets.map((asset) => ({
        name: asset.name,
        type: asset.type,
        describe: asset.describe,
        projectId,
        startTime: Date.now(),
      })),
    );
  }

  if (options?.useReferenceAssetDescriptions !== false) {
    const updateAssets = assetRefs.filter((asset) => asset.describe && asset.describe !== asset.name);
    for (const asset of updateAssets) {
      await db("o_assets").where({ projectId, type: asset.type, name: asset.name }).update({ describe: asset.describe });
    }
  }

  const allAssets = await db("o_assets")
    .where("projectId", projectId)
    .whereIn(
      "type",
      assetRefs.map((item) => item.type),
    )
    .select("id", "name", "type");
  const nextAssetKeyMap = new Map(allAssets.map((asset: { id: number; name: string; type: string }) => [`${asset.type}:${asset.name}`, asset.id]));
  const autoAssetIds = assetRefs.map((asset) => Number(nextAssetKeyMap.get(`${asset.type}:${asset.name}`))).filter((id) => Number.isFinite(id));
  return uniqueNumbers([...(item.associateAssetsIds ?? []), ...autoAssetIds]);
}

async function ensureScript(db: any, projectId: number, scriptId?: number | null, scriptName?: string | null) {
  if (scriptId) {
    const script = await db("o_script").where({ id: scriptId, projectId }).first();
    if (!script) throw new Error("未找到对应剧本");
    return scriptId;
  }

  const [id] = await db("o_script").insert({
    name: scriptName || `分镜表导入-${formatDateName()}`,
    content: "基于分镜表导入自动创建的内部占位剧本",
    projectId,
    createTime: Date.now(),
  });
  return id;
}

async function insertMissingScriptAssets(db: any, scriptId: number, assetIds: number[]) {
  for (const assetId of uniqueNumbers(assetIds)) {
    const existing = await db("o_scriptAssets").where({ scriptId, assetId }).first();
    if (!existing) await db("o_scriptAssets").insert({ scriptId, assetId });
  }
}

export default router.post(
  "/",
  validateFields({
    data: z.array(
      z.object({
        shotNo: z.string().optional(),
        index: z.number().optional(),
        prompt: z.string(),
        duration: z.number(),
        track: z.string(),
        state: z.string().optional(),
        src: z.string().nullable().optional(),
        videoDesc: z.string(),
        shouldGenerateImage: z.number(),
        associateAssetsIds: z.array(z.number()).optional(),
        roleNames: z.array(z.string()).optional(),
        sceneNames: z.array(z.string()).optional(),
        toolNames: z.array(z.string()).optional(),
        props: z.string().optional(),
      }),
    ),
    meta: z
      .object({
        roles: z.array(z.object({ name: z.string(), age: z.string().optional(), appearance: z.string().optional(), costume: z.string().optional(), personality: z.string().optional() })).optional(),
        scenes: z.array(z.object({ name: z.string(), time: z.string().optional(), color: z.string().optional(), elements: z.string().optional(), atmosphere: z.string().optional() })).optional(),
      })
      .optional(),
    options: z
      .object({
        createScriptAssets: z.boolean().optional(),
        useReferenceAssetDescriptions: z.boolean().optional(),
        writeStoryboardIndex: z.boolean().optional(),
      })
      .optional(),
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    scriptName: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { data, projectId, scriptName, meta, options } = req.body as { data: StoryboardImportItem[]; scriptId?: number | null; projectId: number; scriptName?: string | null; meta?: ImportMeta; options?: StoryboardImportOptions };
    if (!data.length) return res.status(400).send(error("数据不能为空"));

    try {
      const result = await db.transaction(async (trx: any) => {
        const project = await trx("o_project").where("id", projectId).select("projectType").first();
        if (!project) throw new Error("未找到对应项目");
        if (normalizeProjectType(project.projectType ?? "") !== ProjectTypes.storyboard) throw new Error("仅基于分镜表的项目支持导入分镜表");

        const scriptId = await ensureScript(trx, projectId, req.body.scriptId, scriptName);
        const storyboardRows: { id: number; track: string; duration: number; associateAssetsIds: number[] }[] = [];

        for (const [rowIndex, item] of data.entries()) {
          const associateAssetsIds = await ensureAssets(trx, projectId, item, meta, options);
          if (options?.createScriptAssets !== false) await insertMissingScriptAssets(trx, scriptId, associateAssetsIds);
          const videoDesc = item.shotNo && !item.videoDesc.includes("镜号：") ? `镜号：${item.shotNo}\n${item.videoDesc}` : item.videoDesc;
          const filePath = normalizeStoryboardFilePath(item.src);
          const state = filePath ? "已完成" : "未生成";
          const [id] = await trx("o_storyboard").insert({
            prompt: item.prompt,
            duration: String(item.duration),
            state,
            filePath,
            scriptId,
            projectId,
            track: item.track,
            videoDesc,
            shouldGenerateImage: filePath ? 1 : item.shouldGenerateImage,
            index: options?.writeStoryboardIndex === false ? undefined : item.index ?? rowIndex + 1,
            createTime: Date.now(),
          });
          if (associateAssetsIds.length) {
            await trx("o_assets2Storyboard").insert(
              associateAssetsIds.map((assetId) => ({
                assetId,
                storyboardId: id,
              })),
            );
          }
          storyboardRows.push({ id, track: item.track, duration: item.duration, associateAssetsIds });
        }

        const allStoryboards = await trx("o_storyboard").where({ scriptId, projectId });
        const storyboardGroupByTrack: Record<string, number[]> = {};
        allStoryboards.forEach((item: { id?: number; track?: string }) => {
          if (!item.track || !item.id) return;
          if (!storyboardGroupByTrack[item.track]) storyboardGroupByTrack[item.track] = [];
          storyboardGroupByTrack[item.track].push(item.id);
        });

        let index = 0;
        for (const track in storyboardGroupByTrack) {
          const storyboardIds = storyboardGroupByTrack[track] ?? [];
          const trackDuration = allStoryboards.filter((item: { track?: string }) => item.track === track).reduce((sum: number, item: { duration?: string | number }) => sum + Number(item.duration ?? 0), 0);
          const existingStoryboard = await trx("o_storyboard").where({ scriptId, projectId, track }).whereNotNull("trackId").first();
          let trackId: number;
          if (existingStoryboard?.trackId) {
            trackId = existingStoryboard.trackId;
            await trx("o_videoTrack").where("id", trackId).update({ duration: trackDuration });
          } else {
            trackId = Date.now() + index++;
            await trx("o_videoTrack").insert({
              id: trackId,
              scriptId,
              projectId,
              duration: trackDuration,
            });
          }
          await trx("o_storyboard").whereIn("id", storyboardIds).update({ trackId });
        }

        const insertedIds = storyboardRows.map((item) => item.id);
        const rows = await trx("o_storyboard").whereIn("id", insertedIds).orderBy("index");
        const mapped = await Promise.all(
          rows.map(async (item: { id: number; trackId?: number; prompt?: string; duration?: string | number; state?: string; scriptId?: number; projectId?: number; track?: string; reason?: string; videoDesc?: string; shouldGenerateImage?: number; filePath?: string }) => ({
            id: item.id,
            trackId: item.trackId,
            prompt: item.prompt,
            duration: Number(item.duration),
            state: item.state,
            scriptId: item.scriptId,
            projectId: item.projectId,
            track: item.track,
            reason: item.reason,
            videoDesc: item.videoDesc,
            shouldGenerateImage: item.shouldGenerateImage,
            associateAssetsIds: await trx("o_assets2Storyboard").where("storyboardId", item.id).orderBy("rowid").select("assetId").pluck("assetId"),
            src: item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "",
          })),
        );

        return { data: mapped, total: mapped.length, scriptId };
      });

      res.status(200).send(success(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "分镜表提交失败";
      res.status(400).send(error(message));
    }
  },
);
