import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeApplicationDbForTest, createProductFactoryHarness, waitForTerminalJobs } from "./harness";
import {
  refreshProductFactoryItemState,
  upsertProductFactoryItem,
} from "../../src/lib/productFactory/service";
import {
  enqueueProductFactoryJobs,
  planProductFactoryJobs,
  retryProductFactoryJobs,
} from "../../src/lib/productFactory/queue";
import { submitProductFactoryReview } from "../../src/lib/productFactory/review";
import { collectProductFactoryExport } from "../../src/lib/productFactory/export";
import { polishProductFactoryPrompt } from "../../src/lib/productFactory/polish";

after(closeApplicationDbForTest);

test("伪造 Vendor 完成两 SKU 的 8 图、审核、4 视频、导出闭环且不改模型配置", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 101;
    await harness.addProject(projectId);
    const vendorBefore = await harness.knex("o_vendorConfig").where("id", "fake").first();
    const products = [];
    for (const [sku, name] of [["SKU-A", "咖啡杯"], ["SKU-B", "旅行包"]]) {
      const item = await upsertProductFactoryItem(projectId, { sku, name, description: `${name}测试描述`, sellingPoints: ["真实材质", "清晰轮廓"] });
      await harness.addPrimaryReference(projectId, Number(item.id));
      assert.equal(await refreshProductFactoryItemState(projectId, Number(item.id)), "ready");
      products.push(item);
    }
    const productIds = products.map((item) => Number(item.id));

    const polished = await polishProductFactoryPrompt({
      projectId,
      productId: productIds[0],
      mediaType: "image",
      slotKey: "scene_studio",
      aspectRatio: "9:16",
    });
    assert.deepEqual(Object.keys(polished.candidate).sort(), ["craft", "creative", "goal"]);
    assert.match(String(polished.lockedSections.identity), /唯一事实来源/);
    assert.equal("identity" in polished.candidate, false);

    const imagePreview = await planProductFactoryJobs({ projectId, productIds, phase: "image" });
    assert.equal(imagePreview.summary.taskCount, 16);
    const imageBatch = await enqueueProductFactoryJobs({ projectId, productIds, phase: "image" });
    assert.equal(imageBatch.jobIds.length, 16);
    let terminal = await waitForTerminalJobs(harness.knex, 16);
    assert.equal(terminal.filter((job) => job.state === "success").length, 16);

    for (const productId of productIds) {
      const images = await harness.knex("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success", isCurrent: 1 });
      assert.equal(images.length, 8);
      const review = await submitProductFactoryReview(projectId, productId, images.map((artifact) => ({ artifactId: Number(artifact.id) })));
      assert.equal(review.state, "video_ready");
      assert.equal(Object.values(review.reviewMappings).every((id) => Number(id) > 0), true);
    }

    const videoPreview = await planProductFactoryJobs({ projectId, productIds, phase: "video" });
    assert.equal(videoPreview.summary.taskCount, 8);
    const videoBatch = await enqueueProductFactoryJobs({ projectId, productIds, phase: "video" });
    assert.equal(videoBatch.jobIds.length, 8);
    terminal = await waitForTerminalJobs(harness.knex, 24);
    assert.equal(terminal.filter((job) => job.state === "success").length, 24);
    const itemStates = await harness.knex("o_productFactoryItem").whereIn("id", productIds).orderBy("id", "asc");
    assert.deepEqual(itemStates.map((item) => item.state), ["completed", "completed"]);

    const bundle = await collectProductFactoryExport(projectId, productIds);
    assert.equal(bundle.artifactCount, 24);
    assert.equal(bundle.entries.at(-1)?.relativePath, "manifest.csv");
    assert.equal(bundle.manifestText.split("\r\n").length, 25);
    assert.deepEqual(bundle.omittedArtifactIds, []);

    const duplicatePreview = await planProductFactoryJobs({ projectId, productIds, phase: "image" });
    assert.equal(duplicatePreview.summary.taskCount, 0);
    assert.equal(duplicatePreview.summary.skippedCount, 16);
    const vendorAfter = await harness.knex("o_vendorConfig").where("id", "fake").first();
    assert.deepEqual(vendorAfter, vendorBefore);
  } finally {
    await harness.cleanup();
  }
});

