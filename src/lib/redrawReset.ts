import { redrawDb } from "@/lib/redrawCommon";
import u from "@/utils";

export async function resetRedrawWorkflow(projectId: number) {
  const source = await redrawDb("o_redrawSource").where("projectId", projectId).first();
  if (!source) return;
  const scripts = await redrawDb("o_script").where("projectId", projectId).select("id");
  const scriptIds = scripts.map((item: any) => item.id);
  const assets = await redrawDb("o_assets").where("projectId", projectId).select("id", "imageId");
  const assetIds = assets.map((item: any) => item.id);
  const imageIds = assets.map((item: any) => item.imageId).filter(Boolean);
  const storyboards = await redrawDb("o_storyboard").where("projectId", projectId).select("id");
  const storyboardIds = storyboards.map((item: any) => item.id);

  await redrawDb.transaction(async (trx: any) => {
    if (storyboardIds.length) await trx("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
    if (scriptIds.length) await trx("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
    if (assetIds.length) await trx("o_assets").whereIn("id", assetIds).update({ imageId: null });
    if (imageIds.length) await trx("o_image").whereIn("id", imageIds).delete();
    await trx("o_video").where("projectId", projectId).delete();
    await trx("o_videoTrack").where("projectId", projectId).delete();
    await trx("o_storyboard").where("projectId", projectId).delete();
    await trx("o_assets").where("projectId", projectId).delete();
    await trx("o_script").where("projectId", projectId).delete();
    await trx("o_redrawShot").where("projectId", projectId).delete();
    await trx("o_redrawSegment").where("projectId", projectId).delete();
    await trx("o_redrawOutput").where("projectId", projectId).delete();
    await trx("o_redrawReference").where({ projectId, kind: "sourceEvidence" }).delete();
    await trx("o_workflowStepRun").where("projectId", projectId).delete();
    await trx("o_redrawSource").where("id", source.id).update({
      sourceStyle: null,
      analysisState: "pending",
      errorReason: null,
      scriptId: null,
      confirmed: false,
      updateTime: Date.now(),
    });
  });
  for (const directory of ["analysis", "segments", "generated", "output"]) {
    await u.oss.deleteDirectory(`${projectId}/redraw/${directory}`).catch(() => {});
  }
}
