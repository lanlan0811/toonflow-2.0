import type { CanvasArtifact, CanvasEdge, CanvasGraph, CanvasNode, InputPort } from "./types";

const NODE_WIDTH = 264;
const BASE_HEIGHT = 226;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export interface CanvasControllerOptions {
  getArtifacts: () => CanvasArtifact[];
  getInputPorts: (node: CanvasNode) => InputPort[];
  validateEdge: (source: CanvasNode, target: CanvasNode, targetPort: string, graph: CanvasGraph) => string | null;
  onChange: (graph: CanvasGraph, semantic: boolean) => void;
  onSelection: (nodeIds: string[], edgeId: string | null) => void;
  onRun: (nodeId: string, pipeline: boolean) => void;
  onOpenNode: (nodeId: string) => void;
  onMessage: (message: string, type?: "error" | "info") => void;
}

export interface CanvasController {
  destroy(): void;
  addNode(type: CanvasNode["type"], data?: Record<string, any>): CanvasNode;
  updateGraph(graph: CanvasGraph): void;
  select(nodeIds: string[]): void;
  fitView(): void;
  autoLayout(): void;
  undo(): void;
  redo(): void;
  removeSelection(): void;
}

function currentArtifact(artifacts: CanvasArtifact[], nodeId: string) { return artifacts.find((item) => item.nodeId === nodeId && item.isCurrent && !item.detached); }
function nodeHeight(node: CanvasNode, ports: InputPort[]) { return Math.max(BASE_HEIGHT, 128 + ports.length * 32 + (node.type === "material" ? 42 : 0)); }
function bezier(source: { x: number; y: number }, target: { x: number; y: number }) {
  const gap = Math.max(90, Math.abs(target.x - source.x) * .45);
  const c1 = { x: source.x + gap, y: source.y }; const c2 = { x: target.x - gap, y: target.y };
  const d = `M ${source.x} ${source.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${target.x} ${target.y}`;
  const mid = { x: (source.x + 3 * c1.x + 3 * c2.x + target.x) / 8, y: (source.y + 3 * c1.y + 3 * c2.y + target.y) / 8 };
  return { d, mid };
}

