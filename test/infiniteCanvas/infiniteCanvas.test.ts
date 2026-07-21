import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import ensureInfiniteCanvasSchema from "../../src/lib/infiniteCanvas/schema";
import generateFlowImageRoute from "../../src/routes/production/editImage/generateFlowImage";
import generateVideoRoute from "../../src/routes/production/workbench/generateVideo";
import {
  createInfiniteCanvasProject,
  deleteInfiniteCanvasArtifact,
  getInfiniteCanvasWorkspace,
  listInfiniteCanvasArtifacts,
  listInfiniteCanvasProjects,
  registerInfiniteCanvasArtifact,
  requireInfiniteCanvasArtifactInputs,
  selectInfiniteCanvasArtifact,
  updateInfiniteCanvasGraph,
  uploadInfiniteCanvasMaterial,
  validateInfiniteCanvasGraph,
} from "../../src/lib/infiniteCanvas/service";
import { closeApplicationDbForTest, createProductFactoryHarness } from "../productFactory/harness";

after(closeApplicationDbForTest);

function graph(nodes: Array<{ id: string; type: "material" | "image" | "video"; x?: number; y?: number }>, edges: Array<{ source: string; target: string; sourcePort?: string; targetPort?: string }> = []) {
  return {
    version: 1 as const,
    nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: { x: node.x ?? 0, y: node.y ?? 0 }, data: {} })),
    edges: edges.map((edge, index) => ({ id: `e${index}`, source: edge.source, target: edge.target, sourcePort: edge.sourcePort || "media", targetPort: edge.targetPort || `reference:${index + 1}`, order: index })),
    viewport: { x: -820, y: 530, zoom: .25 },
  };
}

test("图模型接受负坐标和超长连接，并拒绝自连、重复边及循环", () => {
  const valid = validateInfiniteCanvasGraph(graph([
    { id: "source", type: "material", x: -1_000_000, y: -42 },
    { id: "image", type: "image", x: 1_000_000, y: 90 },
    { id: "video", type: "video", x: 2_000_000, y: -900 },
  ], [{ source: "source", target: "image" }, { source: "image", target: "video" }]));
  assert.equal(valid.nodes[0].position.x, -1_000_000);
  assert.equal(valid.viewport.zoom, .25);

  assert.throws(() => validateInfiniteCanvasGraph(graph([{ id: "a", type: "image" }], [{ source: "a", target: "a" }])), /端点无效/);
  assert.throws(() => validateInfiniteCanvasGraph(graph([{ id: "a", type: "material" }, { id: "b", type: "image" }], [{ source: "a", target: "b", targetPort: "same" }, { source: "a", target: "b", targetPort: "same" }])), /重复连线/);
  assert.throws(() => validateInfiniteCanvasGraph(graph([{ id: "a", type: "image" }, { id: "b", type: "video" }], [{ source: "a", target: "b" }, { source: "b", target: "a" }])), /循环连接/);
});

