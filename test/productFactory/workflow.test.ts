import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultProductWorkflow, normalizeFactoryPack, validateProductWorkflow } from "../../src/lib/productFactory/workflow";

test("默认套餐生成 8 个图片节点、审核门和 4 个视频节点", () => {
  const graph = createDefaultProductWorkflow(42);
  assert.equal(graph.nodes.filter((node) => node.type === "source").length, 1);
  assert.equal(graph.nodes.filter((node) => node.type === "image").length, 8);
  assert.equal(graph.nodes.filter((node) => node.type === "review").length, 1);
  assert.equal(graph.nodes.filter((node) => node.type === "video").length, 4);
  assert.equal(Object.keys(graph.reviewMappings).length, 4);
  assert.equal(validateProductWorkflow(graph), true);
});

test("套餐范围被限制并在空配置时回退默认值", () => {
  const pack = normalizeFactoryPack({ imageSlots: [], videoSlots: [], ratios: [], videoDuration: 999, imageQuality: "4K" });
  assert.equal(pack.imageSlots.length, 4);
  assert.equal(pack.videoSlots.length, 2);
  assert.equal(pack.ratios.length, 2);
  assert.equal(pack.videoDuration, 30);
  assert.equal(pack.imageQuality, "4K");
});

test("工作流拒绝循环连接", () => {
  const graph = createDefaultProductWorkflow(7);
  graph.edges.push({ id: "cycle", source: "review", target: "source" });
  assert.throws(() => validateProductWorkflow(graph), /循环/);
});
