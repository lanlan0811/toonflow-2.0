import path from "node:path";

export default function replaceUrl(url: string): string {
  if (typeof url !== "string" || !url.trim()) return "";
  let cleanedPath = "";
  try {
    const pathname = new URL(url).pathname;
    cleanedPath = pathname;
  } catch (e) {
    // 如果不是有效的URL，则直接使用原字符串
    cleanedPath = url;
  }
  cleanedPath = cleanedPath.replace(/^\/oss/, "").replace(/^\/smallImage/, "");
  // 去除 query 参数
  cleanedPath = cleanedPath.split("?")[0];
  // 防止路径穿越：对路径进行规范化后，确保不含上溯分量
  // 使用 posix 规范化（保持 / 分隔符），去除所有 .. 和 .
  const normalized = path.posix.normalize(cleanedPath);

  // 规范化后若路径以 ../ 开头或等于 .. 则说明发生了路径穿越，拒绝并返回空字符串
  if (normalized.startsWith("../") || normalized === "..") {
    return "";
  }

  // 去除前导斜杠，保证返回的是相对路径
  return normalized.replace(/^\/+/, "");
}
