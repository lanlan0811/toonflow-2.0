/**
 * Toonflow AI供应商模板 - MyDamoxing
 * @version 1.0
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "mydamoxing",
  version: "1.0",
  author: "Toonflow",
  name: "MyDamoxing",
  description: "MyDamoxing API - 视频模型 Seedance 2.0、图片模型 GPT Image\n[前往平台](https://mydamoxing.cn/)",
  inputs: [
    { key: "apiKey", label: "API Key", type: "password", required: true },
    { key: "baseUrl", label: "Base URL", type: "url", required: true, placeholder: "https://mydamoxing.cn/v1" },
  ],
  inputValues: { apiKey: "", baseUrl: "https://mydamoxing.cn/v1" },
  models: [
    // ==================== 图片模型 ====================
    {
      name: "GPT Image 2 Pro",
      modelName: "gpt-image-2-pro",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
    },
    // ==================== 视频模型 ====================
    {
      name: "Seedance 2.0 720P",
      modelName: "doubao-seedance-2.0-720p",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired"],
      audio: "optional",
      durationResolutionMap: [
        { duration: [4, 6, 8, 10, 12], resolution: ["1088x1920", "1920x1088"] },
      ],
    },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

function getBaseUrl() {
  return vendor.inputValues.baseUrl || "https://mydamoxing.cn/v1";
}

function getHeaders() {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  return {
    Authorization: `Bearer ${vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

function aspectRatioToSize(aspectRatio: `${number}:${number}`, baseSize: "1K" | "2K" | "4K"): { width: number; height: number } {
  const [w, h] = aspectRatio.split(":").map(Number);
  let baseWidth = 1024;
  if (baseSize === "2K") baseWidth = 1536;
  if (baseSize === "4K") baseWidth = 2048;
  return { width: baseWidth, height: Math.round(baseWidth * (h / w)) };
}

/**
 * 提取带 data: 头的 base64 字符串
 */
function extractBase64WithHead(ref: ReferenceList): string {
  if (!ref || !ref.base64) return "";
  return ref.base64.startsWith("data:") ? ref.base64 : `data:image/png;base64,${ref.base64}`;
}

/**
 * 提取纯 base64（去掉 data: 前缀）
 */
function extractPureBase64(ref: ReferenceList): string {
  if (!ref || !ref.base64) return "";
  return ref.base64.replace(/^data:image\/\w+;base64,/, "");
}

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return createOpenAI({ baseURL: getBaseUrl(), apiKey }).chat(model.modelName);
};

// ============================================================
// 图片生成
// POST /v1/images/generations
// 请求体: { model, prompt, size, image?: string[] }
// ============================================================

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  logger("开始生成图片...");
  const { prompt, referenceList, size, aspectRatio } = config;
  const { width, height } = aspectRatioToSize(aspectRatio, size);
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // 收集图生图参考
  const imageRefs = (referenceList || []).filter((r) => r && r.base64);
  const hasImageRefs = imageRefs.length > 0;

  // 处理空 prompt
  const effectivePrompt = (prompt || "").trim();
  const finalPrompt = effectivePrompt || (hasImageRefs ? "Transform this image" : "");
  if (!finalPrompt) {
    throw new Error("缺少提示词（prompt），请先生成或输入提示词");
  }

  const requestBody: any = {
    model: model.modelName,
    prompt: finalPrompt,
    size: `${width}x${height}`,
  };

  // 图生图：image 字段为 string 数组
  if (hasImageRefs) {
    requestBody.image = imageRefs.map((r) => extractBase64WithHead(r));
  }

  logger("发送图片生成请求...");
  const response = await axios.post(`${baseUrl}/images/generations`, requestBody, { headers });

  // 检查 API 错误响应
  if (response.data?.error) {
    throw new Error(`API 错误: ${JSON.stringify(response.data.error)}`);
  }

  // 处理返回结果 - 兼容 b64_json 和 url
  const result = response.data?.data?.[0];
  if (!result) throw new Error("未收到有效的图片数据");

  if (result.b64_json) {
    logger("图片生成成功，返回 base64 数据...");
    return result.b64_json.startsWith("data:") ? result.b64_json : `data:image/png;base64,${result.b64_json}`;
  }

  if (result.url) {
    logger("图片生成成功，URL 转 base64...");
    return await urlToBase64(result.url);
  }

  throw new Error("未收到有效的图片数据");
};

