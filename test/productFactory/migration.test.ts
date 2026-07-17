import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeApplicationDbForTest, createProductFactoryHarness } from "./harness";
import { importLegacyProductPromo } from "../../src/lib/productFactory/migration";

after(closeApplicationDbForTest);

test("旧宣传片迁移幂等、保留自定义提示词且不修改 Vendor 配置", async () => {
  const harness = await createProductFactoryHarness();
  try {
    const projectId = 301;
    await harness.addProject(projectId, {
      projectType: "script",
      name: "旧产品宣传片",
      intro: "__TOONFLOW_PRODUCT_PROMO_V1__\n旧活动描述",
    });
    const databasePath = `legacy/${projectId}/database.png`;
    const canvasPath = `legacy/${projectId}/canvas.png`;
    harness.files.set(databasePath, Buffer.from("legacy-database-image"));
    harness.files.set(canvasPath, Buffer.from("legacy-canvas-image"));
    const [imageId] = await harness.knex("o_image").insert({ filePath: databasePath, model: "fake:fake-image" });
    await harness.knex("o_assets").insert({ projectId, imageId: Number(imageId) });
    const vendorBefore = await harness.knex("o_vendorConfig").where("id", "fake").first();
    const customPrompt = "保留这段由用户手工编写的旧商品棚拍提示词";
    const legacyCanvas = {
      nodes: [
        { id: "upload-1", type: "upload", data: { url: "/legacy/reference.png" }, position: { x: 0, y: 0 } },
        { id: "image-1", type: "image", data: { prompt: customPrompt, resultUrl: canvasPath, model: "fake:fake-image", ratio: "16:9" }, position: { x: 1, y: 1 } },
        { id: "video-1", type: "video", data: { prompt: "产品展示。镜头运动流畅，突出产品主体与质感。", model: "fake:fake-video", ratio: "16:9" }, position: { x: 2, y: 2 } },
      ],
    };

    const first = await importLegacyProductPromo(projectId, legacyCanvas);
    const second = await importLegacyProductPromo(projectId, legacyCanvas);
    assert.equal(first.migrated, true);
    assert.equal(second.migrated, false);
    assert.equal(first.importedArtifacts, 2);
    assert.equal(second.importedArtifacts, 0);
    assert.equal((await harness.knex("o_project").where("id", projectId).first()).projectType, "commerce");
    assert.equal(await harness.knex("o_productFactoryItem").where({ projectId, sku: `LEGACY-${projectId}` }).count({ count: "id" }).first().then((row) => Number(row?.count)), 1);
    assert.equal(await harness.knex("o_productFactoryArtifact").where("projectId", projectId).count({ count: "id" }).first().then((row) => Number(row?.count)), 2);
    assert.equal((await harness.knex("o_productFactoryConfig").where("projectId", projectId).first()).migrationVersion, 1);

    const workflowRow = await harness.knex("o_productFactoryWorkflow").where("projectId", projectId).first();
    const graph = JSON.parse(workflowRow.graphData);
    const imageNodes = graph.nodes.filter((node: any) => node.type === "image");
    const videoNodes = graph.nodes.filter((node: any) => node.type === "video");
    assert.equal(imageNodes.every((node: any) => node.data.promptOverride?.creative === customPrompt && node.data.promptCustomized === true), true);
    assert.equal(videoNodes.every((node: any) => !node.data.promptOverride), true);
    assert.match(String(graph.nodes.find((node: any) => node.type === "source")?.data.legacy?.url), /legacy\/reference/);
    assert.deepEqual(await harness.knex("o_vendorConfig").where("id", "fake").first(), vendorBefore);
  } finally {
    await harness.cleanup();
  }
});
