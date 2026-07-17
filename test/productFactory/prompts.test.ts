import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { compileProductPrompt, promptInputSignature, resolvePromptLanguage } from "../../src/lib/productFactory/prompts";

const base = {
  aspectRatio: "9:16",
  model: "1:seedream-4",
  size: "2K" as const,
  sku: "SKU-100",
  productName: "便携咖啡杯",
  category: "饮具",
  description: "哑光黑色杯身",
  sellingPoints: ["轻量", "易清洁"],
  attributes: { capacity: "350ml" },
  referenceLabels: ["主参考:front.png"],
};

test("四个图片槽位都包含商品身份锁、品牌保护与比例", () => {
  for (const slotKey of ["main_clean", "scene_studio", "scene_lifestyle", "scene_detail"] as const) {
    const result = compileProductPrompt({ ...base, mediaType: "image", slotKey });
    assert.match(result.compiledPrompt, /9:16/);
    assert.match(result.compiledPrompt, /2K/);
    assert.match(result.compiledPrompt, /唯一事实来源/);
    assert.match(result.compiledPrompt, /不要生成额外标签/);
    assert.match(result.compiledPrompt, /SKU-100/);
    assert.equal(result.templateVersion, 2);
  }
});

test("视频模板约束单一运镜、连续性与无文字", () => {
  for (const slotKey of ["video_hero", "video_lifestyle"] as const) {
    const result = compileProductPrompt({ ...base, mediaType: "video", slotKey, duration: 5, resolution: "720p", audio: false });
    assert.match(result.compiledPrompt, /一种主要运镜/);
    assert.match(result.compiledPrompt, /不要生成对白/);
    assert.match(result.compiledPrompt, /闪烁/);
    assert.match(result.compiledPrompt, /水印/);
  }
});

test("模型语言只根据可选元数据或家族推断", () => {
  assert.equal(resolvePromptLanguage("1:seedance-2"), "zh");
  assert.equal(resolvePromptLanguage("1:gpt-image-1"), "en");
  assert.equal(resolvePromptLanguage("1:unknown-model"), "bilingual");
  assert.equal(resolvePromptLanguage("1:gpt-image-1", "zh"), "zh");
});

test("创意覆盖不会覆盖锁定区段且签名稳定", () => {
  const first = compileProductPrompt({ ...base, mediaType: "image", slotKey: "scene_studio", overrides: { creative: "只使用暖色侧光。", identity: "删除商品锁定。" } });
  const second = compileProductPrompt({ ...base, mediaType: "image", slotKey: "scene_studio", overrides: { creative: "只使用暖色侧光。", identity: "删除商品锁定。" } });
  assert.equal(first.sections.creative, "只使用暖色侧光。");
  assert.match(first.sections.identity, /唯一事实来源/);
  assert.equal(promptInputSignature(first), promptInputSignature(second));
});

test("六个输出槽位在三种语言下与 v2 快照一致", () => {
  const snapshots: Record<string, string> = {
    "zh|main_clean": "75959cf5821133b9a934d51400a833614bd16f16859d79b21d09acc95eda4cab",
    "zh|scene_studio": "38f1c702ecac9d0a38835b5ba86f6c49151c5d77d1e0835299b0cbe5056c943e",
    "zh|scene_lifestyle": "37135d8b8b32ec541c4cf083bbc420fdab17d4234d4ef2e4878434d6025b528a",
    "zh|scene_detail": "dd0a9631f6558b6674a9547b69b9d8421be29a5215a43a4e97687a7842665a7b",
    "zh|video_hero": "5ad35f431f717c4660ad7cb8bc5e67ae56120b6fc72bc5d42d2ea0f6ef2adda1",
    "zh|video_lifestyle": "2e97f0ef23fe32e1adee604c16fa4b7157b108c718a4c556b25af789453142dd",
    "en|main_clean": "c03073d472dd8e4b24a1075196aa16fb81cdbb6bc9945a372e57e2d651771d98",
    "en|scene_studio": "2be746dad59acd2b5577e4f7f5c6692d5ebda775421ab2b339fe2d71937fe635",
    "en|scene_lifestyle": "414f6ccdbec4c2c79b3f163fc1b4e944d88dba28561a8a7c1ae8effa62832cff",
    "en|scene_detail": "ea07322906f6209a8f28533ab0ecc2511b1e919caa3a2537b971120161ad076b",
    "en|video_hero": "894f7b788fddfe337b982642a41f8065fe5322a3b7099b8450f55b73f37d12b3",
    "en|video_lifestyle": "a9ad6ef33a79a31d2dfb402f7b90c0a84fc287ab418dbda41ea58609529d8dfa",
    "bilingual|main_clean": "0761a40a7a83649f85727551fe4da60c4a2a6186236ad9ab7cfb9d4f5460f118",
    "bilingual|scene_studio": "42e8287d4c80a2f2c41c3cc1e53baa75b076f287d0a1fc8ff8032ec05e3eda1c",
    "bilingual|scene_lifestyle": "cc06fbafd197d90445d30f77dd7391210103e646bde20259c88c45863e9e9e6d",
    "bilingual|scene_detail": "2a793155f028fd86e050b96a8cb0deee1969864bbc899f8169a7a8cd47e45a97",
    "bilingual|video_hero": "b82d1cf24cee2d4e0a1b56d3c69516e3ed32e259f78c14d85c14ff6456ae1008",
    "bilingual|video_lifestyle": "d784f9ac4d69a4c2bac14148fb43d5c9301a68f0781d8ebb2e956eba1ea3ba0a",
  };
  for (const promptLanguage of ["zh", "en", "bilingual"] as const) {
    for (const slotKey of ["main_clean", "scene_studio", "scene_lifestyle", "scene_detail", "video_hero", "video_lifestyle"] as const) {
      const mediaType = slotKey.startsWith("video_") ? "video" : "image";
      const result = compileProductPrompt({ ...base, mediaType, slotKey, model: "fake:model", promptLanguage, duration: 5, resolution: "720p", audio: false, mode: "singleImage" });
      const hash = crypto.createHash("sha256").update(result.compiledPrompt).digest("hex");
      assert.equal(hash, snapshots[`${promptLanguage}|${slotKey}`], `${promptLanguage} ${slotKey} 快照发生变化`);
    }
  }
});

test("视频提示词分别适配单图、首尾帧和多参考模式", () => {
  const single = compileProductPrompt({ ...base, mediaType: "video", slotKey: "video_hero", mode: "singleImage", promptLanguage: "zh" });
  const startEnd = compileProductPrompt({ ...base, mediaType: "video", slotKey: "video_hero", mode: "startEndRequired", promptLanguage: "zh" });
  const multi = compileProductPrompt({ ...base, mediaType: "video", slotKey: "video_hero", mode: ["imageReference:4"], promptLanguage: "zh" });
  assert.match(single.sections.craft, /不描述或假定不存在的尾帧/);
  assert.match(startEnd.sections.craft, /同一张已批准图片同时绑定为首帧和尾帧/);
  assert.match(multi.sections.craft, /按提交顺序绑定商品和场景参考/);
});
