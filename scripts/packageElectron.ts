import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceDir = process.cwd();

async function run(command: string, args: string[], options: { capture?: boolean; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  return await new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? workspaceDir,
      windowsHide: true,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: options.env ?? process.env,
    });
    let output = "";
    if (options.capture) {
      child.stdout?.setEncoding("utf8").on("data", (value) => (output += value));
      child.stderr?.setEncoding("utf8").on("data", (value) => (output += value));
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function assertHostBindings() {
  const script = [
    "const Database = require('better-sqlite3');",
    "const db = new Database(':memory:');",
    "db.prepare('select 1').get();",
    "db.close();",
    "require('sqlite3');",
  ].join("");
  const result = await run(process.execPath, ["-e", script], { capture: true });
  if (result.code !== 0) {
    throw new Error(
      `当前 Node.js ABI ${process.versions.modules} 无法加载原生数据库模块。请先执行 npm rebuild better-sqlite3 sqlite3。\n${result.output.trim()}`,
    );
  }
}

async function prepareElectronBindings(stagingDir: string) {
  const electronData = JSON.parse(await fs.readFile(path.join(workspaceDir, "node_modules", "electron", "package.json"), "utf8"));
  const moduleSource = path.join(workspaceDir, "node_modules", "better-sqlite3");
  const moduleTarget = path.join(stagingDir, "node_modules", "better-sqlite3");
  await fs.mkdir(path.dirname(moduleTarget), { recursive: true });
  await fs.cp(moduleSource, moduleTarget, { recursive: true, force: true });

  const prebuildCli = path.join(workspaceDir, "node_modules", "prebuild-install", "bin.js");
  const rebuild = await run(process.execPath, [
    prebuildCli,
    "--runtime", "electron",
    "--target", electronData.version,
    "--arch", process.arch,
    "--platform", process.platform,
    "--force",
  ], { cwd: moduleTarget });
  if (rebuild.code !== 0) throw new Error(`Electron ${electronData.version} 的 better-sqlite3 预编译模块安装失败`);

  console.log(`[native ABI] 已隔离准备 Electron ${electronData.version} 的 better-sqlite3`);
}

async function validatePackagedElectron() {
  if (process.platform !== "win32") return;
  const electronBinary = path.join(workspaceDir, "dist", "win-unpacked", "ToonFlow.exe");
  try {
    await fs.access(electronBinary);
  } catch {
    return;
  }
  const packagedModule = path.join(workspaceDir, "dist", "win-unpacked", "resources", "app.asar", "node_modules", "better-sqlite3");
  const script = `const Database=require(${JSON.stringify(packagedModule)});const db=new Database(':memory:');console.log('ABI='+process.versions.modules+' VALUE='+db.prepare('select 1 as value').get().value);db.close();`;
  const result = await run(electronBinary, ["-e", script], {
    capture: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (result.code !== 0) throw new Error(`打包后的 Electron 无法加载 better-sqlite3：${result.output.trim()}`);
  console.log(`[native ABI] 包内验证通过：${result.output.trim()}`);
}

async function main() {
  await assertHostBindings();
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "toonflow-electron-native-"));
  let builderCode = 1;
  try {
    await prepareElectronBindings(stagingDir);
    const builderCli = path.join(workspaceDir, "node_modules", "electron-builder", "cli.js");
    const result = await run(process.execPath, [builderCli, ...process.argv.slice(2)], {
      env: { ...process.env, TOONFLOW_ELECTRON_NATIVE_DIR: stagingDir },
    });
    builderCode = result.code;
    if (builderCode === 0) await validatePackagedElectron();
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  await assertHostBindings();
  console.log(`[native ABI] 工作区始终保持 Node ABI ${process.versions.modules}`);
  if (builderCode !== 0) process.exit(builderCode);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
