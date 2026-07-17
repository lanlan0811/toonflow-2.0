import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const indexPath = path.resolve("data/web/index.html");
let html = fs.readFileSync(indexPath, "utf8");

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function replaceSigned(name: string, from: string, to: string, expectedHash: string) {
  if (html.includes(to)) return;
  const matches = html.split(from).length - 1;
  if (matches !== 1) throw new Error(`[redraw web patch] ${name} 签名片段应出现 1 次，实际 ${matches} 次`);
  const actualHash = sha256(from);
  if (actualHash !== expectedHash) throw new Error(`[redraw web patch] ${name} SHA-256 不匹配：${actualHash}`);
  html = html.replace(from, to);
}

replaceSigned(
  "项目类型选项",
  'c(we,{key:"基于分镜表",label:"基于分镜表",value:"storyboard"})',
  'c(we,{key:"基于分镜表",label:"基于分镜表",value:"storyboard"}),c(we,{key:"转绘",label:"转绘",value:"redraw"})',
  "9733035021ad90a86265f2fc5355fa67f80980b78a57afd91c2e0acd1b5a99cb",
);

replaceSigned(
  "项目打开路由",
  'A.projectType==="novel"?l.push("/novel"):A.projectType==="storyboard"?l.push("/storyboard-table?projectId="+A.id):A.projectType==="script"&&l.push("/script")',
  'A.projectType==="novel"?l.push("/novel"):A.projectType==="storyboard"?l.push("/storyboard-table?projectId="+A.id):A.projectType==="redraw"?l.push("/redraw?projectId="+A.id):A.projectType==="script"&&l.push("/script")',
  "06138f0dbc160772f2035ddf0d6f4c845c4e62244d3a5b1d11288ea31483a5a0",
);

replaceSigned(
  "项目卡片标签",
  'y.projectType=="novel"?k.$t("workbench.project.type.novel"):y.projectType=="storyboard"?k.$t("workbench.project.type.storyboard"):k.$t("workbench.project.type.script")',
  'y.projectType=="novel"?k.$t("workbench.project.type.novel"):y.projectType=="storyboard"?k.$t("workbench.project.type.storyboard"):y.projectType=="redraw"?"转绘":k.$t("workbench.project.type.script")',
  "189e6fd197bade70c575c1aadb48d649b5fc2cbe407a0d1134e2d93d480dd6c0",
);

replaceSigned(
  "项目类型翻译",
  'type:{novel:"基于小说原文",script:"基于剧本",storyboard:"基于分镜表"}',
  'type:{novel:"基于小说原文",script:"基于剧本",storyboard:"基于分镜表",redraw:"转绘"}',
  "70d4580074075300f71b300bfbf8aaeba7da4d8b60b893609a9ef0884e27a550",
);

const redrawStyleBlock =
  '  <!-- TOONFLOW_REDRAW_STUDIO_V1 -->\n<link rel="stylesheet" href="./redraw-studio.css?v=20260717">\n';
const redrawScriptBlock =
  '  <!-- TOONFLOW_REDRAW_STUDIO_V1 -->\n<script src="./redraw-studio.js?v=20260717"></script>\n';

// The application bundle is inlined and contains literal </head> / </body>
// strings. Always remove a previous injection and target the final document
// closing tags, otherwise an injected </script> terminates the module early.
html = html.replaceAll(redrawStyleBlock, "").replaceAll(redrawScriptBlock, "");

function insertBeforeFinalTag(tag: "</head>" | "</body>", block: string) {
  const position = html.lastIndexOf(tag);
  if (position < 0) throw new Error(`index.html missing final ${tag}`);
  const tagEnd = position + tag.length;
  const suffix = html
    .slice(tagEnd)
    .replace(/^[\t ]+(?=\r?\n)/, "")
    .replace(/^\r\n/, "\n");
  html = `${html.slice(0, position)}${block}${tag}${suffix}`;
}

insertBeforeFinalTag("</head>", redrawStyleBlock);
insertBeforeFinalTag("</body>", redrawScriptBlock);

const tempPath = `${indexPath}.redraw-patch.tmp`;
fs.writeFileSync(tempPath, html, "utf8");
fs.renameSync(tempPath, indexPath);
console.log("[redraw web patch] index.html 已验证并更新");