// ============================================================
// 视频生成
// POST /v1/video/generations  创建视频任务
// GET  /v1/video/generations/{task_id}  查询任务
// 
// 请求体:
//   model: string
//   prompt: string
//   size: string (e.g. "1920x1088")
//   referenceImages?: string    (base64)
//   referenceVideos?: string    (base64)
//   referenceAudios?: string    (base64)
//   first_image?: string        (首帧, base64)
//   last_image?: string         (尾帧, base64)
// ============================================================

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  logger("开始生成视频...");
  const { prompt, duration, aspectRatio, referenceList, audio, mode } = config;
  const baseUrl = getBaseUrl();
  const headers = getHeaders();

  // 分辨率：基于 720p 模型
  let width = 1920;
  let height = 1088;
  if (aspectRatio === "9:16") {
    width = 1088;
    height = 1920;
  }

  // 分类参考素材
  const imageRefs = (referenceList || []).filter((r) => r && r.type === "image" && r.base64);
  const videoRefs = (referenceList || []).filter((r) => r && r.type === "video" && r.base64);
  const audioRefs = (referenceList || []).filter((r) => r && r.type === "audio" && r.base64);

  const hasImageRefs = imageRefs.length > 0;
  const hasVideoRefs = videoRefs.length > 0;
  const hasAudioRefs = audioRefs.length > 0;

  // 判断模式：首尾帧模式 or 参考素材模式 or 文生视频
  const isStartEndMode = mode.includes("startEndRequired");

  // 处理空 prompt
  const effectivePrompt = (prompt || "").trim();
  const hasAnyRef = hasImageRefs || hasVideoRefs || isStartEndMode;
  const finalPrompt = effectivePrompt || (hasAnyRef ? "Generate a video" : "");
  if (!finalPrompt) {
    throw new Error("缺少提示词（prompt），请先生成或输入提示词");
  }

  const requestBody: any = {
    model: model.modelName,
    prompt: finalPrompt,
    size: `${width}x${height}`,
  };

  // 首尾帧模式：使用 first_image / last_image
  if (isStartEndMode && hasImageRefs) {
    if (imageRefs.length >= 2) {
      requestBody.first_image = extractPureBase64(imageRefs[0]);
      requestBody.last_image = extractPureBase64(imageRefs[1]);
    } else if (imageRefs.length === 1) {
      requestBody.first_image = extractPureBase64(imageRefs[0]);
    }
  }

  // 参考素材模式
  if (!isStartEndMode && hasImageRefs) {
    requestBody.referenceImages = extractPureBase64(imageRefs[0]);
  }
  if (hasVideoRefs) {
    requestBody.referenceVideos = extractPureBase64(videoRefs[0]);
  }
  if (hasAudioRefs || audio) {
    if (hasAudioRefs) {
      requestBody.referenceAudios = extractPureBase64(audioRefs[0]);
    }
  }

  logger("提交视频生成任务...");
  const createResponse = await axios.post(`${baseUrl}/v1/video/generations`, requestBody, { headers });
  const taskId = createResponse.data.task_id;
  if (!taskId) {
    throw new Error(`创建任务失败: ${JSON.stringify(createResponse.data)}`);
  }
  logger(`任务已创建，任务 ID: ${taskId}`);

  // 轮询任务状态
  const pollResult = await pollTask(async () => {
    logger("轮询任务状态...");
    const statusResponse = await axios.get(`${baseUrl}/v1/video/generations/${taskId}`, { headers });
    const status = statusResponse.data.status;

    if (status === "completed" || status === "succeeded") {
      const videoUrl = statusResponse.data.video_url || statusResponse.data.url;
      return { completed: true, data: videoUrl };
    } else if (status === "failed" || status === "error") {
      return { completed: true, error: `视频生成失败: ${JSON.stringify(statusResponse.data)}` };
    }
    return { completed: false };
  }, 5000, 600000);

  if (pollResult.error) throw new Error(pollResult.error);

  logger("视频生成成功，转换为 base64...");
  return await urlToBase64(pollResult.data!);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "1.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};
