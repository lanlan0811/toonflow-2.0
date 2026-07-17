import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path as string;
const ffprobePath = require("@ffprobe-installer/ffprobe").path as string;

export interface RedrawMediaMetadata {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  formatName: string;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
  hasSubtitle: boolean;
  videoStartMs: number;
  audioStartMs: number | null;
  avSyncOffsetMs: number | null;
  streams: any[];
  raw: any;
}

async function runMediaCommand(binary: string, args: string[], timeoutMs = 20 * 60 * 1000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value) => (stdout += value));
    child.stderr.setEncoding("utf8").on("data", (value) => {
      stderr += value;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("本地媒体处理超时"));
    }, timeoutMs);
    child.on("error", (cause) => {
      clearTimeout(timeout);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`FFmpeg 执行失败（${code}）：${stderr.slice(-1200)}`));
    });
  });
}

function parseFrameRate(value: string | undefined) {
  if (!value) return 0;
  const [numerator, denominator = 1] = value.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

export async function probeSourceVideo(filePath: string): Promise<RedrawMediaMetadata> {
  const { stdout } = await runMediaCommand(ffprobePath, ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath], 60_000);
  const raw = JSON.parse(stdout);
  const streams = Array.isArray(raw.streams) ? raw.streams : [];
  const video = streams.find((stream: any) => stream.codec_type === "video");
  if (!video) throw new Error("上传文件中没有可用视频流");
  const audio = streams.find((stream: any) => stream.codec_type === "audio");
  const durationSeconds = Number(video.duration ?? raw.format?.duration ?? 0);
  const videoStartMs = Math.round(Number(video.start_time ?? raw.format?.start_time ?? 0) * 1000);
  const audioStartMs = audio ? Math.round(Number(audio.start_time ?? raw.format?.start_time ?? 0) * 1000) : null;
  return {
    durationMs: Math.round(durationSeconds * 1000),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: parseFrameRate(video.avg_frame_rate || video.r_frame_rate),
    formatName: String(raw.format?.format_name ?? ""),
    videoCodec: String(video.codec_name ?? ""),
    audioCodec: audio?.codec_name ? String(audio.codec_name) : null,
    hasAudio: Boolean(audio),
    hasSubtitle: streams.some((stream: any) => stream.codec_type === "subtitle"),
    videoStartMs,
    audioStartMs,
    avSyncOffsetMs: audioStartMs === null ? null : audioStartMs - videoStartMs,
    streams,
    raw,
  };
}

export function assertSupportedRatio(width: number, height: number, projectRatio: string) {
  if (!width || !height) throw new Error("无法读取源视频分辨率");
  const actual = width / height;
  const supported = [
    { name: "16:9", value: 16 / 9 },
    { name: "9:16", value: 9 / 16 },
  ];
  const sourceRatio = supported.find((item) => Math.abs(actual - item.value) / item.value <= 0.02);
  if (!sourceRatio) throw new Error("首版转绘只支持 16:9 或 9:16 视频，比例误差不得超过 2% ");
  const expected = projectRatio.includes("9:16") ? "9:16" : projectRatio.includes("16:9") ? "16:9" : projectRatio;
  if (expected && expected !== sourceRatio.name) throw new Error(`源视频比例 ${sourceRatio.name} 与项目设置 ${projectRatio} 不一致`);
  return sourceRatio.name;
}

