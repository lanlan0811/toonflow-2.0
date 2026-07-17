import crypto from "node:crypto";
import { ProjectTypes } from "@/constants/project";
import { redrawStepConfigList, redrawTargetStyleSchema, type RedrawStep } from "@/constants/redraw";
import u from "@/utils";

export const redrawDb = u.db as any;

let idCounter = 0;
export function createRedrawId() {
  idCounter = (idCounter + 1) % 1000;
  return Date.now() * 1000 + idCounter;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function requireRedrawProject(projectId: number) {
  const project = await redrawDb("o_project").where("id", projectId).first();
  if (!project) throw new Error("项目不存在");
  if (project.projectType !== ProjectTypes.redraw) throw new Error("projectId 必须属于转绘项目");
  return project;
}

export async function getOrCreateRedrawSource(projectId: number) {
  const existing = await redrawDb("o_redrawSource").where("projectId", projectId).first();
  if (existing) return existing;
  const now = Date.now();
  const targetStyle = redrawTargetStyleSchema.parse({});
  const [id] = await redrawDb("o_redrawSource").insert({
    projectId,
    targetStyle: JSON.stringify(targetStyle),
    analysisState: "pending",
    confirmed: false,
    createTime: now,
    updateTime: now,
  });
  return redrawDb("o_redrawSource").where("id", id).first();
}

export function stableHash(value: unknown) {
  const normalize = (input: any): any => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
    }
    return input;
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function validateShotTimeline(shots: { id?: number; startMs: number; endMs: number }[], durationMs: number, frameToleranceMs = 0) {
  if (!shots.length) throw new Error("镜头时间轴不能为空");
  const ordered = [...shots].sort((a, b) => a.startMs - b.startMs);
  if (Math.abs(ordered[0].startMs) > frameToleranceMs) throw new Error("首个镜头必须从 0 开始");
  for (let index = 0; index < ordered.length; index += 1) {
    const shot = ordered[index];
    if (!Number.isFinite(shot.startMs) || !Number.isFinite(shot.endMs) || shot.endMs <= shot.startMs) {
      throw new Error(`第 ${index + 1} 个镜头时间范围无效`);
    }
    if (index > 0) {
      const delta = shot.startMs - ordered[index - 1].endMs;
      if (Math.abs(delta) > frameToleranceMs) throw new Error(`镜头 ${index} 与镜头 ${index + 1} 之间存在${delta > 0 ? "缺口" : "重叠"}`);
    }
  }
  if (Math.abs(ordered[ordered.length - 1].endMs - durationMs) > frameToleranceMs) throw new Error("最后一个镜头必须结束于源视频末尾");
  return ordered;
}

export async function invalidateRedrawFrom(projectId: number, step: RedrawStep, reason: string) {
  const startOrder = redrawStepConfigList.find((item) => item.key === step)?.order ?? 0;
  const steps = redrawStepConfigList.filter((item) => item.order >= startOrder).map((item) => item.key);
  await redrawDb("o_workflowStepRun")
    .where("projectId", projectId)
    .whereIn("step", steps)
    .whereIn("state", ["success", "empty", "confirmed"])
    .update({ state: "stale", errorReason: reason, updateTime: Date.now() });
}

export async function invalidateRedrawAfter(projectId: number, step: RedrawStep, reason: string) {
  const currentOrder = redrawStepConfigList.find((item) => item.key === step)?.order ?? 0;
  const steps = redrawStepConfigList.filter((item) => item.order > currentOrder).map((item) => item.key);
  if (!steps.length) return;
  await redrawDb("o_workflowStepRun")
    .where("projectId", projectId)
    .whereIn("step", steps)
    .whereIn("state", ["success", "empty", "confirmed"])
    .update({ state: "stale", errorReason: reason, updateTime: Date.now() });
}

export async function assertStepConfirmed(projectId: number, step: RedrawStep) {
  const record = await redrawDb("o_workflowStepRun").where({ projectId, step, state: "confirmed" }).orderBy("id", "desc").first();
  if (!record) throw new Error(`前置步骤 ${step} 尚未完成人工确认`);
  return record;
}

export async function getLatestStepRuns(projectId: number) {
  const rows = await redrawDb("o_workflowStepRun").where("projectId", projectId).orderBy("id", "desc");
  const map = new Map<string, any>();
  for (const row of rows) if (!map.has(row.step)) map.set(row.step, row);
  return redrawStepConfigList.map((config) => ({ ...config, run: map.get(config.key) ?? null }));
}