test("画布项目、修订冲突、上传与历史版本均隔离在 canvas 项目内", async () => {
  const harness = await createProductFactoryHarness();
  try {
    await harness.knex.schema.alterTable("o_project", (table) => table.integer("userId"));
    await harness.knex.schema.createTable("o_script", (table) => { table.increments("id"); table.integer("projectId"); table.text("name"); table.text("content"); table.integer("createTime"); });
    await ensureInfiniteCanvasSchema(harness.knex);
    const vendorBefore = await harness.knex("o_vendorConfig").where("id", "fake").first();
    const workspace = await createInfiniteCanvasProject({
      name: "测试无限画布", imageModel: "fake:fake-image", videoModel: "fake:fake-video", imageQuality: "2K", videoRatio: "16:9", mode: "singleImage",
      settings: { defaultVideoResolution: "720p", defaultVideoDuration: 5, defaultVideoAudio: false },
    });
    assert.equal(workspace.project.projectType, "canvas");
    assert.equal(workspace.graph.nodes.length, 0);
    assert.deepEqual(await harness.knex("o_vendorConfig").where("id", "fake").first(), vendorBefore);

    const projectId = Number(workspace.project.id);
    const nextGraph = graph([{ id: "material-a", type: "material", x: -300 }, { id: "image-a", type: "image", x: 600 }], [{ source: "material-a", target: "image-a" }]);
    const updated = await updateInfiniteCanvasGraph(projectId, nextGraph, workspace.revision);
    assert.equal(updated.revision, workspace.revision + 1);
    await assert.rejects(() => updateInfiniteCanvasGraph(projectId, nextGraph, workspace.revision), /另一个窗口|保存冲突/);

    const first = await uploadInfiniteCanvasMaterial({ projectId, nodeId: "material-a", fileName: "first.png", dataBase64: `data:image/png;base64,${Buffer.from("first").toString("base64")}` });
    const second = await uploadInfiniteCanvasMaterial({ projectId, nodeId: "material-a", fileName: "second.webp", dataBase64: `data:image/webp;base64,${Buffer.from("second").toString("base64")}` });
    assert.equal(first.version, 1); assert.equal(second.version, 2); assert.equal(second.isCurrent, 1);
    await selectInfiniteCanvasArtifact(projectId, first.id);
    let versions = await listInfiniteCanvasArtifacts(projectId, "material-a");
    assert.equal(versions.find((item: any) => item.id === first.id)?.isCurrent, 1);
    assert.equal(versions.find((item: any) => item.id === second.id)?.isCurrent, 0);
    await deleteInfiniteCanvasArtifact(projectId, second.id);
    versions = await listInfiniteCanvasArtifacts(projectId, "material-a");
    assert.deepEqual(versions.map((item: any) => item.id), [first.id]);

    const loaded = await getInfiniteCanvasWorkspace(projectId);
    assert.equal(loaded.revision, updated.revision);
    assert.equal(loaded.artifacts.length, 1);
    const projects = await listInfiniteCanvasProjects();
    assert.equal(projects.length, 1); assert.equal(projects[0].id, projectId); assert.match(projects[0].thumbnailUrl, /material/);
    assert.deepEqual(projects[0].settings, { defaultVideoResolution: "720p", defaultVideoDuration: 5, defaultVideoAudio: false });

    await assert.rejects(() => uploadInfiniteCanvasMaterial({ projectId, nodeId: "material-a", fileName: "bad.gif", dataBase64: `data:image/gif;base64,${Buffer.from("bad").toString("base64")}` }), /仅支持/);
    await assert.rejects(() => uploadInfiniteCanvasMaterial({ projectId, nodeId: "missing", fileName: "missing.png", dataBase64: `data:image/png;base64,${Buffer.from("bad").toString("base64")}` }), /节点不存在/);
    await assert.rejects(() => uploadInfiniteCanvasMaterial({ projectId, nodeId: "image-a", fileName: "wrong.png", dataBase64: `data:image/png;base64,${Buffer.from("bad").toString("base64")}` }), /节点类型不匹配/);
    await assert.rejects(() => uploadInfiniteCanvasMaterial({ projectId, nodeId: "material-a", fileName: "wrong.webp", dataBase64: `data:image/png;base64,${Buffer.from("bad").toString("base64")}` }), /扩展名与 MIME/);
    assert.equal((await requireInfiniteCanvasArtifactInputs(projectId, [first.id], "image"))[0].id, first.id);

    await assert.rejects(() => registerInfiniteCanvasArtifact({ projectId, nodeId: "material-a", origin: "generated", mediaType: "image", state: "success", filePath: `${projectId}/generated.png` }), /节点类型不匹配/);

    const other = await createInfiniteCanvasProject({
      name: "另一个画布", imageModel: "fake:fake-image", videoModel: "fake:fake-video", imageQuality: "2K", videoRatio: "16:9", mode: "singleImage",
      settings: { defaultVideoResolution: "720p", defaultVideoDuration: 5, defaultVideoAudio: false },
    });
    const otherProjectId = Number(other.project.id);
    await updateInfiniteCanvasGraph(otherProjectId, graph([{ id: "material-b", type: "material" }]), other.revision);
    const otherArtifact = await uploadInfiniteCanvasMaterial({ projectId: otherProjectId, nodeId: "material-b", fileName: "other.png", dataBase64: `data:image/png;base64,${Buffer.from("other").toString("base64")}` });
    await assert.rejects(() => requireInfiniteCanvasArtifactInputs(projectId, [otherArtifact.id]), /不属于当前项目/);

    const removed = await updateInfiniteCanvasGraph(projectId, graph([{ id: "image-a", type: "image" }]), loaded.revision);
    assert.equal(removed.revision, loaded.revision + 1);
    await assert.rejects(() => requireInfiniteCanvasArtifactInputs(projectId, [first.id]), /当前有效版本/);
    await assert.rejects(() => selectInfiniteCanvasArtifact(projectId, first.id), /节点不存在|已从画布移除/);
  } finally { await harness.cleanup(); }
});


