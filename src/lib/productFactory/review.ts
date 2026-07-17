import u from "@/utils";
import { ensureProductWorkflow, refreshProductFactoryItemState, updateProductWorkflow } from "@/lib/productFactory/service";

export interface ReviewSelection {
  artifactId: number;
}

export async function submitProductFactoryReview(
  projectId: number,
  productId: number,
  selections: ReviewSelection[],
  reviewMappings?: Record<string, number | null>,
) {
  const workflow = await ensureProductWorkflow(projectId, productId);
  const ids = [...new Set(selections.map((selection) => Number(selection.artifactId)).filter((id) => Number.isInteger(id) && id > 0))];
  const artifacts = ids.length
    ? await u.db("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success" }).whereIn("id", ids)
    : [];
  if (artifacts.length !== ids.length) throw new Error("审核选择包含不存在、失败或不属于该商品的图片");
  await u.db.transaction(async (trx) => {
    for (const artifact of artifacts) {
      await trx("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", slotKey: artifact.slotKey, aspectRatio: artifact.aspectRatio }).update({ approved: 0, isCurrent: 0, updateTime: Date.now() });
      await trx("o_productFactoryArtifact").where("id", artifact.id).update({ approved: 1, isCurrent: 1, updateTime: Date.now() });
    }
  });
  const allowedIds = new Set(artifacts.map((artifact) => Number(artifact.id)));
  const approvedRows = await u.db("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success", approved: 1 });
  for (const row of approvedRows) allowedIds.add(Number(row.id));
  if (reviewMappings) {
    for (const [key, value] of Object.entries(reviewMappings)) {
      const id = value === null ? null : Number(value);
      if (id !== null && !allowedIds.has(id)) throw new Error(`视频来源 ${key} 必须引用已批准图片`);
      workflow.graph.reviewMappings[key] = id;
    }
  } else {
    for (const ratio of ["9:16", "16:9"]) {
      const hero = approvedRows.find((row) => row.slotKey === "scene_studio" && row.aspectRatio === ratio);
      const lifestyle = approvedRows.find((row) => row.slotKey === "scene_lifestyle" && row.aspectRatio === ratio);
      workflow.graph.reviewMappings[`video_hero:${ratio}`] = hero?.id ? Number(hero.id) : null;
      workflow.graph.reviewMappings[`video_lifestyle:${ratio}`] = lifestyle?.id ? Number(lifestyle.id) : null;
    }
  }
  await updateProductWorkflow(projectId, productId, workflow.graph, Boolean(workflow.customized), false);
  const state = await refreshProductFactoryItemState(projectId, productId);
  return { approvedArtifactIds: [...allowedIds], reviewMappings: workflow.graph.reviewMappings, state };
}
