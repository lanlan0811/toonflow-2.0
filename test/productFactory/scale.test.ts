import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeApplicationDbForTest, createProductFactoryHarness, insertInChunks } from "./harness";
import {
  ensureProductFactoryConfig,
  ensureProductWorkflow,
  listProductFactoryItems,
  updateProductWorkflow,
} from "../../src/lib/productFactory/service";
import { planProductFactoryJobs } from "../../src/lib/productFactory/queue";

after(closeApplicationDbForTest);

function plannedArtifact(job: any, id: number) {
  const timestamp = Date.now();
  return {
    projectId: job.projectId,
    productId: job.productId,
    jobId: null,
    mediaType: job.phase,
    slotKey: job.slotKey,
    aspectRatio: job.aspectRatio,
    version: 99,
    templateId: job.templateId,
    templateVersion: job.templateVersion,
    promptLanguage: job.promptLanguage,
    promptSections: JSON.stringify(job.promptSections),
    prompt: job.prompt,
    model: job.model,
    params: JSON.stringify(job.params),
    inputSignature: job.inputSignature,
    inputArtifactIds: JSON.stringify(job.inputArtifactIds),
    filePath: `planned/${id}.${job.phase === "image" ? "png" : "mp4"}`,
    state: "success",
    errorReason: null,
    approved: 0,
    isCurrent: 0,
    createTime: timestamp,
    updateTime: timestamp,
  };
}

test("500 SKU 可分页，50 SKU 规划 600 个任务且相同签名不会重复入队", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 401;
    await harness.addProject(projectId);
    await ensureProductFactoryConfig(projectId);
    const timestamp = Date.now();
    await insertInChunks(harness.knex, "o_productFactoryItem", Array.from({ length: 500 }, (_, index) => ({
      id: index + 1,
      projectId,
      sku: `SKU-${String(index + 1).padStart(4, "0")}`,
      name: `分页商品 ${index + 1}`,
      category: "测试分类",
      description: "用于验证分页和任务规模",
      sellingPoints: "[]",
      attributes: "{}",
      state: "draft",
      createTime: timestamp,
      updateTime: timestamp,
    })));
    const firstPage = await listProductFactoryItems(projectId, 1, 50);
    const lastPage = await listProductFactoryItems(projectId, 10, 50);
    assert.equal(firstPage.total, 500);
    assert.equal(firstPage.items.length, 50);
    assert.equal(lastPage.items.length, 50);
    assert.equal(new Set([...firstPage.items, ...lastPage.items].map((item) => item.id)).size, 100);

    const productIds = Array.from({ length: 50 }, (_, index) => index + 1);
    await insertInChunks(harness.knex, "o_productFactoryReference", productIds.map((productId) => ({
      projectId,
      productId,
      scope: "product",
      filePath: `scale/${productId}/main.png`,
      fileName: "main.png",
      mimeType: "image/png",
      sha256: `scale-sha-${productId}`,
      role: "front",
      isPrimary: 1,
      sortIndex: 0,
      width: 1024,
      height: 1024,
      createTime: timestamp,
    })));
    const imagePlan = await planProductFactoryJobs({ projectId, productIds, phase: "image" });
    assert.equal(imagePlan.summary.taskCount, 400);

    for (const productId of productIds) {
      const workflow = await ensureProductWorkflow(projectId, productId);
      for (const ratio of ["9:16", "16:9"]) {
        for (const [slotKey, videoSlot] of [["scene_studio", "video_hero"], ["scene_lifestyle", "video_lifestyle"]]) {
          const [artifactId] = await harness.knex("o_productFactoryArtifact").insert({
            projectId,
            productId,
            jobId: null,
            mediaType: "image",
            slotKey,
            aspectRatio: ratio,
            version: 1,
            templateId: "pf.scale.source",
            templateVersion: 2,
            promptLanguage: "zh",
            promptSections: "{}",
            prompt: "批准来源图",
            model: "fake:fake-image",
            params: "{}",
            inputSignature: `scale-source:${productId}:${slotKey}:${ratio}`,
            inputArtifactIds: "[]",
            filePath: `scale/${productId}/${slotKey}-${ratio.replace(":", "x")}.png`,
            state: "success",
            errorReason: null,
            approved: 1,
            isCurrent: 1,
            createTime: timestamp,
            updateTime: timestamp,
          });
          workflow.graph.reviewMappings[`${videoSlot}:${ratio}`] = Number(artifactId);
        }
      }
      await updateProductWorkflow(projectId, productId, workflow.graph, false);
    }
    const videoPlan = await planProductFactoryJobs({ projectId, productIds, phase: "video" });
    assert.equal(videoPlan.summary.taskCount, 200);
    assert.equal(imagePlan.summary.taskCount + videoPlan.summary.taskCount, 600);

    await insertInChunks(harness.knex, "o_productFactoryArtifact", [...imagePlan.jobs, ...videoPlan.jobs].map(plannedArtifact));
    const [duplicateImages, duplicateVideos] = await Promise.all([
      planProductFactoryJobs({ projectId, productIds, phase: "image" }),
      planProductFactoryJobs({ projectId, productIds, phase: "video" }),
    ]);
    assert.equal(duplicateImages.summary.taskCount, 0);
    assert.equal(duplicateImages.summary.skippedCount, 400);
    assert.equal(duplicateVideos.summary.taskCount, 0);
    assert.equal(duplicateVideos.summary.skippedCount, 200);
  } finally {
    await harness.cleanup();
  }
});