export async function detectShotCandidates(filePath: string, durationMs: number) {
  const { stderr } = await runMediaCommand(ffmpegPath, [
    "-hide_banner",
    "-i",
    filePath,
    "-vf",
    "select=gt(scene\\,0.32),showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const boundaries = [0];
  for (const match of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
    const value = Math.round(Number(match[1]) * 1000);
    if (value > 0 && value < durationMs && value - boundaries[boundaries.length - 1] >= 300) boundaries.push(value);
  }
  if (durationMs - boundaries[boundaries.length - 1] < 300 && boundaries.length > 1) boundaries.pop();
  boundaries.push(durationMs);
  return boundaries;
}

export async function createAnalysisProxy(sourcePath: string, outputPath: string) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runMediaCommand(ffmpegPath, [
    "-y",
    "-i",
    sourcePath,
    "-vf",
    "scale='min(640,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "31",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function extractSegment(sourcePath: string, outputPath: string, startMs: number, endMs: number) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const duration = Math.max(0.04, (endMs - startMs) / 1000);
  await runMediaCommand(ffmpegPath, [
    "-y",
    "-ss",
    (startMs / 1000).toFixed(3),
    "-i",
    sourcePath,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function extractKeyframe(sourcePath: string, outputPath: string, timeMs: number) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runMediaCommand(ffmpegPath, ["-y", "-ss", (timeMs / 1000).toFixed(3), "-i", sourcePath, "-frames:v", "1", "-q:v", "2", outputPath], 60_000);
}

export function planInternalSegments(startMs: number, endMs: number, maxDurationMs: number, minDurationMs: number, overlapMs = 250) {
  const result: { startMs: number; endMs: number; generationDurationMs: number }[] = [];
  if (endMs <= startMs) throw new Error("片段结束时间必须晚于开始时间");
  if (endMs - startMs <= maxDurationMs) {
    return [{ startMs, endMs, generationDurationMs: Math.max(endMs - startMs, minDurationMs) }];
  }
  let cursor = startMs;
  while (cursor < endMs) {
    const segmentEnd = Math.min(cursor + maxDurationMs, endMs);
    result.push({ startMs: cursor, endMs: segmentEnd, generationDurationMs: Math.max(segmentEnd - cursor, minDurationMs) });
    if (segmentEnd === endMs) break;
    cursor = Math.max(cursor + 1, segmentEnd - overlapMs);
  }
  return result;
}

function quoteConcatPath(value: string) {
  return value.replace(/'/g, "'\\''");
}

export async function assembleRedrawVideo(options: {
  sourcePath: string;
  segments: { path: string; startMs: number; endMs: number }[];
  outputPath: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
}) {
  const { sourcePath, segments, outputPath, durationMs, width, height, fps } = options;
  if (!segments.length) throw new Error("没有可合成的转绘片段");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const concatPath = `${outputPath}.concat.txt`;
  const silentPath = `${outputPath}.silent.mp4`;
  const timelineDir = `${outputPath}.timeline`;
  await fs.mkdir(timelineDir, { recursive: true });
  const normalizedPaths: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index];
    const previous = segments[index - 1];
    const next = segments[index + 1];
    const leadingOverlapMs = previous ? Math.max(0, previous.endMs - current.startMs) : 0;
    const trailingOverlapMs = next ? Math.max(0, current.endMs - next.startMs) : 0;
    const sourceDurationMs = current.endMs - current.startMs;
    const bodyDurationMs = sourceDurationMs - leadingOverlapMs - trailingOverlapMs;
    if (bodyDurationMs > 0) {
      const bodyPath = path.join(timelineDir, `body-${String(index).padStart(4, "0")}.mp4`);
      await runMediaCommand(ffmpegPath, [
        "-y", "-ss", (leadingOverlapMs / 1000).toFixed(3), "-i", current.path,
        "-t", (bodyDurationMs / 1000).toFixed(3), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", bodyPath,
      ]);
      normalizedPaths.push(bodyPath);
    }
    if (next && trailingOverlapMs > 0) {
      const transitionPath = path.join(timelineDir, `blend-${String(index).padStart(4, "0")}.mp4`);
      const overlapSeconds = trailingOverlapMs / 1000;
      const currentDurationSeconds = sourceDurationMs / 1000;
      const filter = `[0:v]trim=start=${(currentDurationSeconds - overlapSeconds).toFixed(3)}:end=${currentDurationSeconds.toFixed(3)},setpts=PTS-STARTPTS[a];[1:v]trim=start=0:end=${overlapSeconds.toFixed(3)},setpts=PTS-STARTPTS[b];[a][b]blend=all_expr='A*(1-T/${overlapSeconds.toFixed(3)})+B*(T/${overlapSeconds.toFixed(3)})':shortest=1,format=yuv420p[v]`;
      await runMediaCommand(ffmpegPath, [
        "-y", "-i", current.path, "-i", next.path, "-filter_complex", filter, "-map", "[v]", "-t", overlapSeconds.toFixed(3), "-an", "-c:v", "libx264", transitionPath,
      ]);
      normalizedPaths.push(transitionPath);
    }
  }
  await fs.writeFile(concatPath, normalizedPaths.map((item) => `file '${quoteConcatPath(path.resolve(item))}'`).join("\n"), "utf8");
  try {
    await runMediaCommand(ffmpegPath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-t",
      (durationMs / 1000).toFixed(3),
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "-r",
      String(fps || 25),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      silentPath,
    ]);
    try {
      await runMediaCommand(ffmpegPath, [
        "-y",
        "-i",
        silentPath,
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        "-t",
        (durationMs / 1000).toFixed(3),
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    } catch {
      await runMediaCommand(ffmpegPath, [
        "-y",
        "-i",
        silentPath,
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-t",
        (durationMs / 1000).toFixed(3),
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    }
  } finally {
    await Promise.all([fs.rm(concatPath, { force: true }), fs.rm(silentPath, { force: true }), fs.rm(timelineDir, { recursive: true, force: true })]);
  }
}

export async function burnSrtSubtitles(inputPath: string, srtPath: string, outputPath: string) {
  const escapedSrtPath = path.resolve(srtPath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await runMediaCommand(ffmpegPath, [
    "-y", "-i", inputPath, "-vf", `subtitles='${escapedSrtPath}'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outputPath,
  ]);
}

export function formatSrtTimestamp(milliseconds: number) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(shots: { startMs: number; endMs: number; dialogue?: string | null }[]) {
  return shots
    .filter((shot) => shot.dialogue?.trim())
    .map((shot, index) => `${index + 1}\n${formatSrtTimestamp(shot.startMs)} --> ${formatSrtTimestamp(shot.endMs)}\n${shot.dialogue!.trim()}\n`)
    .join("\n");
}

export const mediaRuntime = { ffmpegPath, ffprobePath };
