import assert from "node:assert/strict";
import test from "node:test";
import {
  associateBatchStoryboardTools,
  buildStoryboardAssetStats,
  buildStoryboardToolDescribe,
  collectStoryboardAssetRefs,
  findStoryboardReferenceGaps,
  storyboardAssetStatsEqual,
} from "../../src/lib/storyboardImportAssets";

const rows = [
  {
    shotNo: "1",
    scene: "小区公园长椅旁",
    visualContent: "张阿姨和李姐坐在公园长椅旁交谈",
    videoDesc: "场景：小区公园长椅旁",
    props: "邪教宣传传单（淡黄色纸张）",
    roleNames: ["张阿姨", "李姐"],
    sceneNames: ["小区公园"],
    toolNames: ["邪教宣传传单"],
  },
  {
    shotNo: "2",
    scene: "小区公园长椅",
    visualContent: "小明走向长椅",
    videoDesc: "场景：小区公园长椅",
    props: "公园长椅、手提袋（李姐的）、树木、草地",
    roleNames: ["小明"],
    sceneNames: ["小区公园"],
    toolNames: ["公园长椅", "手提袋", "树木", "草地"],
  },
  {
    shotNo: "9",
    scene: "片尾画面",
    videoDesc: "场景：片尾画面",
    roleNames: [],
    sceneNames: ["片尾画面"],
    toolNames: [],
  },
];

const meta = {
  roles: [{ name: "张阿姨" }, { name: "李姐" }, { name: "小明" }, { name: "社区工作人员" }],
  scenes: [{ name: "小区公园" }, { name: "家中客厅" }, { name: "社区服务中心" }],
};

test("uses row-level assets for statistics and reports reference gaps", () => {
  const associatedRows = associateBatchStoryboardTools(rows);
  const stats = buildStoryboardAssetStats(associatedRows);
  const gaps = findStoryboardReferenceGaps(associatedRows, meta);

  assert.deepEqual(stats, { roles: 3, scenes: 2, tools: 5, total: 10 });
  assert.deepEqual(gaps.unusedRoles, ["社区工作人员"]);
  assert.deepEqual(gaps.missingScenes, ["片尾画面"]);
  assert.equal(storyboardAssetStatsEqual(stats, { roles: 4, scenes: 3, tools: 5, total: 12 }), false);
  assert.equal(storyboardAssetStatsEqual(stats, { roles: 3, scenes: 2, tools: 5, total: 10 }), true);
});

test("adds a tool from the batch dictionary to an earlier compound scene", () => {
  const associatedRows = associateBatchStoryboardTools(rows);

  assert.deepEqual(associatedRows[0].toolNames, ["邪教宣传传单", "公园长椅"]);
  const refs = collectStoryboardAssetRefs(associatedRows[0], meta);
  assert.ok(refs.some((item) => item.type === "scene" && item.name === "小区公园"));
  assert.ok(refs.some((item) => item.type === "tool" && item.name === "公园长椅"));
});

test("does not create a tool name that is absent from the batch dictionary", () => {
  const associatedRows = associateBatchStoryboardTools([
    {
      scene: "小区公园长椅旁",
      videoDesc: "场景：小区公园长椅旁",
      toolNames: ["邪教宣传传单"],
    },
  ]);

  assert.deepEqual(associatedRows[0].toolNames, ["邪教宣传传单"]);
});

test("does not use unrelated props as the description of an inferred tool", () => {
  const associatedRows = associateBatchStoryboardTools(rows);
  const inferredDescription = buildStoryboardToolDescribe("公园长椅", associatedRows[0]);
  const explicitDescription = buildStoryboardToolDescribe("公园长椅", associatedRows[1]);

  assert.equal(inferredDescription, "公园长椅");
  assert.match(explicitDescription, /道具\/陈设上下文：公园长椅、手提袋/);
});

test("does not infer short tools or match tools from ordinary visual content", () => {
  const associatedRows = associateBatchStoryboardTools([
    { scene: "城市道路", visualContent: "汽车驶入停车场", videoDesc: "场景：城市道路\n画面内容：汽车驶入停车场", toolNames: [] },
    { scene: "车库", videoDesc: "场景：车库", props: "车", toolNames: ["车"] },
    { scene: "小区公园", visualContent: "拿起公园长椅的模型", videoDesc: "场景：小区公园\n画面内容：拿起公园长椅的模型", toolNames: [] },
    { scene: "仓库", videoDesc: "场景：仓库", props: "公园长椅", toolNames: ["公园长椅"] },
  ]);

  assert.deepEqual(associatedRows[0].toolNames, []);
  assert.deepEqual(associatedRows[2].toolNames, []);
});

test("prefers the exact or longest matching scene reference", () => {
  const refs = collectStoryboardAssetRefs(
    { sceneNames: ["小区公园"] },
    {
      scenes: [
        { name: "公园", atmosphere: "普通公园" },
        { name: "小区公园", atmosphere: "小区环境" },
      ],
    },
  );

  assert.match(refs[0].describe, /场景：小区公园/);
  assert.match(refs[0].describe, /氛围：小区环境/);
});

test("keeps assets with the same name but different types", () => {
  const refs = collectStoryboardAssetRefs({ sceneNames: ["小区公园"], toolNames: ["小区公园"] });

  assert.deepEqual(
    refs.map((item) => `${item.type}:${item.name}`),
    ["scene:小区公园", "tool:小区公园"],
  );
});
