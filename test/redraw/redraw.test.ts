import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import knexFactory from "knex";
import { normalizeProjectType, ProjectTypes } from "../../src/constants/project";
import { getInputCapabilities, hasReferenceMode } from "../../src/lib/redrawModel";
import { stableHash, validateShotTimeline } from "../../src/lib/redrawCommon";
import {
  assembleRedrawVideo,
  assertSupportedRatio,
  buildSrt,
  burnSrtSubtitles,
  detectShotCandidates,
  extractSegment,
  mediaRuntime,
  planInternalSegments,
  probeSourceVideo,
} from "../../src/lib/redrawMedia";
import { ensureRedrawAgentConfigs } from "../../src/lib/redrawSchema";

const execFileAsync = promisify(execFile);

test("项目类型支持 redraw 及中文别名", () => {
  assert.equal(normalizeProjectType("redraw"), ProjectTypes.redraw);
  assert.equal(normalizeProjectType("转绘"), ProjectTypes.redraw);
  assert.equal(normalizeProjectType("未知"), null);
});

test("模型能力声明与视频参考模式可被严格识别", () => {
  const capabilities = getInputCapabilities({ type: "text", inputCapabilities: ["text", "image", "video"], toolCalling: true });
  assert.deepEqual([...capabilities].sort(), ["image", "text", "toolCalling", "video"]);
  assert.equal(hasReferenceMode({ mode: ["text", ["videoReference:2", "imageReference:3"]] }, "videoReference:"), true);
  assert.equal(hasReferenceMode({ mode: ["singleImage"] }, "videoReference:"), false);
});

test("镜头时间轴连续性和输入摘要稳定", () => {
  const shots = [
    { startMs: 0, endMs: 1000 },
    { startMs: 1000, endMs: 2500 },
  ];
  assert.equal(validateShotTimeline(shots, 2500).length, 2);
  assert.throws(() => validateShotTimeline([{ startMs: 0, endMs: 900 }, { startMs: 1000, endMs: 2500 }], 2500), /缺口/);
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
});

test("长短片段规划、比例和 SRT 时间码", () => {
  assert.equal(assertSupportedRatio(1920, 1080, "16:9"), "16:9");
  assert.throws(() => assertSupportedRatio(1024, 768, "16:9"), /只支持/);
  assert.throws(() => assertSupportedRatio(1080, 1920, "16:9"), /不一致/);
  assert.deepEqual(planInternalSegments(0, 3000, 5000, 5000), [{ startMs: 0, endMs: 3000, generationDurationMs: 5000 }]);
  const long = planInternalSegments(0, 12_000, 5000, 1000, 250);
  assert.equal(long.length, 3);
  assert.equal(long[1].startMs, 4750);
  assert.match(buildSrt([{ startMs: 1234, endMs: 4567, dialogue: "原始对白" }]), /00:00:01,234 --> 00:00:04,567/);
});

test("旧数据库幂等补齐 Agent 配置且不覆盖既有选择", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-redraw-db-test-"));
  const filename = path.join(directory, "test.sqlite");
  const db = knexFactory({ client: "better-sqlite3", connection: { filename }, useNullAsDefault: true });
  try {
    await db.schema.createTable("o_agentDeploy", (table) => {
      table.increments("id");
      table.string("key");
      table.string("model");
      table.string("modelName");
      table.string("vendorId");
      table.string("name");
      table.string("desc");
      table.integer("temperature");
      table.integer("maxOutputTokens");
      table.boolean("disabled");
    });
    await db("o_agentDeploy").insert({ key: "redrawAgent", modelName: "vendor:chosen", model: "chosen", name: "已有转绘Agent" });
    await ensureRedrawAgentConfigs(db);
    await ensureRedrawAgentConfigs(db);
    const rows = await db("o_agentDeploy").where("key", "like", "redrawAgent%");
    assert.equal(rows.length, 8);
    assert.equal(rows.find((row) => row.key === "redrawAgent")?.modelName, "vendor:chosen");
  } finally {
    await db.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("固定 FFmpeg 运行时可探测、切片、抽取镜头并挂载原音轨合成", { timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-redraw-test-"));
  const source = path.join(directory, "source.mp4");
  const first = path.join(directory, "first.mp4");
  const second = path.join(directory, "second.mp4");
  const output = path.join(directory, "output.mp4");
  const subtitled = path.join(directory, "subtitled.mp4");
  const srt = path.join(directory, "captions.srt");
  try {
    await execFileAsync(mediaRuntime.ffmpegPath, [
      "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1",
      "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
    ]);
    const metadata = await probeSourceVideo(source);
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 180);
    assert.equal(metadata.hasAudio, true);
    assert.equal(metadata.avSyncOffsetMs, 0);
    const boundaries = await detectShotCandidates(source, metadata.durationMs);
    assert.deepEqual(boundaries, [0, metadata.durationMs]);
    const splitStart = 400;
    const splitEnd = 600;
    await extractSegment(source, first, 0, splitEnd);
    await extractSegment(source, second, splitStart, metadata.durationMs);
    await assembleRedrawVideo({ sourcePath: source, segments: [{ path: first, startMs: 0, endMs: splitEnd }, { path: second, startMs: splitStart, endMs: metadata.durationMs }], outputPath: output, durationMs: metadata.durationMs, width: metadata.width, height: metadata.height, fps: metadata.fps });
    const assembled = await probeSourceVideo(output);
    assert.equal(assembled.hasAudio, true);
    assert.ok(Math.abs((assembled.avSyncOffsetMs ?? 0) - (metadata.avSyncOffsetMs ?? 0)) <= 40);
    assert.ok(Math.abs(assembled.durationMs - metadata.durationMs) <= Math.ceil(1000 / metadata.fps));
    await fs.writeFile(srt, buildSrt([{ startMs: 0, endMs: 800, dialogue: "原始对白" }]), "utf8");
    await burnSrtSubtitles(output, srt, subtitled);
    const burned = await probeSourceVideo(subtitled);
    assert.equal(burned.hasAudio, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
