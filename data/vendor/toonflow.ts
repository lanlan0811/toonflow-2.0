/**
 * Toonflow官方中转平台 供应商适配
 * @version 3.0
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
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
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
  id: "toonflow",
  version: "3.2",
  author: "Toonflow",
  name: "Toonflow官方中转平台",
  description:
    "## Toonflow官方中转平台\n\nToonflow官方中转平台，提供**文本、图像、视频、音频**等多模态生成能力的中转服务，支持接入多个大模型供应商，方便用户统一管理和调用不同供应商的生成能力。\n\n🔗 [前往中转平台](https://api.toonflow.net/)\n\n如果这个项目对你有帮助，可以考虑支持一下我们的开发工作 ☕",
  icon: "",
  inputs: [{ key: "apiKey", label: "API密钥", type: "password", required: true }],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.toonflow.net/v1",
  },
  models: [
    {
      name: "Seedance-2.0 (支持真人)",
      modelName: "Seedance 2.0",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      name: "Seedance 2.0 fast (支持真人)",
      modelName: "Seedance 2.0 fast",
      type: "video",
      mode: ["text", "startFrameOptional", ["imageReference:9", "videoReference:3", "audioReference:3"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p"] }],
    },
    {
      name: "Wan2.6",
      type: "video",
      modelName: "wan2.6",
      mode: ["singleImage"],
      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720p", "1080p"] }],
      audio: true,
    },
    {
      name: "Seedance 1.5 Pro",
      type: "video",
      modelName: "doubao-seedance-1-5-pro",
      mode: ["text", "endFrameOptional"],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
      audio: true,
    },
    {
      name: "ViduQ3 pro",
      type: "video",
      modelName: "ViduQ3-pro",
      mode: ["singleImage", "startEndRequired"],
      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolution: ["540p", "720p", "1080p"] }],
      audio: false,
    },
    {
      name: "Kling-Video-O1",
      modelName: "Kling-Video-O1",
      type: "video",
      mode: ["startFrameOptional", ["imageReference:7", "videoReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [5, 10, 15], resolution: ["720p", "1080p"] }],
    },
    {
      name: "Kling-V3-Omni",
      modelName: "Kling-V3-Omni",
      type: "video",
      mode: ["startFrameOptional", ["imageReference:7", "videoReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [5, 10, 15], resolution: ["720p", "1080p"] }],
    },
    {
      name: "Doubao Seedream 5.0 Lite",
      type: "image",
      modelName: "doubao-seedream-5.0-Lite",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "Doubao Seedream 4.5",
      type: "image",
      modelName: "doubao-seedream-4-5",
      mode: ["text", "singleImage", "multiReference"],
    },
    {
      name: "全能图片G-2.0",
      type: "image",
      modelName: "全能图片G-2.0",
      mode: ["text", "singleImage", "multiReference"],
    },
    // { name: "DeepSeek v4 pro", modelName: "deepseek-v4-pro", type: "text", think: false },
  ],
};

// ============================================================
// 辅助工具
// ============================================================

// 从 markdown 内容中提取第一张图片
function extractFirstImageFromMd(content: string) {
  const regex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+|\/\/[^\s)]+|[^\s)]+)\)/;
  const match = content.match(regex);
  if (!match) return null;
  const raw = match[2].trim();
  const url = raw.startsWith("data:") ? raw : raw.split(/\s+/)[0];
  return { alt: match[1], url, type: url.startsWith("data:image") ? "base64" : "url" };
}

// ============================================================
// 适配器函数
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const lowerName = model.modelName.toLowerCase();
  if (lowerName.includes("deepseek")) {
    logger("使用deepseek");
    // DeepSeek 思考强度仅支持 high / max（low、medium 会被映射为 high，xhigh 会被映射为 max）
    // thinkLevel: 0/1/2 → high, 3 → max
    const effortMap: Record<0 | 1 | 2 | 3, "high" | "max"> = {
      0: "high",
      1: "high",
      2: "high",
      3: "max",
    };

    const enableThinking = model.think && think;
    const extraBody: Record<string, any> = {
      thinking: { type: enableThinking ? "enabled" : "disabled" },
    };
    if (enableThinking) {
      extraBody.reasoning_effort = effortMap[thinkLevel];
    }

    return createDeepSeek({
      baseURL: vendor.inputValues.baseUrl,
      apiKey,
      extraBody,
    }).chat(model.modelName);
  }
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const lowerName = model.modelName.toLowerCase();
  const imageBase64List = (config.referenceList ?? []).map((r) => r.base64).filter(Boolean);

  // Gemini / nano 系模型：走 chat/completions 接口，从返回的 markdown 中提取图片
  if (lowerName.includes("gemini") || lowerName.includes("nano")) {
    const imageConfigGoogle: Record<string, string> = {
      aspect_ratio: config.aspectRatio,
      image_size: config.size,
    };
    const messages: any[] = [];
    if (imageBase64List.length) {
      messages.push({
        role: "user",
        content: imageBase64List.map((b) => ({ type: "image_url", image_url: { url: b } })),
      });
    }
    messages.push({ role: "user", content: config.prompt + "请直接输出图片" });
    const body = {
      model: model.modelName,
      messages,
      extra_body: { google: { image_config: imageConfigGoogle } },
    };
    logger(`[imageRequest] 使用 gemini 适配器，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const imageResult = extractFirstImageFromMd(data.choices[0].message.content);
    if (!imageResult) throw new Error("未能从响应中提取图片");
    if (imageResult.type === "base64") return imageResult.url;
    return await urlToBase64(imageResult.url);
  }

  // 豆包 / seedream 系模型：走 images/generations 接口
  if (lowerName.includes("doubao") || lowerName.includes("seedream")) {
    const effectiveSize = config.size === "1K" ? "2K" : config.size;
    const sizeMap: Record<string, Record<string, string>> = {
      "16:9": { "2K": "2848x1600", "4K": "4096x2304" },
      "9:16": { "2K": "1600x2848", "4K": "2304x4096" },
    };
    const resolvedSize = sizeMap[config.aspectRatio]?.[effectiveSize];
    const body: Record<string, any> = {
      model: model.modelName,
      prompt: config.prompt,
      size: resolvedSize,
      metadata: {
        response_format: "url",
        sequential_image_generation: "disabled",
        stream: false,
        watermark: false,
      },
      ...(imageBase64List.length && { images: imageBase64List }),
    };
    logger(`[imageRequest] 使用 doubao 适配器，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/image/generateImage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const taskId = data.data;
    logger(`[imageRequest] 任务ID: ${taskId}`);
    const res = await pollTask(async () => {
      const queryResponse = await fetch(`${baseUrl}/image/getImageStatus`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          taskICode: taskId,
        }),
      });
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      }
      const queryData = await queryResponse.json();
      logger(queryData);
      const status = queryData?.status ?? queryData?.data?.status;
      logger(status);
      switch (status) {
        case "success":
          return { completed: true, data: queryData.data.data };
        case "failed":
          return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
        default:
          return { completed: false };
      }
    });
    return res.data!;
  }
  if (lowerName.includes("gpt") || lowerName.includes("全能图片")) {
    const normalizedSize = config.size === "1K" ? "1k" : config.size === "2K" ? "2k" : config.size === "4K" ? "4k" : config.size;
    const body: Record<string, any> = {
      model: model.modelName,
      prompt: config.prompt,
      size: normalizedSize,
      ...(imageBase64List.length && { images: imageBase64List }),
      metadata: {
        aspectRatio: config.aspectRatio,
      },
    };
    logger(`[imageRequest] 使用 doubao 适配器，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/image/generateImage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const taskId = data.data;
    logger(`[imageRequest] 任务ID: ${taskId}`);
    const res = await pollTask(async () => {
      const queryResponse = await fetch(`${baseUrl}/image/getImageStatus`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          taskICode: taskId,
        }),
      });
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      }
      const queryData = await queryResponse.json();
      logger(queryData);
      const status = queryData?.status ?? queryData?.data?.status;
      logger(status);
      switch (status) {
        case "success":
          return { completed: true, data: queryData.data.data };
        case "failed":
          return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
        default:
          return { completed: false };
      }
    });
    return res.data!;
  }

  throw new Error(`不支持的图像模型: ${model.modelName}`);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const lowerName = model.modelName.toLowerCase();

  // 当前激活的单一 VideoMode（取第一个非数组模式，或数组模式）
  const activeMode = config.mode as string | string[];
  const imageRefs = (config.referenceList ?? []).filter((r) => r.type === "image").map((r) => r.base64);
  const videoRefs = (config.referenceList ?? []).filter((r) => r.type === "video").map((r) => r.base64);
  const audioRefs = (config.referenceList ?? []).filter((r) => r.type === "audio").map((r) => r.base64);
  if (imageRefs && imageRefs.length) {
    for (const item of imageRefs) {
      await zipImage(item, 3 * 1024 * 104);
    }
  }
  // 构建模型专属 metadata
  let metadata: Record<string, any> = {};

  if (lowerName.includes("wan")) {
    // 万象系列
    if ((activeMode === "startEndRequired" || activeMode === "endFrameOptional" || activeMode === "startFrameOptional") && imageRefs.length >= 2) {
      if (imageRefs[0]) metadata.first_frame_url = imageRefs[0];
      if (imageRefs[1]) metadata.last_frame_url = imageRefs[1];
    } else if (imageRefs.length) {
      metadata.img_url = imageRefs[0];
    }
    if (typeof config.audio === "boolean") metadata.audio = config.audio;

    const body: Record<string, any> = {
      model: model.modelName,
      prompt: config.prompt,
      duration: config.duration,
      resolution: config.resolution,
      images: imageRefs,
      metadata,
    };
    logger(`[videoRequest] 提交万象视频任务，模型: ${model.modelName}`);
    const response = await fetch(`${baseUrl}/video/generateVideo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
    }
    const data = await response.json();
    const taskId = data.data;
    logger(`[videoRequest] 万象任务ID: ${taskId}`);
    const res = await pollTask(async () => {
      const queryResponse = await fetch(`${baseUrl}/video/getVideoStatus`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          taskICode: taskId,
        }),
      });
      if (!queryResponse.ok) {
        const errorText = await queryResponse.text();
        throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
      }
      const queryData = await queryResponse.json();
      logger(queryData);
      const status = queryData?.status ?? queryData?.data?.status;
      logger(status);
      switch (status) {
        case "completed":
        case "SUCCESS":
        case "success":
          return { completed: true, data: queryData.data.data };
        case "FAILURE":
        case "failed":
          return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
        default:
          return { completed: false };
      }
    });
    if (res.error) throw new Error(res.error);
    return res.data!;
  }

  if (lowerName.includes("doubao") || lowerName.includes("seedance")) {
    // 豆包/Seedance 系列
    metadata = {
      ...(typeof config.audio === "boolean" && { generate_audio: config.audio }),
      ratio: config.aspectRatio,
      references: [],
      resolution: config.resolution,
    };
    if (Array.isArray(activeMode)) {
      // 多参考模式
      imageRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_image",
          type: "image_url",
          image_url: {
            url: item,
          },
        });
      });
      videoRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_video",
          type: "video_url",
          video_url: {
            url: item,
          },
        });
      });
      audioRefs.forEach((item) => {
        metadata.references.push({
          role: "reference_audio",
          type: "audio_url",
          audio_url: {
            url: item,
          },
        });
      });
    } else if (activeMode === "startEndRequired" || activeMode === "endFrameOptional" || activeMode === "startFrameOptional") {
      imageRefs.forEach((item, i) => {
        metadata.references.push({
          type: "image_url",
          image_url: {
            url: item,
          },
          role: i == 0 ? "first_frame" : "last_frame",
        });
      });
    } else if (activeMode === "singleImage") {
      imageRefs.forEach((item, i) => {
        metadata.references.push({
          role: "reference_image",
          type: "image_url",
          image_url: {
            url: item,
          },
        });
      });
    }
  } else if (lowerName.includes("vidu")) {
    // Vidu 系列
    metadata = {
      aspect_ratio: config.aspectRatio,
      audio: config.audio ?? false,
      off_peak: false,
    };
  } else if (lowerName.includes("kling")) {
    const videoRefs = (config.referenceList ?? []).filter((r) => r.type === "video").map((r) => ({ video_url: r.base64 }));

    metadata = {
      aspect_ratio: config.aspectRatio,
      sound: typeof config?.audio == "boolean" ? (config?.audio ? "on" : "off") : "off",
      video_list: videoRefs,
      image_list: [],
    };

    // 图片有效性检查函数
    const isValidImage = (imageUrl: any) => {
      return imageUrl && typeof imageUrl === "string" && imageUrl.trim().length > 0;
    };

    if (activeMode === "singleImage") {
      if (lowerName.includes("omni") || lowerName.includes("o1")) {
        // 只在图片有效时才添加
        if (isValidImage(imageRefs[0])) {
          metadata.image_list = [{ image_url: imageRefs[0] }];
        }
      } else {
        if (isValidImage(imageRefs[0])) {
          metadata.image = imageRefs[0];
        }
      }
    } else if (activeMode === "startEndRequired" || activeMode === "endFrameOptional" || activeMode === "startFrameOptional") {
      if (lowerName.includes("omni") || lowerName.includes("o1")) {
        imageRefs.forEach((item, index) => {
          if (isValidImage(item)) {
            if (!metadata.image_list || !Array.isArray(metadata.image_list)) metadata.image_list = [];
            metadata.image_list.push({
              image_url: item,
              type: index == 0 ? "first_frame" : "end_frame",
            });
          }
        });
      } else {
        if (isValidImage(imageRefs[0])) {
          metadata.image_tail = imageRefs[0];
        }
      }
    } else if (Array.isArray(activeMode)) {
      imageRefs.forEach((item) => {
        if (isValidImage(item)) {
          if (!metadata.image_list || !Array.isArray(metadata.image_list)) metadata.image_list = [];
          metadata.image_list.push({
            image_url: item,
          });
        }
      });
    }
  } else if (lowerName.includes("grok")) {
    metadata = {
      aspectRatio: config.aspectRatio,
    };
  }

  // 公共请求体（非万象通用路径）
  const publicBody: Record<string, any> = {
    model: model.modelName,
    ...(imageRefs.length && lowerName.includes("vidu") ? { images: imageRefs } : {}),
    prompt: config.prompt,
    duration: config.duration,
    resolution: config.resolution,
    metadata,
  };

  logger(`[videoRequest] 提交视频任务，模型: ${model.modelName}`);
  const response = await fetch(`${baseUrl}/video/generateVideo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(publicBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }
  const data = await response.json();
  const taskId = data.data;
  logger(`[videoRequest] 任务ID: ${taskId}`);

  const res = await pollTask(async () => {
    const queryResponse = await fetch(`${baseUrl}/video/getVideoStatus`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        taskICode: taskId,
      }),
    });
    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      throw new Error(`轮询失败，状态码: ${queryResponse.status}, 错误信息: ${errorText}`);
    }
    const queryData = await queryResponse.json();
    logger(queryData);
    const status = queryData?.status ?? queryData?.data?.status;
    switch (status) {
      case "completed":
      case "SUCCESS":
      case "success":
        return { completed: true, data: queryData.data.data };
      case "FAILURE":
      case "failed":
        return { completed: true, error: queryData?.data?.failReason ?? "视频生成失败" };
      default:
        return { completed: false };
    }
  });

  if (res.error) throw new Error(res.error);
  return await urlToBase64(res.data!);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const res = await fetch(`${baseUrl}/vendor/vendorCheck`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      version: vendor.version,
    }),
  });
  if (!res.ok) {
    const errorReason = await res.text();
    throw new Error(`检查更新失败，${errorReason}`);
  }
  const { data } = await res.json();
  if (data?.hasUpdate && data?.latestVersion) {
    return {
      hasUpdate: data?.hasUpdate ?? false,
      latestVersion: data?.latestVersion ?? null,
      notice: data?.notice ? data?.notice : "作者有点懒，没有填写更新内容",
    };
  }
  return { hasUpdate: false, latestVersion: "", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const response = await fetch(`${baseUrl}/vendor/downloadVendor`, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const errorReason = await response.text();
    throw new Error(`请求失败: ${response.status} ${errorReason}`);
  }
  const { data } = await response.json();
  logger(data);
  return data;
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
