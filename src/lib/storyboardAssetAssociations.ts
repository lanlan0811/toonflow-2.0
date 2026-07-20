export type ExactRoleAsset = {
  id: number;
  name: string;
  type?: string | null;
  projectId?: number | null;
  imageId?: number | null;
  revision?: number | null;
};

export type ExactRoleMatchResult = {
  matched: ExactRoleAsset[];
  ambiguous: { name: string; assetIds: number[] }[];
};

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function storyboardRoleText(prompt: unknown, videoDesc: unknown) {
  return `${normalized(prompt)}\n${normalized(videoDesc)}`.trim();
}

/**
 * Matches literal role names. When names overlap at the same occurrence, the
 * longest asset name wins (for example, "李姐" wins over "李").
 */
export function findExactRoleMatches(textValue: unknown, assets: ExactRoleAsset[]): ExactRoleMatchResult {
  const text = normalized(textValue);
  const byName = new Map<string, ExactRoleAsset[]>();
  assets.forEach((asset) => {
    const name = normalized(asset.name);
    if (!name || asset.type && asset.type !== "role") return;
    const list = byName.get(name) ?? [];
    list.push({ ...asset, name });
    byName.set(name, list);
  });

  const ambiguous: { name: string; assetIds: number[] }[] = [];
  const candidates: { asset: ExactRoleAsset; start: number; end: number }[] = [];
  [...byName.entries()].forEach(([name, rows]) => {
    if (rows.length > 1) {
      ambiguous.push({ name, assetIds: rows.map((item) => Number(item.id)) });
      return;
    }
    let cursor = text.indexOf(name);
    while (cursor >= 0) {
      candidates.push({ asset: rows[0], start: cursor, end: cursor + name.length });
      cursor = text.indexOf(name, cursor + Math.max(1, name.length));
    }
  });

  candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const accepted: typeof candidates = [];
  candidates.forEach((candidate) => {
    const coveredByLonger = accepted.some(
      (item) => item.start <= candidate.start && item.end >= candidate.end && item.end - item.start > candidate.end - candidate.start,
    );
    if (!coveredByLonger) accepted.push(candidate);
  });

  const ids = new Set<number>();
  const matched = accepted
    .map((item) => item.asset)
    .filter((asset) => {
      const id = Number(asset.id);
      if (!Number.isInteger(id) || id <= 0 || ids.has(id)) return false;
      ids.add(id);
      return true;
    });
  return { matched, ambiguous };
}

export async function loadEligibleRoleAssets(db: any, projectId: number, scriptId?: number | null, projectFallback = false) {
  const query = db("o_assets")
    .where("o_assets.projectId", projectId)
    .where("o_assets.type", "role")
    .select("o_assets.id", "o_assets.name", "o_assets.type", "o_assets.projectId", "o_assets.imageId", "o_assets.revision");
  if (scriptId && !projectFallback) {
    query.join("o_scriptAssets", "o_scriptAssets.assetId", "o_assets.id").where("o_scriptAssets.scriptId", scriptId);
  }
  return (await query.distinct()) as ExactRoleAsset[];
}

export async function resolveExactRoleAssociations(
  db: any,
  input: { projectId: number; scriptId?: number | null; prompt?: unknown; videoDesc?: unknown; storyboardId?: number; projectFallback?: boolean },
) {
  const roles = await loadEligibleRoleAssets(db, input.projectId, input.scriptId, input.projectFallback);
  const result = findExactRoleMatches(storyboardRoleText(input.prompt, input.videoDesc), roles);
  const excludedIds = new Set<number>();
  if (input.storyboardId && (await db.schema.hasTable("o_storyboardAssetExclusion"))) {
    const rows = await db("o_storyboardAssetExclusion").where("storyboardId", input.storyboardId).select("assetId");
    rows.forEach((row: { assetId: number }) => excludedIds.add(Number(row.assetId)));
  }
  return { ...result, matched: result.matched.filter((asset) => !excludedIds.has(Number(asset.id))), excludedIds };
}

export async function insertStoryboardAssetRelations(db: any, storyboardId: number, assets: ExactRoleAsset[]) {
  if (!assets.length) return 0;
  const existing = new Set<number>(
    (await db("o_assets2Storyboard").where("storyboardId", storyboardId).select("assetId")).map((row: { assetId: number }) => Number(row.assetId)),
  );
  const additions = assets.filter((asset) => !existing.has(Number(asset.id)));
  if (!additions.length) return 0;
  await db("o_assets2Storyboard").insert(
    additions.map((asset) => ({
      storyboardId,
      assetId: Number(asset.id),
      assetRevision: Math.max(1, Number(asset.revision || 1)),
      referenceEnabled: 1,
    })),
  );
  return additions.length;
}

export async function ensureExactRoleAssociations(
  db: any,
  input: { storyboardId: number; projectId: number; scriptId: number; prompt?: unknown; videoDesc?: unknown },
) {
  const project = await db("o_project").where("id", input.projectId).select("projectType").first();
  if (!project || normalizeProjectType(String(project.projectType ?? "")) !== ProjectTypes.storyboard) {
    return { matched: [], ambiguous: [], excludedIds: new Set<number>(), added: 0 };
  }
  const result = await resolveExactRoleAssociations(db, input);
  const added = await insertStoryboardAssetRelations(db, input.storyboardId, result.matched);
  return { ...result, added };
}
import { normalizeProjectType, ProjectTypes } from "@/constants/project";
