import u from "@/utils";
import { requireProductFactoryProject } from "@/lib/productFactory/service";

export interface ProductFactoryExportEntry {
  relativePath: string;
  content: Buffer;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeSegment(value: unknown) {
  return String(value || "unknown").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 80);
}

export async function collectProductFactoryExport(projectId: number, requestedProductIds: number[]) {
  const productIds = [...new Set(requestedProductIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!productIds.length) throw new Error("请选择要导出的商品");
  await requireProductFactoryProject(projectId, true);
  const items = await u.db("o_productFactoryItem").where("projectId", projectId).whereIn("id", productIds);
  if (items.length !== productIds.length) throw new Error("导出范围包含不存在或不属于该项目的商品");
  const artifacts = await u.db("o_productFactoryArtifact")
    .where("projectId", projectId)
    .whereIn("productId", productIds)
    .where("state", "success")
    .where((builder) => builder.where((nested) => nested.where({ mediaType: "image", approved: 1 })).orWhere((nested) => nested.where({ mediaType: "video", isCurrent: 1 })))
    .orderBy("productId", "asc")
    .orderBy("id", "asc");
  const itemMap = new Map(items.map((item) => [Number(item.id), item]));
  const entries: ProductFactoryExportEntry[] = [];
  const manifest = [["sku", "name", "media_type", "slot", "aspect_ratio", "version", "model", "file"]];
  const omittedArtifactIds: number[] = [];
  for (const artifact of artifacts) {
    if (!artifact.filePath) continue;
    const item = itemMap.get(Number(artifact.productId));
    if (!item) continue;
    const sourceExt = artifact.filePath.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
    const ext = artifact.mediaType === "video" ? "mp4" : ["jpg", "jpeg", "png", "webp"].includes(sourceExt || "") ? sourceExt! : "png";
    const relativePath = `${safeSegment(item.sku)}/${safeSegment(artifact.slotKey)}-${safeSegment(artifact.aspectRatio).replace(":", "x")}-v${artifact.version}.${ext}`;
    try {
      entries.push({ relativePath, content: await u.oss.getFile(artifact.filePath) });
      manifest.push([item.sku, item.name, artifact.mediaType, artifact.slotKey, artifact.aspectRatio, artifact.version, artifact.model, relativePath].map((value) => String(value ?? "")));
    } catch {
      omittedArtifactIds.push(Number(artifact.id));
    }
  }
  const manifestText = `\uFEFF${manifest.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  entries.push({ relativePath: "manifest.csv", content: Buffer.from(manifestText, "utf8") });
  return { entries, artifactCount: entries.length - 1, omittedArtifactIds, manifestText };
}
