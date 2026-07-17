const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function afterPackNative(context) {
  const stagingDir = process.env.TOONFLOW_ELECTRON_NATIVE_DIR;
  if (!stagingDir) {
    throw new Error("缺少 TOONFLOW_ELECTRON_NATIVE_DIR；请通过 package.json 中的 pack/dist 脚本执行 Electron 打包");
  }
  const relativeBinding = path.join("node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  const source = path.join(stagingDir, relativeBinding);
  const destination = path.join(context.appOutDir, "resources", "app.asar.unpacked", relativeBinding);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  console.log(`  • injected isolated Electron native binding  file=${destination}`);
};
