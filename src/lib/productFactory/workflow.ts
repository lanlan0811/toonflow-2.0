import {
  DEFAULT_PRODUCT_FACTORY_PACK,
  type ProductFactoryGraph,
  type ProductFactoryPack,
} from "@/lib/productFactory/types";

function nodeId(kind: string, slot?: string, ratio?: string) {
  return [kind, slot, ratio].filter(Boolean).join(":");
}

export function normalizeFactoryPack(value?: Partial<ProductFactoryPack> | null): ProductFactoryPack {
  const requested = value || {};
  const imageSlots = DEFAULT_PRODUCT_FACTORY_PACK.imageSlots.filter((slot) => !requested.imageSlots || requested.imageSlots.includes(slot));
  const videoSlots = DEFAULT_PRODUCT_FACTORY_PACK.videoSlots.filter((slot) => !requested.videoSlots || requested.videoSlots.includes(slot));
  const ratios = DEFAULT_PRODUCT_FACTORY_PACK.ratios.filter((ratio) => !requested.ratios || requested.ratios.includes(ratio));
  return {
    imageSlots: imageSlots.length ? imageSlots : [...DEFAULT_PRODUCT_FACTORY_PACK.imageSlots],
    videoSlots: videoSlots.length ? videoSlots : [...DEFAULT_PRODUCT_FACTORY_PACK.videoSlots],
    ratios: ratios.length ? ratios : [...DEFAULT_PRODUCT_FACTORY_PACK.ratios],
    imageQuality: ["1K", "2K", "4K"].includes(String(requested.imageQuality)) ? requested.imageQuality! : DEFAULT_PRODUCT_FACTORY_PACK.imageQuality,
    videoResolution: String(requested.videoResolution || DEFAULT_PRODUCT_FACTORY_PACK.videoResolution),
    videoDuration: Math.max(1, Math.min(30, Number(requested.videoDuration || DEFAULT_PRODUCT_FACTORY_PACK.videoDuration))),
    videoAudio: Boolean(requested.videoAudio),
  };
}

export function createDefaultProductWorkflow(productId: number, packValue?: Partial<ProductFactoryPack> | null): ProductFactoryGraph {
  const pack = normalizeFactoryPack(packValue);
  const source = nodeId("source");
  const review = nodeId("review");
  const nodes: ProductFactoryGraph["nodes"] = [
    { id: source, type: "source", position: { x: 80, y: 260 }, data: { label: "商品参考图" } },
  ];
  const edges: ProductFactoryGraph["edges"] = [];
  let imageIndex = 0;
  for (const ratio of pack.ratios) {
    for (const slot of pack.imageSlots) {
      const id = nodeId("image", slot, ratio);
      nodes.push({
        id,
        type: "image",
        position: { x: 430, y: 80 + imageIndex * 150 },
        data: { slotKey: slot, aspectRatio: ratio, promptOverride: null, promptCustomized: false },
      });
      edges.push({ id: `edge:${source}:${id}`, source, target: id });
      imageIndex += 1;
    }
  }
  nodes.push({ id: review, type: "review", position: { x: 820, y: 260 }, data: { label: "人工审核" } });
  for (const node of nodes.filter((item) => item.type === "image")) edges.push({ id: `edge:${node.id}:${review}`, source: node.id, target: review });
  let videoIndex = 0;
  for (const ratio of pack.ratios) {
    for (const slot of pack.videoSlots) {
      const id = nodeId("video", slot, ratio);
      nodes.push({
        id,
        type: "video",
        position: { x: 1160, y: 140 + videoIndex * 180 },
        data: { slotKey: slot, aspectRatio: ratio, promptOverride: null, promptCustomized: false },
      });
      edges.push({ id: `edge:${review}:${id}`, source: review, target: id });
      videoIndex += 1;
    }
  }
  const reviewMappings: Record<string, number | null> = {};
  for (const ratio of pack.ratios) {
    reviewMappings[`video_hero:${ratio}`] = null;
    reviewMappings[`video_lifestyle:${ratio}`] = null;
  }
  return {
    version: 1,
    productId,
    customized: false,
    nodes,
    edges,
    reviewMappings,
    viewport: { x: 30, y: 30, zoom: 0.75 },
  };
}

export function validateProductWorkflow(graph: ProductFactoryGraph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length) throw new Error("工作流包含重复节点 ID");
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error("工作流连线引用了不存在的节点");
    if (edge.source === edge.target) throw new Error("工作流节点不能连接自身");
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const target of outgoing.get(id) || []) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (visited !== graph.nodes.length) throw new Error("工作流中存在循环连接");
  if (!graph.nodes.some((node) => node.type === "source")) throw new Error("工作流缺少商品参考图节点");
  if (!graph.nodes.some((node) => node.type === "review")) throw new Error("工作流缺少人工审核节点");
  return true;
}