export function renderInfiniteCanvas(host: HTMLElement, initial: CanvasGraph, options: CanvasControllerOptions): CanvasController {
  let graph = clone(initial);
  let selectedNodes = new Set<string>(); let selectedEdge: string | null = null;
  let destroyed = false; let past: CanvasGraph[] = []; let future: CanvasGraph[] = []; let clipboard: CanvasNode[] = [];
  let action: null | { kind: "pan" | "box" | "nodes" | "connect"; startX: number; startY: number; viewport?: { x: number; y: number }; positions?: Map<string, { x: number; y: number }>; source?: string; pointerX?: number; pointerY?: number } = null;
  let box: HTMLElement | null = null; let pendingSource: string | null = null; let spacePressed = false; let autoPanFrame = 0; let pointer = { x: 0, y: 0 };

  host.className = "ic-canvas-host";
  host.innerHTML = `<div class="ic-stage" tabindex="0"><svg class="ic-svg" aria-hidden="true"><g class="ic-edge-world"></g></svg><div class="ic-world"></div><div class="ic-canvas-toolbar"><button data-tool="undo" title="撤销 Ctrl+Z">↶</button><button data-tool="redo" title="重做 Ctrl+Shift+Z">↷</button><button data-tool="left" title="向左平移">←</button><button data-tool="up" title="向上平移">↑</button><button data-tool="down" title="向下平移">↓</button><button data-tool="right" title="向右平移">→</button><button data-tool="zoom-out">−</button><span data-zoom></span><button data-tool="zoom-in">＋</button><button data-tool="fit">适配</button><button data-tool="layout">自动排版</button></div><div class="ic-minimap"><svg><g data-mini-edges></g><g data-mini-nodes></g><rect data-mini-view></rect></svg></div><div class="ic-shortcuts">Space/中键平移 · 滚轮缩放 · 框选 · Ctrl+C/V · Delete</div></div>`;
  const stage = host.querySelector<HTMLElement>(".ic-stage")!; const world = host.querySelector<HTMLElement>(".ic-world")!; const edgeWorld = host.querySelector<SVGGElement>(".ic-edge-world")!;

  function notifySelection() { options.onSelection([...selectedNodes], selectedEdge); }
  function snapshot() { past.push(clone(graph)); if (past.length > 60) past.shift(); future = []; }
  function changed(semantic = true) { render(); options.onChange(clone(graph), semantic); }
  function worldPoint(clientX: number, clientY: number) { const rect = stage.getBoundingClientRect(); return { x: (clientX - rect.left - graph.viewport.x) / graph.viewport.zoom, y: (clientY - rect.top - graph.viewport.y) / graph.viewport.zoom }; }
  function nodeById(id: string) { return graph.nodes.find((node) => node.id === id); }
  function portPoint(node: CanvasNode, targetPort?: string) {
    if (!targetPort) return { x: node.position.x + NODE_WIDTH, y: node.position.y + 62 };
    const ports = options.getInputPorts(node); const index = Math.max(0, ports.findIndex((item) => item.id === targetPort || (targetPort.startsWith("reference:") && item.id === "reference:add")));
    return { x: node.position.x, y: node.position.y + 89 + index * 32 };
  }
  function edgeMarkup(edge: CanvasEdge) {
    const source = nodeById(edge.source); const target = nodeById(edge.target); if (!source || !target) return "";
    const shape = bezier(portPoint(source), portPoint(target, edge.targetPort)); const active = selectedEdge === edge.id;
    return `<g class="ic-edge ${active ? "selected" : ""}" data-edge="${escapeHtml(edge.id)}"><path class="ic-edge-visible" d="${shape.d}"/><path class="ic-edge-hit" d="${shape.d}"/>${active ? `<g class="ic-edge-delete" data-delete-edge="${escapeHtml(edge.id)}" transform="translate(${shape.mid.x} ${shape.mid.y}) scale(${1 / graph.viewport.zoom})"><circle r="12"></circle><path d="M-4-4L4 4M4-4L-4 4"></path></g>` : ""}</g>`;
  }
  function artifactMarkup(node: CanvasNode) {
    const artifact = currentArtifact(options.getArtifacts(), node.id);
    if (!artifact) return `<div class="ic-node-empty"><span>${node.type === "material" ? "上传图片或视频" : node.type === "image" ? "等待图片生成" : "等待视频生成"}</span></div>`;
    const stale = node.data.inputSignature && artifact.inputSignature !== node.data.inputSignature;
    const badge = artifact.state === "generating" || artifact.state === "uploading" ? "生成中" : artifact.state === "failed" ? "失败" : stale ? "已过期" : `v${artifact.version}`;
    const media = artifact.url ? artifact.mediaType === "video" ? `<video src="${escapeHtml(artifact.url)}" muted playsinline></video>` : `<img src="${escapeHtml(artifact.url)}" alt="">` : "";
    return `<div class="ic-node-media ${artifact.state}">${media}<b>${badge}</b>${artifact.errorReason ? `<small>${escapeHtml(artifact.errorReason)}</small>` : ""}</div>`;
  }
  function nodeMarkup(node: CanvasNode) {
    const ports = options.getInputPorts(node); const current = currentArtifact(options.getArtifacts(), node.id);
    const title = node.data.label || (node.type === "material" ? "素材" : node.type === "image" ? "图片生成" : "视频生成");
    const icon = node.type === "material" ? "▣" : node.type === "image" ? "◫" : "▶";
    const inputs = ports.map((port, index) => `<button class="ic-port ic-input ${port.required ? "required" : ""}" style="top:${81 + index * 32}px" data-node="${escapeHtml(node.id)}" data-port="${escapeHtml(port.id)}" title="${escapeHtml(port.label)}"><i></i><span>${escapeHtml(port.label)}</span></button>`).join("");
    const output = node.type !== "video" ? `<button class="ic-port ic-output" data-node="${escapeHtml(node.id)}" title="输出"><span>输出</span><i></i></button>` : "";
    const run = node.type === "image" ? `<button data-node-action="run">生成图片</button>` : node.type === "video" ? `<button data-node-action="run">生成视频</button><button data-node-action="pipeline" title="补跑缺失或过期的上游图片">运行链路</button>` : `<button data-node-action="open">查看素材</button>`;
    return `<article class="ic-node type-${node.type} ${selectedNodes.has(node.id) ? "selected" : ""}" data-node="${escapeHtml(node.id)}" style="left:${node.position.x}px;top:${node.position.y}px;width:${NODE_WIDTH}px;height:${nodeHeight(node, ports)}px"><header><span>${icon}</span><div><strong>${escapeHtml(title)}</strong><small>${node.type === "material" ? escapeHtml(node.data.mediaType || "待上传") : node.type === "image" ? "图片生成节点" : "视频生成节点"}</small></div><em>${current?.state === "generating" ? "运行中" : "⋮"}</em></header>${inputs}${artifactMarkup(node)}<footer>${run}</footer>${output}</article>`;
  }
  function renderMinimap() {
    const svg = host.querySelector<SVGSVGElement>(".ic-minimap svg")!; const miniNodes = svg.querySelector<SVGGElement>("[data-mini-nodes]")!; const miniEdges = svg.querySelector<SVGGElement>("[data-mini-edges]")!; const view = svg.querySelector<SVGRectElement>("[data-mini-view]")!;
    if (!graph.nodes.length) { miniNodes.innerHTML = ""; miniEdges.innerHTML = ""; view.setAttribute("width", "0"); return; }
    const minX = Math.min(...graph.nodes.map((node) => node.position.x)) - 120; const minY = Math.min(...graph.nodes.map((node) => node.position.y)) - 120; const maxX = Math.max(...graph.nodes.map((node) => node.position.x + NODE_WIDTH)) + 120; const maxY = Math.max(...graph.nodes.map((node) => node.position.y + BASE_HEIGHT)) + 120;
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    miniNodes.innerHTML = graph.nodes.map((node) => `<rect x="${node.position.x}" y="${node.position.y}" width="${NODE_WIDTH}" height="${BASE_HEIGHT}" class="${node.type}"/>`).join("");
    miniEdges.innerHTML = graph.edges.map((edge) => { const source = nodeById(edge.source); const target = nodeById(edge.target); if (!source || !target) return ""; return `<path d="${bezier(portPoint(source), portPoint(target, edge.targetPort)).d}"/>`; }).join("");
    const rect = stage.getBoundingClientRect(); view.setAttribute("x", String(-graph.viewport.x / graph.viewport.zoom)); view.setAttribute("y", String(-graph.viewport.y / graph.viewport.zoom)); view.setAttribute("width", String(rect.width / graph.viewport.zoom)); view.setAttribute("height", String(rect.height / graph.viewport.zoom));
  }
  function drawConnectionPreview() {
    if (action?.kind !== "connect" || !action.source) return;
    const source = nodeById(action.source); if (!source) return; const end = worldPoint(action.pointerX || action.startX, action.pointerY || action.startY); const shape = bezier(portPoint(source), end);
    edgeWorld.insertAdjacentHTML("beforeend", `<path class="ic-edge-preview" d="${shape.d}"/>`);
  }
  function render() {
    if (destroyed) return;
    world.style.transform = `translate(${graph.viewport.x}px,${graph.viewport.y}px) scale(${graph.viewport.zoom})`;
    edgeWorld.setAttribute("transform", `translate(${graph.viewport.x} ${graph.viewport.y}) scale(${graph.viewport.zoom})`);
    world.innerHTML = graph.nodes.map(nodeMarkup).join("");
    for (const node of graph.nodes) if (node.data.compatibilityError) { const element = world.querySelector<HTMLElement>(`.ic-node[data-node="${CSS.escape(node.id)}"]`); element?.classList.add("incompatible"); const state = element?.querySelector<HTMLElement>("header em"); if (state) state.textContent = "不可运行"; }
    edgeWorld.innerHTML = graph.edges.map(edgeMarkup).join(""); drawConnectionPreview();
    host.querySelector<HTMLElement>("[data-zoom]")!.textContent = `${Math.round(graph.viewport.zoom * 100)}%`; renderMinimap();
  }
  function setViewport(x: number, y: number, zoom = graph.viewport.zoom, notify = true) { graph.viewport = { x, y, zoom: clamp(zoom, .25, 2) }; render(); if (notify) options.onChange(clone(graph), false); }
  function zoomAt(clientX: number, clientY: number, target: number) { const before = worldPoint(clientX, clientY); const rect = stage.getBoundingClientRect(); const zoom = clamp(target, .25, 2); setViewport(clientX - rect.left - before.x * zoom, clientY - rect.top - before.y * zoom, zoom); }
  function select(ids: string[], edge: string | null = null) { selectedNodes = new Set(ids); selectedEdge = edge; render(); notifySelection(); }
  function removeEdges(ids: Set<string>) { graph.edges = graph.edges.filter((edge) => !ids.has(edge.id)); }
  function removeSelection() {
    if (!selectedNodes.size && !selectedEdge) return; snapshot();
    if (selectedEdge) graph.edges = graph.edges.filter((edge) => edge.id !== selectedEdge);
    if (selectedNodes.size) { graph.nodes = graph.nodes.filter((node) => !selectedNodes.has(node.id)); graph.edges = graph.edges.filter((edge) => !selectedNodes.has(edge.source) && !selectedNodes.has(edge.target)); }
    selectedNodes.clear(); selectedEdge = null; notifySelection(); changed(true);
  }
  function undo() { if (!past.length) return; future.push(clone(graph)); graph = past.pop()!; selectedNodes.clear(); selectedEdge = null; changed(true); notifySelection(); }
  function redo() { if (!future.length) return; past.push(clone(graph)); graph = future.pop()!; selectedNodes.clear(); selectedEdge = null; changed(true); notifySelection(); }
  function addNode(type: CanvasNode["type"], data: Record<string, any> = {}) {
    snapshot(); const rect = stage.getBoundingClientRect(); const center = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const node: CanvasNode = { id: uid(type), type, position: { x: Math.round(center.x - NODE_WIDTH / 2 + graph.nodes.length % 4 * 22), y: Math.round(center.y - 90 + graph.nodes.length % 4 * 22) }, data: { label: type === "material" ? "新素材" : type === "image" ? "图片生成" : "视频生成", prompt: "", runtime: {}, ...data } };
    graph.nodes.push(node); select([node.id]); changed(true); return node;
  }
  function fitView() {
    if (!graph.nodes.length) return setViewport(0, 0, 1);
    const rect = stage.getBoundingClientRect(); const minX = Math.min(...graph.nodes.map((node) => node.position.x)); const minY = Math.min(...graph.nodes.map((node) => node.position.y)); const maxX = Math.max(...graph.nodes.map((node) => node.position.x + NODE_WIDTH)); const maxY = Math.max(...graph.nodes.map((node) => node.position.y + nodeHeight(node, options.getInputPorts(node))));
    const zoom = clamp(Math.min((rect.width - 140) / Math.max(1, maxX - minX), (rect.height - 140) / Math.max(1, maxY - minY)), .25, 1.25); setViewport((rect.width - (minX + maxX) * zoom) / 2, (rect.height - (minY + maxY) * zoom) / 2, zoom);
  }
  function autoLayout() {
    if (!graph.nodes.length) return; snapshot(); const levels = new Map<string, number>(); const visit = (id: string, seen = new Set<string>()): number => { if (seen.has(id)) return 0; seen.add(id); const incoming = graph.edges.filter((edge) => edge.target === id); const level = incoming.length ? Math.max(...incoming.map((edge) => visit(edge.source, new Set(seen)))) + 1 : 0; levels.set(id, level); return level; }; graph.nodes.forEach((node) => visit(node.id));
    const groups = new Map<number, CanvasNode[]>(); graph.nodes.forEach((node) => { const level = levels.get(node.id) || 0; groups.set(level, [...(groups.get(level) || []), node]); }); groups.forEach((nodes, level) => nodes.forEach((node, index) => node.position = { x: level * 380, y: index * 300 })); changed(false); setTimeout(fitView);
  }
  function copySelection() { clipboard = graph.nodes.filter((node) => selectedNodes.has(node.id)).map(clone); if (clipboard.length) options.onMessage(`已复制 ${clipboard.length} 个节点`); }
  function pasteSelection() { if (!clipboard.length) return; snapshot(); const mapping = new Map<string, string>(); const nodes = clipboard.map((node) => { const id = uid(node.type); mapping.set(node.id, id); return { ...clone(node), id, position: { x: node.position.x + 42, y: node.position.y + 42 }, data: { ...clone(node.data), label: `${node.data.label || "节点"} 副本` } }; }); graph.nodes.push(...nodes); select(nodes.map((node) => node.id)); changed(true); clipboard = nodes.map(clone); }
  function stopAutoPan() { cancelAnimationFrame(autoPanFrame); autoPanFrame = 0; }
  function autoPan() {
    stopAutoPan(); if (!action || !["nodes", "connect"].includes(action.kind)) return;
    const rect = stage.getBoundingClientRect(); const margin = 58; let dx = 0; let dy = 0; if (pointer.x < rect.left + margin) dx = 11; else if (pointer.x > rect.right - margin) dx = -11; if (pointer.y < rect.top + margin) dy = 11; else if (pointer.y > rect.bottom - margin) dy = -11;
    if (dx || dy) { graph.viewport.x += dx; graph.viewport.y += dy; if (action.kind === "nodes" && action.positions) for (const id of selectedNodes) { const node = nodeById(id); const start = action.positions.get(id); if (node && start) { start.x -= dx / graph.viewport.zoom; start.y -= dy / graph.viewport.zoom; } } render(); autoPanFrame = requestAnimationFrame(autoPan); }
  }
  function onPointerDown(event: PointerEvent) {
    stage.focus(); pointer = { x: event.clientX, y: event.clientY };
    const target = event.target as HTMLElement; const output = target.closest<HTMLElement>(".ic-output"); const input = target.closest<HTMLElement>(".ic-input"); const nodeElement = target.closest<HTMLElement>(".ic-node"); const edgeElement = target.closest<SVGGElement>(".ic-edge");
    const pendingId = pendingSource || stage.dataset.pendingSource || null;
    if (input && pendingId) { const source = nodeById(pendingId); const targetNode = input.dataset.node ? nodeById(input.dataset.node) : null; if (source && targetNode) { let port = input.dataset.port || "input"; if (port === "reference:add") port = `reference:${graph.edges.filter((edge) => edge.target === targetNode.id).length + 1}`; const issue = options.validateEdge(source, targetNode, port, graph); if (issue) options.onMessage(issue, "error"); else { snapshot(); graph.edges.push({ id: uid("edge"), source: source.id, target: targetNode.id, sourcePort: "media", targetPort: port, order: graph.edges.filter((edge) => edge.target === targetNode.id).length }); changed(true); } } pendingSource = null; delete stage.dataset.pendingSource; stage.classList.remove("connecting"); event.preventDefault(); return; }
    if (target.closest("button") && !output) return;
    if (output) { event.preventDefault(); action = { kind: "connect", startX: event.clientX, startY: event.clientY, source: output.dataset.node, pointerX: event.clientX, pointerY: event.clientY }; render(); return; }
    if (edgeElement) { event.preventDefault(); select([], edgeElement.dataset.edge || null); return; }
    if (nodeElement) {
      const id = nodeElement.dataset.node!; if (!event.shiftKey && !selectedNodes.has(id)) select([id]); else if (event.shiftKey) { const ids = new Set(selectedNodes); ids.has(id) ? ids.delete(id) : ids.add(id); select([...ids]); }
      action = { kind: "nodes", startX: event.clientX, startY: event.clientY, positions: new Map([...selectedNodes].map((nodeId) => { const node = nodeById(nodeId)!; return [nodeId, { ...node.position }]; })) }; snapshot(); autoPan(); return;
    }
    if (event.button === 1 || event.button === 2 || spacePressed) { action = { kind: "pan", startX: event.clientX, startY: event.clientY, viewport: { x: graph.viewport.x, y: graph.viewport.y } }; return; }
    select([]); action = { kind: "box", startX: event.clientX, startY: event.clientY }; box = document.createElement("div"); box.className = "ic-selection-box"; stage.appendChild(box);
  }
  function onPointerMove(event: PointerEvent) {
    pointer = { x: event.clientX, y: event.clientY }; if (!action) return;
    if (action.kind === "pan" && action.viewport) setViewport(action.viewport.x + event.clientX - action.startX, action.viewport.y + event.clientY - action.startY, graph.viewport.zoom, false);
    if (action.kind === "nodes" && action.positions) { const dx = (event.clientX - action.startX) / graph.viewport.zoom; const dy = (event.clientY - action.startY) / graph.viewport.zoom; for (const id of selectedNodes) { const node = nodeById(id); const start = action.positions.get(id); if (node && start) node.position = { x: Math.round(start.x + dx), y: Math.round(start.y + dy) }; } render(); autoPan(); }
    if (action.kind === "connect") { action.pointerX = event.clientX; action.pointerY = event.clientY; render(); autoPan(); }
    if (action.kind === "box" && box) { const rect = stage.getBoundingClientRect(); const x1 = clamp(action.startX - rect.left, 0, rect.width); const y1 = clamp(action.startY - rect.top, 0, rect.height); const x2 = clamp(event.clientX - rect.left, 0, rect.width); const y2 = clamp(event.clientY - rect.top, 0, rect.height); Object.assign(box.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` }); }
  }
  function onPointerUp(event: PointerEvent) {
    stopAutoPan(); if (!action) return; const completed = action;
    if (completed.kind === "connect" && completed.source) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".ic-input"); const source = nodeById(completed.source); const targetNode = target?.dataset.node ? nodeById(target.dataset.node) : null;
      if (source && targetNode && target) { let port = target.dataset.port || "input"; if (port === "reference:add") port = `reference:${graph.edges.filter((edge) => edge.target === targetNode.id).length + 1}`; const issue = options.validateEdge(source, targetNode, port, graph); if (issue) options.onMessage(issue, "error"); else { snapshot(); graph.edges.push({ id: uid("edge"), source: source.id, target: targetNode.id, sourcePort: "media", targetPort: port, order: graph.edges.filter((edge) => edge.target === targetNode.id).length }); changed(true); } }
      else if (source && document.elementFromPoint(event.clientX, event.clientY)?.closest(".ic-output")) { pendingSource = source.id; stage.dataset.pendingSource = source.id; stage.classList.add("connecting"); options.onMessage("已选择输出端口，请点击目标输入端口"); }
    } else if (completed.kind === "box" && box) {
      const selection = box.getBoundingClientRect(); const ids = [...world.querySelectorAll<HTMLElement>(".ic-node")].filter((node) => { const rect = node.getBoundingClientRect(); return rect.right >= selection.left && rect.left <= selection.right && rect.bottom >= selection.top && rect.top <= selection.bottom; }).map((node) => node.dataset.node!); select(ids); box.remove(); box = null;
    } else if (completed.kind === "nodes") options.onChange(clone(graph), false); else if (completed.kind === "pan") options.onChange(clone(graph), false);
    action = null; render();
  }
  function onClick(event: MouseEvent) {
    const target = event.target as HTMLElement; const deleteEdge = target.closest<SVGGElement>("[data-delete-edge]"); if (deleteEdge) { event.stopPropagation(); snapshot(); removeEdges(new Set([deleteEdge.dataset.deleteEdge!])); selectedEdge = null; changed(true); notifySelection(); return; }
    const output = target.closest<HTMLElement>(".ic-output"); if (output) { pendingSource = output.dataset.node || null; if (pendingSource) stage.dataset.pendingSource = pendingSource; stage.classList.add("connecting"); options.onMessage("已选择输出端口，请点击目标输入端口"); return; }
    const input = target.closest<HTMLElement>(".ic-input"); const pendingId = pendingSource || stage.dataset.pendingSource || null; if (input && pendingId) { const source = nodeById(pendingId); const targetNode = input.dataset.node ? nodeById(input.dataset.node) : null; if (source && targetNode) { let port = input.dataset.port || "input"; if (port === "reference:add") port = `reference:${graph.edges.filter((edge) => edge.target === targetNode.id).length + 1}`; const issue = options.validateEdge(source, targetNode, port, graph); if (issue) options.onMessage(issue, "error"); else { snapshot(); graph.edges.push({ id: uid("edge"), source: source.id, target: targetNode.id, sourcePort: "media", targetPort: port, order: graph.edges.filter((edge) => edge.target === targetNode.id).length }); changed(true); } } pendingSource = null; delete stage.dataset.pendingSource; stage.classList.remove("connecting"); return; }
    const button = target.closest<HTMLButtonElement>("[data-node-action]"); if (button) { const node = button.closest<HTMLElement>("[data-node]"); if (!node) return; const actionName = button.dataset.nodeAction; if (actionName === "run") options.onRun(node.dataset.node!, false); else if (actionName === "pipeline") options.onRun(node.dataset.node!, true); else options.onOpenNode(node.dataset.node!); }
    const tool = target.closest<HTMLButtonElement>("[data-tool]")?.dataset.tool; if (!tool) return; if (tool === "undo") undo(); if (tool === "redo") redo(); if (tool === "fit") fitView(); if (tool === "layout") autoLayout(); if (tool === "zoom-in" || tool === "zoom-out") { const rect = stage.getBoundingClientRect(); zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, graph.viewport.zoom * (tool === "zoom-in" ? 1.15 : .85)); } const step: Record<string, [number, number]> = { left: [80, 0], right: [-80, 0], up: [0, 80], down: [0, -80] }; if (step[tool]) setViewport(graph.viewport.x + step[tool][0], graph.viewport.y + step[tool][1]);
  }
  function onWheel(event: WheelEvent) { event.preventDefault(); if (event.ctrlKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) zoomAt(event.clientX, event.clientY, graph.viewport.zoom * Math.exp(-event.deltaY * .0012)); else setViewport(graph.viewport.x - event.deltaX, graph.viewport.y - event.deltaY); }
  function onKeyDown(event: KeyboardEvent) {
    if ((event.target as HTMLElement).matches("input,textarea,select,[contenteditable=true]")) return;
    if (event.code === "Space") { spacePressed = true; event.preventDefault(); }
    const meta = event.ctrlKey || event.metaKey; if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); } if (meta && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); } if (meta && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); } if (meta && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); } if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); removeSelection(); } if (event.key === "0") fitView();
  }
  function onKeyUp(event: KeyboardEvent) { if (event.code === "Space") spacePressed = false; }
  stage.addEventListener("pointerdown", onPointerDown); window.addEventListener("pointermove", onPointerMove); window.addEventListener("pointerup", onPointerUp); stage.addEventListener("click", onClick); stage.addEventListener("wheel", onWheel, { passive: false }); stage.addEventListener("contextmenu", (event) => event.preventDefault()); window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp);
  render();
  return {
    destroy() { destroyed = true; stopAutoPan(); window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); host.innerHTML = ""; },
    addNode, updateGraph(next) { graph = clone(next); render(); }, select(ids) { select(ids); }, fitView, autoLayout, undo, redo, removeSelection,
  };
}
