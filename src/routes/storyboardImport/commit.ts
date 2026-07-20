import express from "express";
import u from "@/utils";
import { db } from "@/utils/db";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import {
  associateBatchStoryboardTools,
  buildStoryboardAssetStats,
  collectStoryboardAssetRefs,
  StoryboardAssetMeta,
  StoryboardAssetStats,
  StoryboardAssetRef,
  storyboardAssetStatsEqual,
} from "@/lib/storyboardImportAssets";
import { validateFields } from "@/middleware/middleware";
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
import { resolveExactRoleAssociations } from "@/lib/storyboardAssetAssociations";

const router = express.Router();

type ImportMeta = StoryboardAssetMeta;
type AssetRef = StoryboardAssetRef;

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
  scene?: string;
  visualContent?: string;
  props?: string;
};

type StoryboardImportOptions = {
  createScriptAssets?: boolean;
  useReferenceAssetDescriptions?: boolean;
  writeStoryboardIndex?: boolean;
};

function uniqueNumbers(ids: number[]) {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

function normalizeComparableText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function extractShotNo(videoDesc: unknown): string {
  return normalizeComparableText(videoDesc).match(/(?:^|\n)镜号[：:]\s*([^\n]+)/)?.[1]?.trim() ?? "";
}

function buildDuplicateKey(shotNo: unknown, index: unknown): string {
  const normalizedShotNo = normalizeComparableText(shotNo);
  if (normalizedShotNo) return `shot:${normalizedShotNo.toLowerCase()}`;
  return Number.isInteger(index) && Number(index) > 0 ? `index:${Number(index)}` : "";
}

function buildImportIndex(item: StoryboardImportItem, rowIndex: number, options?: StoryboardImportOptions): number | undefined {
  if (options?.writeStoryboardIndex === false) return undefined;
  if (Number.isInteger(item.index) && Number(item.index) > 0) return Number(item.index);
  return rowIndex + 1;
}

function normalizeStoryboardFilePath(src?: string | null): string {
  const value = src?.trim();
  if (!value || /^data:/i.test(value) || /^\/\//.test(value)) return "";
  const isHttpUrl = /^https?:\/\//i.test(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !isHttpUrl) return "";
  if (isHttpUrl) {
    try {
      const pathname = new URL(value).pathname;
      if (!/^\/(?:oss|smallImage)\//.test(pathname) && !/\/[^/]+\.[A-Za-z0-9]{2,8}$/.test(pathname)) return "";
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

async function ensureAssets(db: any, projectId: number, item: StoryboardImportItem, meta?: ImportMeta, options?: StoryboardImportOptions) {
  const assetRefs = collectStoryboardAssetRefs(item, meta);
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
  const autoAssetIds = assetRefs.map((asset) => Number(nextAssetKeyMap.get(`${asset.type}:${asset.name}`)));
  const unresolvedAssets = assetRefs.filter((_asset, index) => !Number.isFinite(autoAssetIds[index]));
  if (unresolvedAssets.length) throw new Error(`资产创建后无法解析 ID：${unresolvedAssets.map((asset) => `${asset.type}:${asset.name}`).join("、")}`);
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

async function validateAssociatedAssets(db: any, projectId: number, data: StoryboardImportItem[]) {
  const rawIds = data.flatMap((item) => item.associateAssetsIds ?? []);
  const invalidIds = [...new Set(rawIds.filter((id) => !Number.isInteger(id) || id <= 0))];
  if (invalidIds.length) throw new Error(`关联资产 ID 无效：${invalidIds.join(", ")}`);
  const requestedIds = uniqueNumbers(rawIds);
  if (!requestedIds.length) return;

  const assets = await db("o_assets").whereIn("id", requestedIds).select("id", "projectId");
  const assetMap = new Map(assets.map((asset: { id: number; projectId?: number }) => [Number(asset.id), Number(asset.projectId)]));
  const missingIds = requestedIds.filter((id) => !assetMap.has(id));
  const crossProjectIds = requestedIds.filter((id) => assetMap.has(id) && assetMap.get(id) !== projectId);
  if (missingIds.length) throw new Error(`关联资产不存在：${missingIds.join(", ")}`);
  if (crossProjectIds.length) throw new Error(`关联资产不属于当前项目：${crossProjectIds.join(", ")}`);
}

async function insertMissingScriptAssets(db: any, scriptId: number, assetIds: number[]) {
  for (const assetId of uniqueNumbers(assetIds)) {
    const existing = await db("o_scriptAssets").where({ scriptId, assetId }).first();
    if (!existing) await db("o_scriptAssets").insert({ scriptId, assetId });
  }
}

async function buildRelationRows(
  db: any,
  storyboardId: number,
  assetIds: number[],
  existingRelations: Map<number, { assetRevision?: number; referenceEnabled?: number }> = new Map(),
) {
  const assets = assetIds.length ? await db("o_assets").whereIn("id", assetIds).select("id", "revision") : [];
  const revisionByAssetId = new Map(assets.map((asset: { id: number; revision?: number }) => [Number(asset.id), Number(asset.revision ?? 1)]));
  return assetIds.map((assetId) => {
    const existing = existingRelations.get(assetId);
    return {
      assetId,
      storyboardId,
      assetRevision: Number(existing?.assetRevision ?? revisionByAssetId.get(assetId) ?? 1),
      referenceEnabled: existing?.referenceEnabled === 0 ? 0 : 1,
    };
  });
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
        scene: z.string().optional(),
        visualContent: z.string().optional(),
        props: z.string().optional(),
      }),
    ),
    meta: z
      .object({
        roles: z.array(z.object({ name: z.string(), age: z.string().optional(), appearance: z.string().optional(), costume: z.string().optional(), personality: z.string().optional() })).optional(),
        scenes: z.array(z.object({ name: z.string(), time: z.string().optional(), color: z.string().optional(), elements: z.string().optional(), atmosphere: z.string().optional() })).optional(),
        assetStats: z
          .object({
            roles: z.number().int().nonnegative(),
            scenes: z.number().int().nonnegative(),
            tools: z.number().int().nonnegative(),
            total: z.number().int().nonnegative(),
          })
          .optional(),
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
    const { data: submittedData, projectId, scriptName, meta, options } = req.body as { data: StoryboardImportItem[]; scriptId?: number | null; projectId: number; scriptName?: string | null; meta?: ImportMeta; options?: StoryboardImportOptions };
    if (!submittedData.length) return res.status(400).send(error("数据不能为空"));
    const data = associateBatchStoryboardTools(submittedData);
    const effectiveAssetStats = buildStoryboardAssetStats(data);
    if (meta?.assetStats && !storyboardAssetStatsEqual(meta.assetStats, effectiveAssetStats)) {
      return res.status(400).send(error(`资产统计与分镜行资产不一致，请重新解析分镜表后再提交。提交统计：${JSON.stringify(meta.assetStats)}；实际统计：${JSON.stringify(effectiveAssetStats)}`));
    }

    try {
      const result = await db.transaction(async (trx: any) => {
        const project = await trx("o_project").where("id", projectId).select("projectType").first();
        if (!project) throw new Error("未找到对应项目");
        if (normalizeProjectType(project.projectType ?? "") !== ProjectTypes.storyboard) throw new Error("仅基于分镜表的项目支持导入分镜表");

        const scriptId = await ensureScript(trx, projectId, req.body.scriptId, scriptName);
        await validateAssociatedAssets(trx, projectId, data);
        const storyboardRows: { id: number; track: string; duration: number; associateAssetsIds: number[] }[] = [];
        const warnings: string[] = [];
        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        const existingStoryboards = await trx("o_storyboard").where({ scriptId, projectId }).orderBy("id");
        const existingIds = existingStoryboards.map((item: { id?: number }) => Number(item.id)).filter((id: number) => Number.isInteger(id));
        const existingRelations = existingIds.length
          ? await trx("o_assets2Storyboard").whereIn("storyboardId", existingIds).select("storyboardId", "assetId", "assetRevision", "referenceEnabled")
          : [];
        const existingAssetIdsByStoryboard = (existingRelations as { storyboardId: number; assetId: number }[]).reduce((result, relation) => {
          const ids = result.get(Number(relation.storyboardId)) ?? [];
          ids.push(Number(relation.assetId));
          result.set(Number(relation.storyboardId), ids);
          return result;
        }, new Map<number, number[]>());
        const existingRelationMetaByStoryboard = (existingRelations as { storyboardId: number; assetId: number; assetRevision?: number; referenceEnabled?: number }[]).reduce((result, relation) => {
          const relations = result.get(Number(relation.storyboardId)) ?? new Map<number, { assetRevision?: number; referenceEnabled?: number }>();
          relations.set(Number(relation.assetId), { assetRevision: relation.assetRevision, referenceEnabled: relation.referenceEnabled });
          result.set(Number(relation.storyboardId), relations);
          return result;
        }, new Map<number, Map<number, { assetRevision?: number; referenceEnabled?: number }>>());
        const existingByShotNo = new Map<string, any>();
        const existingByIndex = new Map<string, any>();
        const existingShotNoCounts = new Map<string, number>();
        const existingIndexCounts = new Map<string, number>();
        existingStoryboards.forEach((item: any) => {
          const existing = { ...item, associateAssetsIds: existingAssetIdsByStoryboard.get(Number(item.id)) ?? [] };
          const shotKey = buildDuplicateKey(extractShotNo(item.videoDesc), undefined);
          const indexKey = buildDuplicateKey(undefined, item.index);
          if (shotKey) {
            existingShotNoCounts.set(shotKey, (existingShotNoCounts.get(shotKey) ?? 0) + 1);
            if (!existingByShotNo.has(shotKey)) existingByShotNo.set(shotKey, existing);
          }
          if (indexKey) {
            existingIndexCounts.set(indexKey, (existingIndexCounts.get(indexKey) ?? 0) + 1);
            if (!existingByIndex.has(indexKey)) existingByIndex.set(indexKey, existing);
          }
        });
        const submittedKeys = new Set<string>();

        for (const [rowIndex, item] of data.entries()) {
          const importIndex = buildImportIndex(item, rowIndex, options);
          const duplicateKey = buildDuplicateKey(item.shotNo, options?.writeStoryboardIndex === false ? undefined : item.index);
          const shotKey = buildDuplicateKey(item.shotNo, undefined);
          const indexKey = buildDuplicateKey(undefined, options?.writeStoryboardIndex === false ? undefined : item.index);
          if (duplicateKey && submittedKeys.has(duplicateKey)) {
            skipped += 1;
            warnings.push(`第 ${rowIndex + 1} 条分镜与本次提交中的镜号/序号重复，已跳过`);
            continue;
          }
          if (duplicateKey) submittedKeys.add(duplicateKey);

          let associateAssetsIds = await ensureAssets(trx, projectId, item, meta, options);
          if (options?.createScriptAssets !== false) await insertMissingScriptAssets(trx, scriptId, associateAssetsIds);
          const videoDesc = item.shotNo && !item.videoDesc.includes("镜号：") ? `镜号：${item.shotNo}\n${item.videoDesc}` : item.videoDesc;
          const importedFilePath = normalizeStoryboardFilePath(item.src);
          const shotMatch = shotKey && existingShotNoCounts.get(shotKey) === 1 ? existingByShotNo.get(shotKey) : undefined;
          const indexMatch = indexKey && existingIndexCounts.get(indexKey) === 1 ? existingByIndex.get(indexKey) : undefined;
          const existing = shotKey ? shotMatch : indexMatch;
          const exactRoleMatches = await resolveExactRoleAssociations(trx, {
            projectId,
            scriptId,
            storyboardId: existing ? Number(existing.id) : undefined,
            prompt: item.prompt,
            videoDesc,
            projectFallback: !req.body.scriptId,
          });
          const exactRoleAssetIds = exactRoleMatches.matched.map((match) => Number(match.id));
          associateAssetsIds = uniqueNumbers([
            ...associateAssetsIds,
            ...((existing?.associateAssetsIds ?? []) as number[]),
            ...exactRoleAssetIds,
          ]);
          if (exactRoleAssetIds.length) await insertMissingScriptAssets(trx, scriptId, exactRoleAssetIds);
          if (options?.createScriptAssets !== false) await insertMissingScriptAssets(trx, scriptId, associateAssetsIds);
          const filePath = existing && !importedFilePath ? normalizeComparableText(existing.filePath) : importedFilePath;
          const preserveExistingImage = Boolean(existing?.filePath && !importedFilePath);
          const state = filePath ? "已完成" : "未生成";
          const shouldGenerateImage = preserveExistingImage ? Number(existing.shouldGenerateImage) : filePath ? 1 : item.shouldGenerateImage;
          let id: number;

          if (existing) {
            id = Number(existing.id);
            const nextShouldGenerateImage = shouldGenerateImage;
            const nextState = state;
            const unchanged =
              normalizeComparableText(existing.prompt) === normalizeComparableText(item.prompt) &&
              Number(existing.duration) === Number(item.duration) &&
              normalizeComparableText(existing.track) === normalizeComparableText(item.track || "默认分组") &&
              normalizeComparableText(existing.videoDesc) === normalizeComparableText(videoDesc) &&
              normalizeComparableText(existing.state) === nextState &&
              Number(existing.shouldGenerateImage) === Number(nextShouldGenerateImage) &&
              normalizeComparableText(existing.filePath) === filePath &&
              uniqueNumbers((existing.associateAssetsIds ?? []).map(Number)).sort((a, b) => a - b).join(",") === uniqueNumbers(associateAssetsIds).sort((a, b) => a - b).join(",");
            if (unchanged) {
              skipped += 1;
              warnings.push(`第 ${rowIndex + 1} 条分镜已存在且内容未变化，已跳过`);
            } else {
              await trx("o_storyboard").where({ id, scriptId, projectId }).update({
                prompt: item.prompt,
                duration: String(item.duration),
                state,
                filePath,
                track: item.track,
                videoDesc,
                shouldGenerateImage,
                index: importIndex,
              });
              await trx("o_assets2Storyboard").where("storyboardId", id).delete();
              if (associateAssetsIds.length) {
                await trx("o_assets2Storyboard").insert(await buildRelationRows(trx, id, associateAssetsIds, existingRelationMetaByStoryboard.get(id)));
              }
              updated += 1;
            }
          } else {
            [id] = await trx("o_storyboard").insert({
              prompt: item.prompt,
              duration: String(item.duration),
              state,
              filePath,
              scriptId,
              projectId,
              track: item.track,
              videoDesc,
              shouldGenerateImage: filePath ? 1 : item.shouldGenerateImage,
              index: importIndex,
              createTime: Date.now(),
            });
            if (associateAssetsIds.length) {
              await trx("o_assets2Storyboard").insert(await buildRelationRows(trx, id, associateAssetsIds));
            }
            inserted += 1;
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

        return { data: mapped, total: mapped.length, scriptId, inserted, updated, skipped, warnings };
      });

      res.status(200).send(success(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "分镜表提交失败";
      res.status(400).send(error(message));
    }
  },
);
