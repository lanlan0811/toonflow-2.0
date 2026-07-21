import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import generateRouter from "../src/core";

// 打包默认使用 prod 环境变量
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "prod";
}

const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));

const external = [
  "electron",
  "@huggingface/transformers",
  "onnxruntime-node",
  "vm2",
  "sqlite3",
  "better-sqlite3",
  "sharp",
  "mysql",
  "mysql2",
  "pg",
  "pg-query-stream",
  "oracledb",
  "tedious",
  "mssql",
];

// 后端服务打包配置
const appBuildConfig: esbuild.BuildOptions = {
  entryPoints: ["src/app.ts"],
  bundle: true,
  minify: false,
  format: "cjs",
  allowOverwrite: true,
  outfile: `data/serve/app.js`,
  platform: "node",
  target: "esnext",
  tsconfig: "./tsconfig.json",
  alias: {
    "@": "./src",
  },
  sourcemap: false,
  external,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
};

// Electron 主进程打包配置
const mainBuildConfig: esbuild.BuildOptions = {
  entryPoints: ["scripts/main.ts"],
  bundle: true,
  minify: false,
  format: "cjs",
  outfile: `build/main.js`,
  allowOverwrite: true,
  platform: "node",
  target: "esnext",
  tsconfig: "./tsconfig.json",
  alias: {
    "@": "./src",
  },
  sourcemap: false,
  external,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
};

// 商品视觉工厂以独立浏览器子应用挂载到现有前端，避免改写历史 Vue bundle。
const productFactoryBuildConfig: esbuild.BuildOptions = {
  entryPoints: ["src/web/productFactory/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  outfile: "data/web/product-factory-studio.js",
  platform: "browser",
  target: "es2020",
  tsconfig: "./tsconfig.json",
  sourcemap: false,
};

// 无限画布作为独立浏览器子应用挂载，继续复用现有 Vue 壳层与后端服务。
const infiniteCanvasBuildConfig: esbuild.BuildOptions = {
  entryPoints: ["src/web/infiniteCanvas/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  outfile: "data/web/infinite-canvas-studio.js",
  platform: "browser",
  target: "es2020",
  tsconfig: "./tsconfig.json",
  sourcemap: false,
};

(async () => {
  try {
    console.log("🔨 开始构建...\n");

    await generateRouter();

    // 并行构建
    await Promise.all([esbuild.build(appBuildConfig), esbuild.build(mainBuildConfig), esbuild.build(productFactoryBuildConfig), esbuild.build(infiniteCanvasBuildConfig)]);

    console.log("✅ 后端服务构建完成: build/app.js");
    console.log("✅ Electron主进程构建完成: build/main.js");
    console.log("✅ 商品视觉工厂前端构建完成: data/web/product-factory-studio.js");
    console.log("✅ 无限画布前端构建完成: data/web/infinite-canvas-studio.js");
    console.log("\n🎉 所有构建任务完成!\n");
  } catch (err) {
    console.error("❌ 构建失败:", err);
    process.exit(1);
  }
})();