test("旧生成接口保持响应形态，画布生成只使用当前项目的已登记输入", async () => {
  const harness = await createProductFactoryHarness();
  const app = express();
  app.use(express.json({ limit: "100mb" }));
  app.use("/image", generateFlowImageRoute);
  app.use("/video", generateVideoRoute);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await harness.knex.schema.alterTable("o_project", (table) => table.integer("userId"));
    await harness.knex.schema.createTable("o_script", (table) => { table.increments("id"); table.integer("projectId"); table.text("name"); table.text("content"); table.integer("createTime"); });
    await harness.knex.schema.createTable("o_videoTrack", (table) => { table.integer("id").primary(); table.integer("projectId"); table.integer("scriptId"); table.integer("duration"); });
    await harness.knex.schema.alterTable("o_video", (table) => { table.integer("time"); table.text("state"); table.integer("scriptId"); table.integer("videoTrackId"); table.text("errorReason"); });
    await ensureInfiniteCanvasSchema(harness.knex);
    await harness.addProject(9100, { projectType: "script", name: "旧短剧项目" });
    const [legacyScriptId] = await harness.knex("o_script").insert({ projectId: 9100, name: "旧剧本", content: "", createTime: Date.now() });
    const legacyTrackId = 91001;
    await harness.knex("o_videoTrack").insert({ id: legacyTrackId, projectId: 9100, scriptId: legacyScriptId, duration: 5 });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器地址无效");
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, json: await response.json() as any };
    };

    const legacyImage = await post("/image", { model: "fake:fake-image", references: [], quality: "2K", ratio: "16:9", prompt: "旧图片请求", projectId: 9100 });
    assert.equal(legacyImage.status, 200);
    assert.deepEqual(Object.keys(legacyImage.json.data), ["url"]);

    const canvas = await createInfiniteCanvasProject({
      name: "生成接口画布", imageModel: "fake:fake-image", videoModel: "fake:fake-video", imageQuality: "2K", videoRatio: "16:9", mode: "singleImage",
      settings: { defaultVideoResolution: "720p", defaultVideoDuration: 5, defaultVideoAudio: false },
    });
    const projectId = Number(canvas.project.id);
    const canvasGraph = graph([
      { id: "material-route", type: "material" },
      { id: "image-route", type: "image" },
      { id: "video-route", type: "video" },
    ], [
      { source: "material-route", target: "image-route", targetPort: "reference:1" },
      { source: "material-route", target: "video-route", targetPort: "firstFrame" },
    ]);
    await updateInfiniteCanvasGraph(projectId, canvasGraph, canvas.revision);
    const material = await uploadInfiniteCanvasMaterial({ projectId, nodeId: "material-route", fileName: "route.png", dataBase64: `data:image/png;base64,${Buffer.from("route-input").toString("base64")}` });

    const canvasImage = await post("/image", {
      model: "fake:fake-image", references: ["/oss/forged-other-project.png"], quality: "2K", ratio: "16:9", prompt: "画布图片请求", projectId,
      canvasContext: { nodeId: "image-route", inputSignature: "image-signature", inputArtifactIds: [material.id] },
    });
    assert.equal(canvasImage.status, 200);
    assert.equal(canvasImage.json.data.artifact.nodeId, "image-route");
    assert.equal(canvasImage.json.data.artifact.state, "success");
    const imageCall = [...harness.calls].reverse().find((call) => call.type === "image" && call.input.prompt === "画布图片请求");
    assert.match(String((imageCall?.input.referenceList as any[])?.[0]?.base64), /^data:image\/png;base64,/);

    const legacyVideo = await post("/video", { projectId: 9100, scriptId: Number(legacyScriptId), uploadData: [], prompt: "旧视频请求", model: "fake:fake-video", mode: "text", resolution: "720p", duration: 5, audio: false, trackId: legacyTrackId });
    assert.equal(legacyVideo.status, 200);
    assert.equal(typeof legacyVideo.json.data, "number");

    const canvasTrackId = 91002;
    await harness.knex("o_videoTrack").insert({ id: canvasTrackId, projectId, scriptId: canvas.scriptId, duration: 5 });
    const canvasVideo = await post("/video", {
      projectId, scriptId: canvas.scriptId, uploadData: [{ sources: "canvas", artifactId: material.id }], prompt: "画布视频请求", model: "fake:fake-video", mode: "singleImage", resolution: "720p", duration: 5, audio: false, trackId: canvasTrackId,
      canvasContext: { nodeId: "video-route", inputSignature: "video-signature", inputArtifactIds: [material.id] },
    });
    assert.equal(canvasVideo.status, 200);
    assert.equal(canvasVideo.json.data.artifact.nodeId, "video-route");
    assert.equal(typeof canvasVideo.json.data.videoId, "number");
    const deadline = Date.now() + 1000;
    let videoArtifact: any;
    while (Date.now() < deadline) {
      videoArtifact = (await listInfiniteCanvasArtifacts(projectId, "video-route"))[0];
      if (videoArtifact?.state === "success") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(videoArtifact?.state, "success");
    const videoCall = [...harness.calls].reverse().find((call) => call.type === "video" && call.input.prompt === "画布视频请求");
    assert.equal((videoCall?.input.referenceList as any[])?.[0]?.type, "image");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await harness.cleanup();
  }
});