test("失败任务复用原任务重试并递增 attempt", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 102;
    await harness.addProject(projectId);
    const item = await upsertProductFactoryItem(projectId, { sku: "RETRY-1", name: "重试商品" });
    const productId = Number(item.id);
    await harness.addPrimaryReference(projectId, productId);
    harness.setImageFailures(1);
    const batch = await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image" });
    await waitForTerminalJobs(harness.knex, 8);
    const failed = await harness.knex("o_productFactoryJob").where({ projectId, state: "failed" }).first();
    assert.ok(failed);
    assert.equal(failed.attempt, 1);
    assert.equal((await harness.knex("o_productFactoryItem").where("id", productId).first()).state, "partial_failed");
    const retry = await retryProductFactoryJobs(projectId, [Number(failed.id)]);
    assert.equal(retry.retried, 1);
    const terminal = await waitForTerminalJobs(harness.knex, 8);
    assert.equal(terminal.every((job) => job.state === "success"), true);
    const retried = await harness.knex("o_productFactoryJob").where("id", failed.id).first();
    assert.equal(retried.attempt, 2);
    assert.equal((await harness.knex("o_productFactoryArtifact").where("id", failed.artifactId).first()).state, "success");
    assert.equal(batch.jobIds.length, 8);
  } finally {
    await harness.cleanup();
  }
});

test("仅支持强制首尾帧的视频模型会复用批准图作为首尾帧", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 103;
    await harness.addProject(projectId, { videoModel: "fake:fake-start-end", mode: "startEndRequired" });
    const item = await upsertProductFactoryItem(projectId, { sku: "FRAME-1", name: "首尾帧商品" });
    const productId = Number(item.id);
    await harness.addPrimaryReference(projectId, productId);
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image" });
    await waitForTerminalJobs(harness.knex, 8);
    const images = await harness.knex("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success" });
    await submitProductFactoryReview(projectId, productId, images.map((artifact) => ({ artifactId: Number(artifact.id) })));
    const preview = await planProductFactoryJobs({ projectId, productIds: [productId], phase: "video" });
    assert.equal(preview.summary.taskCount, 4);
    assert.equal(preview.jobs.every((job) => job.params.mode === "startEndRequired"), true);
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "video" });
    await waitForTerminalJobs(harness.knex, 12);
    const videoCalls = harness.calls.filter((call) => call.type === "video");
    assert.equal(videoCalls.length, 4);
    assert.equal(videoCalls.every((call) => Array.isArray(call.input.referenceList) && call.input.referenceList.length === 2), true);
    assert.equal(videoCalls.every((call) => String(call.input.prompt).includes("start and end frame")), true);
  } finally {
    await harness.cleanup();
  }
});

test("明确重新生成会创建新候选版本，商品输入变化会标记历史产物", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 104;
    await harness.addProject(projectId);
    const item = await upsertProductFactoryItem(projectId, { sku: "REGEN-1", name: "版本一商品" });
    const productId = Number(item.id);
    await harness.addPrimaryReference(projectId, productId);
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image" });
    await waitForTerminalJobs(harness.knex, 8);
    assert.equal((await planProductFactoryJobs({ projectId, productIds: [productId], phase: "image" })).summary.taskCount, 0);
    assert.equal((await planProductFactoryJobs({ projectId, productIds: [productId], phase: "image", regenerate: true })).summary.taskCount, 8);
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image", regenerate: true });
    await waitForTerminalJobs(harness.knex, 16);
    const versions = await harness.knex("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success" }).orderBy("slotKey", "asc").orderBy("aspectRatio", "asc").orderBy("version", "asc");
    assert.equal(versions.length, 16);
    const groups = Map.groupBy(versions, (artifact) => `${artifact.slotKey}:${artifact.aspectRatio}`);
    assert.equal([...groups.values()].every((rows) => rows.map((row) => row.version).join(",") === "1,2"), true);
    assert.equal([...groups.values()].every((rows) => rows.filter((row) => row.isCurrent).length === 1), true);

    await upsertProductFactoryItem(projectId, { id: productId, sku: "REGEN-1", name: "版本二商品" });
    const changed = await harness.knex("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", state: "success" });
    assert.equal(changed.every((artifact) => artifact.inputChanged === 1), true);
  } finally {
    await harness.cleanup();
  }
});

