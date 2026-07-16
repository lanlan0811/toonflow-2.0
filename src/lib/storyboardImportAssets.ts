export type StoryboardAssetType = "role" | "scene" | "tool";

export type StoryboardAssetStats = {
  roles: number;
  scenes: number;
  tools: number;
  total: number;
};

export type StoryboardRoleReference = {
  name: string;
  age?: string;
  appearance?: string;
  costume?: string;
  personality?: string;
};

export type StoryboardSceneReference = {
  name: string;
  time?: string;
  color?: string;
  elements?: string;
  atmosphere?: string;
};

export type StoryboardAssetMeta = {
  roles?: StoryboardRoleReference[];
  scenes?: StoryboardSceneReference[];
  assetStats?: StoryboardAssetStats;
};

export type StoryboardAssetRow = {
  shotNo?: string;
  roleNames?: string[];
  sceneNames?: string[];
  toolNames?: string[];
  scene?: string;
  visualContent?: string;
  videoDesc?: string;
  track?: string;
  props?: string;
};

export type StoryboardAssetRef = {
  name: string;
  type: StoryboardAssetType;
  describe: string;
};

export function normalizeStoryboardAssetName(value: unknown): string {
  return String(value ?? "").trim();
}

function uniqueNames(values: unknown[]): string[] {
  return [...new Set(values.map(normalizeStoryboardAssetName).filter(Boolean))];
}

function splitContextList(value: unknown): string[] {
  const text = normalizeStoryboardAssetName(value);
  if (!text) return [];
  const result: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "（" || char === "(" || char === "【" || char === "[") depth += 1;
    if (char === "）" || char === ")" || char === "】" || char === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[、,，|；;\n]/.test(char)) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return uniqueNames(result);
}

export function normalizeStoryboardToolName(value: unknown): string {
  const text = normalizeStoryboardAssetName(value);
  const name = text.replace(/^(?:道具|陈设)[：:]\s*/, "").replace(/\s*[（(【\[].*?[）)】\]]\s*$/u, "").trim();
  return name || text;
}

export function extractExplicitStoryboardToolNames(value: unknown): string[] {
  return uniqueNames(splitContextList(value).map(normalizeStoryboardToolName));
}

function extractSceneContexts(row: StoryboardAssetRow): string[] {
  const contexts = [row.scene, row.track].map(normalizeStoryboardAssetName).filter(Boolean);
  const videoDesc = normalizeStoryboardAssetName(row.videoDesc);
  const sceneLines = [...videoDesc.matchAll(/(?:^|\n)场景[：:]\s*([^\n]+)/g)].map((match) => normalizeStoryboardAssetName(match[1])).filter(Boolean);
  return uniqueNames([...contexts, ...sceneLines]);
}

function canMatchToolName(name: string): boolean {
  if (/^[\u4e00-\u9fff]+$/u.test(name)) return name.length >= 2;
  return name.length >= 3;
}

export function associateBatchStoryboardTools<T extends StoryboardAssetRow>(rows: T[]): T[] {
  const knownToolNames = uniqueNames(rows.flatMap((row) => row.toolNames ?? []))
    .filter(canMatchToolName)
    .sort((a, b) => b.length - a.length);
  if (!knownToolNames.length) return rows.map((row) => ({ ...row, toolNames: uniqueNames(row.toolNames ?? []) }));

  return rows.map((row) => {
    const contexts = extractSceneContexts(row);
    const matchedToolNames = knownToolNames.filter((name) => contexts.some((context) => context.includes(name)));
    return { ...row, toolNames: uniqueNames([...(row.toolNames ?? []), ...matchedToolNames]) };
  });
}

export function collectEffectiveStoryboardAssetNames(rows: StoryboardAssetRow[]) {
  return {
    roles: uniqueNames(rows.flatMap((row) => row.roleNames ?? [])),
    scenes: uniqueNames(rows.flatMap((row) => row.sceneNames ?? [])),
    tools: uniqueNames(rows.flatMap((row) => row.toolNames ?? [])),
  };
}

export function buildStoryboardAssetStats(rows: StoryboardAssetRow[]): StoryboardAssetStats {
  const names = collectEffectiveStoryboardAssetNames(rows);
  return {
    roles: names.roles.length,
    scenes: names.scenes.length,
    tools: names.tools.length,
    total: names.roles.length + names.scenes.length + names.tools.length,
  };
}

export function findStoryboardReferenceGaps(rows: StoryboardAssetRow[], meta?: StoryboardAssetMeta) {
  const names = collectEffectiveStoryboardAssetNames(rows);
  const roleReferences = uniqueNames((meta?.roles ?? []).map((item) => item.name));
  const sceneReferences = uniqueNames((meta?.scenes ?? []).map((item) => item.name));
  return {
    unusedRoles: roleReferences.filter((name) => !names.roles.includes(name)),
    missingScenes: names.scenes.filter((name) => !sceneReferences.some((reference) => name === reference || name.includes(reference) || reference.includes(name))),
  };
}

export function storyboardAssetStatsEqual(left?: StoryboardAssetStats, right?: StoryboardAssetStats): boolean {
  if (!left || !right) return false;
  return left.roles === right.roles && left.scenes === right.scenes && left.tools === right.tools && left.total === right.total;
}

function buildRoleDescribe(role: StoryboardRoleReference) {
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

function buildSceneDescribe(scene: StoryboardSceneReference) {
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

export function buildStoryboardToolDescribe(name: string, row: StoryboardAssetRow) {
  const isExplicit = extractExplicitStoryboardToolNames(row.props).includes(name);
  if (!isExplicit) return name;
  return [`道具：${name}`, row.shotNo ? `出现镜头：${row.shotNo}` : "", row.props ? `道具/陈设上下文：${row.props}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function collectStoryboardAssetRefs(row: StoryboardAssetRow, meta?: StoryboardAssetMeta): StoryboardAssetRef[] {
  const refs: StoryboardAssetRef[] = [];
  const fields: { key: "roleNames" | "sceneNames" | "toolNames"; type: StoryboardAssetType }[] = [
    { key: "roleNames", type: "role" },
    { key: "sceneNames", type: "scene" },
    { key: "toolNames", type: "tool" },
  ];

  for (const field of fields) {
    for (const rawName of row[field.key] ?? []) {
      const name = normalizeStoryboardAssetName(rawName);
      if (!name) continue;
      let describe = name;
      if (field.type === "role") {
        const role = meta?.roles?.find((item) => normalizeStoryboardAssetName(item.name) === name);
        if (role) describe = buildRoleDescribe(role);
      } else if (field.type === "scene") {
        const sceneReferences = meta?.scenes ?? [];
        const scene =
          sceneReferences.find((item) => normalizeStoryboardAssetName(item.name) === name) ??
          sceneReferences
            .filter((item) => {
              const referenceName = normalizeStoryboardAssetName(item.name);
              return name.includes(referenceName) || referenceName.includes(name);
            })
            .sort((a, b) => normalizeStoryboardAssetName(b.name).length - normalizeStoryboardAssetName(a.name).length)[0];
        if (scene) describe = buildSceneDescribe(scene);
      } else {
        describe = buildStoryboardToolDescribe(name, row);
      }
      refs.push({ name, type: field.type, describe });
    }
  }

  return [...new Map(refs.map((item) => [`${item.type}:${item.name}`, item])).values()];
}
