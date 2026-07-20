import u from "@/utils";

export function normalizeCanvasGraph(nodesValue: unknown, edgesValue: unknown) {
  const nodes = Array.isArray(nodesValue) ? structuredClone(nodesValue) : [];
  const edges = Array.isArray(edgesValue) ? structuredClone(edgesValue) : [];
  nodes.forEach((node: any) => {
    if (!node?.data) return;
    for (const key of ["image", "generatedImage", "globalImage", "originalSrc"]) {
      if (typeof node.data[key] === "string" && node.data[key]) node.data[key] = u.replaceUrl(node.data[key]);
    }
    if (Array.isArray(node.data.references)) {
      node.data.references.forEach((reference: any) => {
        if (typeof reference?.image === "string" && reference.image) reference.image = u.replaceUrl(reference.image);
      });
    }
  });
  return { nodes, edges };
}

export function assertNoUnpublishedDraftReference(nodesValue: unknown, edgesValue: unknown) {
  const nodes = Array.isArray(nodesValue) ? nodesValue : [];
  const edges = Array.isArray(edgesValue) ? edgesValue : [];
  const nodeMap = new Map(nodes.map((node: any) => [String(node?.id), node]));
  const finalIds = new Set(nodes.filter((node: any) => node?.data?.finalNode || node?.data?.isFinal).map((node: any) => String(node.id)));
  const invalid = edges.some((edge: any) => {
    if (!finalIds.has(String(edge?.target))) return false;
    const source = nodeMap.get(String(edge?.source));
    return Boolean(source?.data?.draftAsset && !Number(source?.data?.assetId));
  });
  if (invalid) throw new Error("未发布的角色、场景或道具草稿不能连接最终分镜，请先发布为正式资产。");
}

export async function copyCanvasImageToAsset(projectId: number, scriptId: number, type: string, imageUrl: string) {
  const sourcePath = u.replaceUrl(imageUrl).replace(/^\/smallImage\//, "/");
  if (!sourcePath) throw new Error("请先选择有效的资产图片");
  const base64 = await u.oss.getImageBase64(sourcePath);
  const extension = sourcePath.match(/\.(png|jpe?g|webp)$/i)?.[0]?.toLowerCase() || ".jpg";
  const savePath = `/${projectId}/assets/${scriptId}/${type}/${u.uuid()}${extension}`;
  await u.oss.writeFile(savePath, base64);
  return savePath;
}