test("部分审核只规划可用视频槽位，错误模型类型被能力检查拦截", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 105;
    await harness.addProject(projectId);
    const item = await upsertProductFactoryItem(projectId, { sku: "PARTIAL-1", name: "部分审核商品" });
    const productId = Number(item.id);
    await harness.addPrimaryReference(projectId, productId);
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image" });
    await waitForTerminalJobs(harness.knex, 8);
    const source = await harness.knex("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", slotKey: "scene_studio", aspectRatio: "9:16", state: "success" }).first();
    const review = await submitProductFactoryReview(projectId, productId, [{ artifactId: Number(source.id) }]);
    assert.equal(review.state, "awaiting_review");
    const partial = await planProductFactoryJobs({ projectId, productIds: [productId], phase: "video" });
    assert.equal(partial.summary.taskCount, 1);
    assert.equal(partial.summary.skippedCount, 3);

    await harness.knex("o_project").where("id", projectId).update({ videoModel: "fake:fake-text" });
    const incompatible = await planProductFactoryJobs({ projectId, productIds: [productId], phase: "video" });
    assert.equal(incompatible.summary.taskCount, 0);
    assert.equal(incompatible.skipped.some((entry) => entry.reason.includes("不支持参考图输入")), true);
  } finally {
    await harness.cleanup();
  }
});

test("多参考视频按上限提交审核图、商品主参考和品牌参考", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 106;
    await harness.addProject(projectId, { videoModel: "fake:fake-multi-video", mode: JSON.stringify(["imageReference:4"]) });
    const item = await upsertProductFactoryItem(projectId, { sku: "MULTI-1", name: "多参考商品" });
    const productId = Number(item.id);
    await harness.addPrimaryReference(projectId, productId);
    for (let index = 1; index <= 2; index += 1) {
      const filePath = `test/${projectId}/brand-${index}.png`;
      harness.files.set(filePath, Buffer.from(`brand-${index}`));
      await harness.knex("o_productFactoryReference").insert({
        projectId,
        productId: null,
        scope: "brand",
        filePath,
        fileName: `brand-${index}.png`,
        mimeType: "image/png",
        sha256: `brand-sha-${index}`,
        role: "other",
        isPrimary: 0,
        sortIndex: index,
        width: 1024,
        height: 1024,
        createTime: Date.now(),
      });
    }
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "image" });
    await waitForTerminalJobs(harness.knex, 8);
    const source = await harness.knex("o_productFactoryArtifact").where({ projectId, productId, mediaType: "image", slotKey: "scene_studio", aspectRatio: "9:16", state: "success" }).first();
    await submitProductFactoryReview(projectId, productId, [{ artifactId: Number(source.id) }], { "video_hero:9:16": Number(source.id) });
    const preview = await planProductFactoryJobs({ projectId, productIds: [productId], phase: "video" });
    assert.equal(preview.summary.taskCount, 1);
    assert.equal(preview.jobs[0].inputArtifactIds.length, 1);
    assert.equal(preview.jobs[0].inputReferenceIds.length, 3);
    await enqueueProductFactoryJobs({ projectId, productIds: [productId], phase: "video" });
    await waitForTerminalJobs(harness.knex, 9);
    const videoCall = harness.calls.find((call) => call.type === "video");
    assert.ok(videoCall);
    assert.equal(Array.isArray(videoCall.input.referenceList) ? videoCall.input.referenceList.length : 0, 4);
  } finally {
    await harness.cleanup();
  }
});
