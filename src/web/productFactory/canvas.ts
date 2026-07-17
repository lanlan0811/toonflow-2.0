import type { FactoryGraph } from "./types";

const labels: Record<string, string> = {
  source: "商品参考图",
  review: "人工审核门",
  main_clean: "干净主图",
  scene_studio: "棚拍场景",
  scene_lifestyle: "生活场景",
  scene_detail: "材质特写",
  video_hero: "英雄镜头",
  video_lifestyle: "生活镜头",
};

export function renderCanvas(host: HTMLElement, graph: FactoryGraph, onSave: (graph: FactoryGraph) => Promise<void>) {
  host.innerHTML = `<div class="pf-canvas-toolbar"><strong>每 SKU 高级工作流</strong><span>拖动节点后自动保存；向导与画布使用同一数据。</span><button class="pf-btn" data-canvas-save>立即保存</button></div><div class="pf-canvas-stage"><svg class="pf-canvas-edges"></svg><div class="pf-canvas-nodes"></div></div>`;
  const stage = host.querySelector<HTMLElement>(".pf-canvas-stage")!;
  const svg = host.querySelector<SVGElement>(".pf-canvas-edges")!;
  const nodesHost = host.querySelector<HTMLElement>(".pf-canvas-nodes")!;
  const drawEdges = () => {
    svg.innerHTML = graph.edges.map((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      if (!source || !target) return "";
      const x1 = source.position.x + 170, y1 = source.position.y + 40, x2 = target.position.x, y2 = target.position.y + 40;
      return `<path d="M${x1} ${y1} C${x1 + 70} ${y1},${x2 - 70} ${y2},${x2} ${y2}" />`;
    }).join("");
  };
  for (const node of graph.nodes) {
    const element = document.createElement("div");
    element.className = `pf-canvas-node pf-node-${node.type}`;
    element.style.left = `${node.position.x}px`;
    element.style.top = `${node.position.y}px`;
    element.innerHTML = `<small>${node.type.toUpperCase()}</small><strong>${labels[String(node.data.slotKey || node.type)] || node.id}</strong><span>${node.data.aspectRatio || ""}</span>`;
    let origin: { x: number; y: number; left: number; top: number } | null = null;
    element.addEventListener("pointerdown", (event) => {
      origin = { x: event.clientX, y: event.clientY, left: node.position.x, top: node.position.y };
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener("pointermove", (event) => {
      if (!origin) return;
      node.position.x = Math.max(10, origin.left + event.clientX - origin.x);
      node.position.y = Math.max(10, origin.top + event.clientY - origin.y);
      element.style.left = `${node.position.x}px`;
      element.style.top = `${node.position.y}px`;
      drawEdges();
    });
    element.addEventListener("pointerup", async () => { if (origin) { origin = null; await onSave(graph); } });
    nodesHost.appendChild(element);
  }
  drawEdges();
  host.querySelector("[data-canvas-save]")?.addEventListener("click", () => void onSave(graph));
  stage.scrollTo({ left: Math.max(0, graph.viewport?.x || 0), top: Math.max(0, graph.viewport?.y || 0) });
}
