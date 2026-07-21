export type NodeType = "material" | "image" | "video";
export type MediaType = "image" | "video";

export interface CanvasNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, any> & {
    label?: string;
    prompt?: string;
    mediaType?: MediaType;
    modelOverride?: string | null;
    qualityOverride?: string | null;
    ratioOverride?: string | null;
    modeOverride?: string | string[] | null;
    resolutionOverride?: string | null;
    durationOverride?: number | null;
    audioOverride?: boolean | null;
    runtime?: { trackId?: number };
  };
}

export interface CanvasEdge { id: string; source: string; target: string; sourcePort: string; targetPort: string; order: number; }
export interface CanvasGraph { version: 1; nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: { x: number; y: number; zoom: number }; }
export interface CanvasSettings { defaultVideoResolution: string; defaultVideoDuration: number; defaultVideoAudio: boolean; }

export interface CanvasArtifact {
  id: number; projectId: number; nodeId: string; origin: "upload" | "generated"; mediaType: MediaType;
  fileName?: string; filePath?: string; videoId?: number | null; version: number; isCurrent: number; detached: number;
  state: "uploading" | "generating" | "success" | "failed"; prompt?: string; model?: string;
  params?: Record<string, any>; inputSignature?: string; inputArtifactIds?: number[]; errorReason?: string; url?: string;
  createTime?: number; updateTime?: number;
}

export interface CanvasProject {
  id: number; name: string; intro?: string; projectType: "canvas"; imageModel: string; videoModel: string;
  imageQuality?: string; videoRatio?: string; mode?: string | string[]; createTime?: number; updateTime?: number;
  thumbnailUrl?: string;
  settings?: CanvasSettings;
}

export interface CanvasWorkspace {
  project: CanvasProject; settings: CanvasSettings; graph: CanvasGraph; revision: number; scriptId: number; artifacts: CanvasArtifact[];
}

export interface ModelOption { id: string | number; label: string; value: string; type: "image" | "video"; name?: string; }
export interface ModelDetail {
  name?: string; modelName?: string; type?: string; mode?: string | string[]; modes?: string | string[];
  resolution?: string | string[]; resolutions?: string[]; duration?: number | number[]; durations?: number[];
  durationResolutionMap?: Record<string, string[] | number[]>; audio?: boolean; supportAudio?: boolean; maxReferenceImages?: number;
  [key: string]: unknown;
}

export interface InputPort { id: string; label: string; kind: "image" | "video"; required?: boolean; }

