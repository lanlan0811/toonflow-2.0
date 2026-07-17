import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import u from "@/utils";
import { ensureProductFactoryConfig, markProductFactoryArtifactsInputChanged, refreshProductFactoryItemState } from "@/lib/productFactory/service";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ReferenceUploadInput {
  projectId: number;
  productId?: number | null;
  scope?: "brand" | "product";
  fileName: string;
  mimeType: string;
  dataBase64: string;
  role?: string;
  isPrimary?: boolean;
}

function safeFileName(value: string) {
  const ext = path.extname(value).toLowerCase();
  const base = path.basename(value, ext).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "reference";
  return `${base}${ext}`;
}

export async function uploadProductFactoryReference(input: ReferenceUploadInput) {
  await ensureProductFactoryConfig(input.projectId);
  const scope = input.scope === "brand" ? "brand" : "product";
  const productId = scope === "product" ? Number(input.productId) : null;
  if (scope === "product") {
    if (!Number.isInteger(productId) || Number(productId) <= 0) throw new Error("商品 ID 无效");
    const item = await u.db("o_productFactoryItem").where({ projectId: input.projectId, id: productId }).first();
    if (!item) throw new Error("商品不存在");
  }
  if (!allowedMimeTypes.has(input.mimeType)) throw new Error("仅支持 JPEG、PNG 和 WebP 图片");
  const encoded = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("图片内容为空");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("单张图片不能超过 20MB");
  const metadata = await sharp(buffer).metadata();
  const actualMime = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "";
  if (!actualMime || actualMime !== input.mimeType) throw new Error("图片实际格式与声明格式不一致或不受支持");
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const duplicate = await u.db("o_productFactoryReference").where({ projectId: input.projectId, productId, scope, sha256 }).first();
  if (duplicate) return { ...duplicate, duplicate: true, url: await u.oss.getFileUrl(duplicate.filePath), qualityWarning: Number(duplicate.width || 0) < 512 || Number(duplicate.height || 0) < 512 };
  const currentCount = await u.db("o_productFactoryReference").where({ projectId: input.projectId, productId, scope }).count({ count: "id" }).first();
  const max = scope === "brand" ? 5 : 10;
  if (Number((currentCount as any)?.count || 0) >= max) throw new Error(`${scope === "brand" ? "品牌" : "每个商品"}最多上传 ${max} 张参考图`);
  const timestamp = Date.now();
  const sanitized = safeFileName(input.fileName);
  const canonicalExt = actualMime === "image/jpeg" ? ".jpg" : actualMime === "image/png" ? ".png" : ".webp";
  const fileName = `${path.basename(sanitized, path.extname(sanitized))}${canonicalExt}`;
  const filePath = `product-factory/${input.projectId}/${scope === "brand" ? "brand" : productId}/references/${sha256.slice(0, 16)}-${fileName}`;
  await u.oss.writeFile(filePath, buffer);
  try {
    if (scope === "product" && input.isPrimary) await u.db("o_productFactoryReference").where({ projectId: input.projectId, productId, scope }).update({ isPrimary: 0 });
    const [id] = await u.db("o_productFactoryReference").insert({
      projectId: input.projectId,
      productId,
      scope,
      filePath,
      fileName,
      mimeType: actualMime,
      sha256,
      role: input.role || "other",
      isPrimary: scope === "product" && input.isPrimary ? 1 : 0,
      sortIndex: Number((currentCount as any)?.count || 0),
      width: metadata.width || null,
      height: metadata.height || null,
      createTime: timestamp,
    });
    if (scope === "product") {
      await markProductFactoryArtifactsInputChanged(input.projectId, [Number(productId)]);
      await refreshProductFactoryItemState(input.projectId, Number(productId));
    } else await markProductFactoryArtifactsInputChanged(input.projectId);
    return {
      ...(await u.db("o_productFactoryReference").where("id", Number(id)).first()),
      url: await u.oss.getFileUrl(filePath),
      duplicate: false,
      qualityWarning: Number(metadata.width || 0) < 512 || Number(metadata.height || 0) < 512,
    };
  } catch (error) {
    try { await u.oss.deleteFile(filePath); } catch { /* ignore cleanup failure */ }
    throw error;
  }
}

export async function deleteProductFactoryReference(projectId: number, referenceId: number) {
  const reference = await u.db("o_productFactoryReference").where({ projectId, id: referenceId }).first();
  if (!reference) throw new Error("参考图不存在");
  await u.db("o_productFactoryReference").where({ projectId, id: referenceId }).delete();
  if (reference.productId) await markProductFactoryArtifactsInputChanged(projectId, [Number(reference.productId)]);
  else await markProductFactoryArtifactsInputChanged(projectId);
  try { await u.oss.deleteFile(reference.filePath); } catch { /* file can already be missing */ }
  if (reference.productId) await refreshProductFactoryItemState(projectId, Number(reference.productId));
  return { deleted: 1 };
}

export async function setPrimaryProductFactoryReference(projectId: number, productId: number, referenceId: number) {
  const reference = await u.db("o_productFactoryReference").where({ projectId, productId, id: referenceId, scope: "product" }).first();
  if (!reference) throw new Error("商品参考图不存在");
  await u.db.transaction(async (trx) => {
    await trx("o_productFactoryReference").where({ projectId, productId, scope: "product" }).update({ isPrimary: 0 });
    await trx("o_productFactoryReference").where({ projectId, productId, id: referenceId }).update({ isPrimary: 1 });
  });
  await markProductFactoryArtifactsInputChanged(projectId, [productId]);
  await refreshProductFactoryItemState(projectId, productId);
  return { referenceId };
}
