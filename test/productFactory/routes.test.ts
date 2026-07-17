import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import u from "../../src/utils";
import projectListRoute from "../../src/routes/project/getProject";
import modelListRoute from "../../src/routes/productFactory/models/list";
import { closeApplicationDbForTest, createProductFactoryHarness } from "./harness";

after(closeApplicationDbForTest);

test("普通项目接口隐藏 commerce，商品工厂接口隔离损坏 Vendor", async () => {
  const harness = await createProductFactoryHarness();
  const app = express();
  app.use(express.json());
  app.use("/projects", projectListRoute);
  app.use("/models", modelListRoute);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await harness.addProject(501);
    await harness.knex("o_project").insert({ id: 502, projectType: "script", name: "短剧项目", intro: "", createTime: Date.now() });
    await harness.knex("o_vendorConfig").insert({ id: "broken", name: "Broken Vendor", enable: 1, inputValues: "{}" });
    const currentVendor = u.vendor;
    (u as any).vendor = {
      ...currentVendor,
      getVendor: (id: string) => {
        if (id === "broken") throw new Error("损坏 Vendor");
        return currentVendor.getVendor(id);
      },
      getModelList: async (id: string) => {
        if (id === "broken") throw new Error("损坏 Vendor");
        return currentVendor.getModelList(id);
      },
    };
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器地址无效");
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.json() as Promise<{ code: number; data: any[] }>;
    };
    const ordinary = await post("/projects", {});
    const factory = await post("/projects", { includeCommerce: true });
    assert.deepEqual(ordinary.data.map((project) => project.id), [502]);
    assert.deepEqual(factory.data.map((project) => project.id).sort(), [501, 502]);
    const imageModels = await post("/models", { type: "image" });
    assert.equal(imageModels.code, 200);
    assert.deepEqual(imageModels.data.map((model) => model.value), ["fake-image"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await harness.cleanup();
  }
});
