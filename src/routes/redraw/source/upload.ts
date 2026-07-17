import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { REDRAW_ALLOWED_MIME, REDRAW_MAX_DURATION_MS, REDRAW_MAX_FILE_SIZE } from "@/constants/redraw";
import { error, success } from "@/lib/responseFormat";
import { getOrCreateRedrawSource, redrawDb, requireRedrawProject } from "@/lib/redrawCommon";
import { assertSupportedRatio, probeSourceVideo } from "@/lib/redrawMedia";
import u from "@/utils";

const router = express.Router();
const extensions: Record<string, string> = { "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" };

export default router.post("/", async (req, res) => {
  const projectId = Number(req.query.projectId);
  const mimeType = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (!Number.isInteger(projectId) || projectId <= 0) return res.status(400).send(error("projectId 无效"));
  if (!REDRAW_ALLOWED_MIME.has(mimeType)) return res.status(415).send(error("仅支持 MP4、MOV、WebM 视频"));
  if (contentLength > REDRAW_MAX_FILE_SIZE) return res.status(413).send(error("源视频不能超过 2GB"));

  let tempPath = "";
  let storedRelPath = "";
  try {
    const project = await requireRedrawProject(projectId);
    const source = await getOrCreateRedrawSource(projectId);
    const shotExists = await redrawDb("o_redrawShot").where("sourceId", source.id).first("id");
    if (shotExists || source.analysisState === "running" || source.confirmed) {
      return res.status(409).send(error("视频分析已开始；请先执行“重置转绘流程”再替换源视频", null, 409));
    }

    const relPath = `${projectId}/redraw/source/${crypto.randomUUID()}${extensions[mimeType]}`;
    const finalPath = await u.oss.getLocalPath(relPath);
    tempPath = `${finalPath}.uploading`;
    await fsp.mkdir(path.dirname(finalPath), { recursive: true });
    const hash = crypto.createHash("sha256");
    let size = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > REDRAW_MAX_FILE_SIZE) return callback(new Error("源视频不能超过 2GB"));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(req, limiter, fs.createWriteStream(tempPath, { flags: "wx" }));
    if (!size) throw new Error("上传内容为空");

    const metadata = await probeSourceVideo(tempPath);
    if (metadata.durationMs <= 0 || metadata.durationMs > REDRAW_MAX_DURATION_MS) throw new Error("源视频时长必须大于 0 且不超过 20 分钟");
    assertSupportedRatio(metadata.width, metadata.height, project.videoRatio ?? "");
    const format = metadata.formatName.toLowerCase();
    const validContainer = mimeType === "video/webm" ? format.includes("webm") || format.includes("matroska") : format.includes("mov") || format.includes("mp4");
    if (!validContainer) throw new Error("文件实际容器与声明格式不一致");
    await fsp.rename(tempPath, finalPath);
    tempPath = "";
    storedRelPath = relPath;
    const now = Date.now();
    await redrawDb("o_redrawSource").where("id", source.id).update({
      filePath: relPath,
      originalName: (() => {
        const value = String(req.headers["x-file-name"] ?? "source-video");
        try { return decodeURIComponent(value); } catch { return value; }
      })(),
      mimeType,
      size,
      sha256: hash.digest("hex"),
      durationMs: metadata.durationMs,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      hasAudio: metadata.hasAudio,
      hasSubtitle: metadata.hasSubtitle,
      mediaMetadata: JSON.stringify(metadata.raw),
      analysisState: "pending",
      errorReason: null,
      confirmed: false,
      updateTime: now,
    });
    if (source.filePath && source.filePath !== relPath) await u.oss.deleteFile(source.filePath).catch(() => {});
    storedRelPath = "";
    return res.status(200).send(success({ ...(await redrawDb("o_redrawSource").where("id", source.id).first()), url: await u.oss.getFileUrl(relPath) }));
  } catch (cause) {
    if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {});
    if (storedRelPath) await u.oss.deleteFile(storedRelPath).catch(() => {});
    return res.status(400).send(error(u.error(cause).message));
  }
});
