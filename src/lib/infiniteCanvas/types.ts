export const INFINITE_CANVAS_GRAPH_VERSION = 1;

export type InfiniteCanvasNodeType = "material" | "image" | "video";
export type InfiniteCanvasMediaType = "image" | "video";
export type InfiniteCanvasArtifactOrigin = "upload" | "generated";
export type InfiniteCanvasArtifactState = "uploading" | "generating" | "success" | "failed";

export interface InfiniteCanvasNode {
  id: string;
  type: InfiniteCanvasNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown> & {
    label?: string;
    prompt?: string;
    mediaType?: InfiniteCanvasMediaType;
    modelOverride?: string | null;
    qualityOverride?: string | null;
    ratioOverride?: string | null;
    modeOverride?: string | string[] | null;
    resolutionOverride?: string | null;
    durationOverride?: number | null;
    audioOverride?: boolean | null;
    runtime?: Record<string, unknown>;
  };
}

export interface InfiniteCanvasEdge {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
  order: number;
}

export interface InfiniteCanvasGraph {
  version: 1;
  nodes: InfiniteCanvasNode[];
  edges: InfiniteCanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export interface InfiniteCanvasSettings {
  defaultVideoResolution: string;
  defaultVideoDuration: number;
  defaultVideoAudio: boolean;
}

export const DEFAULT_INFINITE_CANVAS_SETTINGS: InfiniteCanvasSettings = {
  defaultVideoResolution: "720p",
  defaultVideoDuration: 5,
  defaultVideoAudio: false,
};

export function emptyInfiniteCanvasGraph(): InfiniteCanvasGraph {
  return { version: INFINITE_CANVAS_GRAPH_VERSION, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

export function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
