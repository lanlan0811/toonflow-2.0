import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import ensureInfiniteCanvasSchema from "@/lib/infiniteCanvas/schema";

const router = express.Router();

export async function deleteProjectById(id: number) {
  await ensureInfiniteCanvasSchema(u.db);
  await u.db.transaction(async (trx) => {
    for (const table of [
      "o_infiniteCanvasArtifact",
      "o_infiniteCanvasWorkspace",
      "o_productFactoryJob",
      "o_productFactoryArtifact",
      "o_productFactoryWorkflow",
      "o_productFactoryReference",
      "o_productFactoryItem",
      "o_productFactoryConfig",
    ]) {
      if (await trx.schema.hasTable(table)) await trx(table).where("projectId", id).delete();
    }
  });
  try { await u.oss.deleteDirectory(`product-factory/${id}`); } catch { /* directory may not exist */ }

  await u.db("o_project").where("id", id).delete();
  await u.db("o_agentWorkData").where("projectId", id).delete();
  await u.db("o_novel").where("projectId", id).delete();
  const scriptData = await u.db("o_script").where("projectId", id).select("id");
  const scriptIds = scriptData.map((item: any) => item.id);
  if (scriptIds.length) await u.db("o_scriptAssets").whereIn("scriptId", scriptIds).delete();
  await u.db("o_script").where("projectId", id).delete();
  await u.db("o_tasks").where("projectId", id).delete();
  await u.db("o_workflowStepRun").where("projectId", id).delete();

  const storyboardData = await u.db("o_storyboard").where("projectId", id).select("id");
  const storyboardIds = storyboardData.map((item: any) => item.id);
  if (storyboardIds.length) {
    await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds).delete();
    await u.db("o_storyboardAssetExclusion").whereIn("storyboardId", storyboardIds).delete();
    await u.db("o_storyboardAssetOverride").whereIn("storyboardId", storyboardIds).delete();
  }
  await u.db("o_storyboard").where("projectId", id).delete();

  const assetsData = await u.db("o_assets").where("projectId", id).select("id");
  const assetsIds = assetsData.map((item: any) => item.id);
  if (assetsIds.length) {
    await u.db("o_storyboardAssetExclusion").whereIn("assetId", assetsIds).delete();
    await u.db("o_storyboardAssetOverride").whereIn("assetId", assetsIds).delete();
    await u.db("o_assets").whereIn("id", assetsIds).update({ imageId: null });
    await u.db("o_image").whereIn("assetsId", assetsIds).delete();
  }
  await u.db("o_assets").where("projectId", id).delete();
  await u.db("o_videoTrack").where("projectId", id).delete();
  await u.db("o_video").where("projectId", id).delete();
  await u.db("memories").where("isolationKey", "like", `${id}:%`).delete();

  try { await u.oss.deleteDirectory(`${id}/`); } catch { /* project directory may not exist */ }
}

export default router.post(
  "/",
  validateFields({ id: z.number() }),
  async (req, res) => {
    await deleteProjectById(req.body.id);
    res.status(200).send(success({ message: "删除项目成功" }));
  },
);
