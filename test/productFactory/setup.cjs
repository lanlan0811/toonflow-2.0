const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `toonflow-product-factory-${process.pid}-`));
process.env.TOONFLOW_DATA_DIR = dataDir;
process.env.TOONFLOW_SKIP_EMBEDDING_INIT = "1";
process.once("exit", () => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows may briefly retain a SQLite handle; the OS temp directory remains recoverable.
  }
});
