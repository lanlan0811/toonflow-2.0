# 二次开发流程接口说明

本文档记录本仓库 AI 短剧生产流程与独立“无限画布”工作区的接口，供前端源码仓库和二次开发服务接入。无限画布复用现有图片、视频生成能力，不新增或修改 Vendor、模型适配器及模型配置。

除特别说明外，接口均使用 `POST` 和 JSON 请求体。新增的 `/api/infiniteCanvas` 接口及本文列出的主要生产接口返回统一结构：

```json
{
  "code": 200,
  "data": {},
  "message": "成功"
}
```

画布专用接口业务失败时 `code` 与 HTTP 状态码一致，错误原因位于 `message`；部分历史接口仍可能保留原有错误结构。需要登录的接口沿用应用现有鉴权方式，在请求头传入登录接口返回的 `Authorization: Bearer <token>`。

## 项目类型

新建 AI 短剧项目接口仍使用：

```txt
POST /api/project/addProject
```

仓库中的 `projectType` 支持以下规范值：

| 值 | 含义 |
| --- | --- |
| `novel` | 基于小说原文 |
| `script` | 基于剧本 |
| `storyboard` | 基于分镜表 |
| `commerce` | 商品视觉工厂 |
| `canvas` | 无限画布 |

后端同时兼容中文别名，例如 `基于小说原文`、`基于剧本`、`基于分镜表`、`商品视觉工厂` 和 `无限画布`，入库时会规范化为上表中的英文值。

`commerce` 和 `canvas` 都有各自的专用创建流程。`canvas` 项目必须通过 `/api/infiniteCanvas/projects/create` 创建，不能用 `/api/project/addProject` 代替，否则不会创建工作区、内部剧本和修订信息。普通项目列表默认过滤 `canvas` 项目，画布项目统一从 `/api/infiniteCanvas/projects/list` 获取。

## 分镜表解析

```txt
POST /api/storyboardImport/parse
```

用于把 JSON/CSV/TSV/纯文本解析成标准分镜数组，仅预览，不写库。

### 请求体

```json
{
  "content": "分镜表文本内容",
  "format": "auto"
}
```

也可以传 base64：

```json
{
  "base64": "data:text/csv;base64,...",
  "format": "csv"
}
```

`format` 可选：`auto`、`json`、`csv`、`text`。

### 支持表头

| 标准字段 | 支持别名 |
| --- | --- |
| `prompt` | `分镜图提示词`、`图片提示词`、`镜头提示词`、`画面描述`、`镜头描述` |
| `duration` | `时长`、`秒数`、`推荐时长`、`视频时长` |
| `track` | `分组`、`轨道`、`场次`、`场景分组`、`视频分组` |
| `videoDesc` | `视频描述`、`视频画面描述`、`分镜描述`、`内容`、`画面内容` |
| `shouldGenerateImage` | `是否生成分镜图`、`生成分镜图`、`需要生成图片`、`生成图片` |
| `roleNames` | `角色`、`人物` |
| `sceneNames` | `场景`、`地点` |
| `toolNames` | `道具`、`物品` |

### 返回体

```json
{
  "code": 200,
  "data": {
    "data": [
      {
        "prompt": "分镜图提示词",
        "duration": 3,
        "track": "默认分组",
        "state": "未生成",
        "src": null,
        "videoDesc": "视频描述",
        "shouldGenerateImage": 1,
        "associateAssetsIds": [],
        "roleNames": ["角色名"],
        "sceneNames": ["场景名"],
        "toolNames": ["道具名"]
      }
    ],
    "total": 1,
    "warnings": []
  },
  "message": "成功"
}
```

## 分镜表提交

```txt
POST /api/storyboardImport/commit
```

用于把解析后的分镜数据写入数据库。

### 请求体

```json
{
  "projectId": 1001,
  "scriptId": 2001,
  "data": [
    {
      "prompt": "分镜图提示词",
      "duration": 3,
      "track": "第1场",
      "videoDesc": "视频描述",
      "shouldGenerateImage": 1,
      "associateAssetsIds": [],
      "roleNames": ["男主"],
      "sceneNames": ["街道"],
      "toolNames": ["红色跑车"]
    }
  ]
}
```

`scriptId` 可选。若不传，后端会自动创建一个名为 `分镜表导入` 的占位剧本，并把分镜绑定到该剧本。

也可通过 `scriptName` 指定占位剧本名称：

```json
{
  "projectId": 1001,
  "scriptName": "第1集分镜表",
  "data": []
}
```

### 行为

1. 如果 `roleNames` / `sceneNames` / `toolNames` 中的资产不存在，自动创建原始资产。
2. 写入 `o_storyboard`。
3. 写入 `o_assets2Storyboard`。
4. 按 `track` 自动创建或复用 `o_videoTrack`。
5. 返回写入后的分镜列表。

## 流程进度聚合

```txt
POST /api/production/workflow/getProgress
```

用于前端步骤条/流程按钮展示当前项目生产进度。

### 请求体

```json
{
  "projectId": 1001,
  "scriptId": 2001
}
```

`scriptId` 可选。不传时统计整个项目。

### 返回阶段

- `importContent`：导入内容
- `novelEvents`：小说事件
- `originalAssets`：原始资产
- `originalAssetImages`：原始资产图
- `derivedAssets`：衍生资产
- `derivedAssetImages`：衍生资产图
- `storyboardPanel`：分镜面板
- `storyboardImages`：分镜图
- `videoPrompts`：视频提示词
- `videos`：视频

### 状态枚举

| 状态 | 含义 |
| --- | --- |
| `idle` | 未开始 |
| `ready` | 可执行 |
| `generating` | 生成中 |
| `success` | 已完成 |
| `failed` | 全部失败 |
| `partial` | 部分成功、部分失败 |

## AI 短剧前端接入顺序

1. 新建项目，传入规范化 `projectType`。
2. 若为 `storyboard`：调用 `/api/storyboardImport/parse` 预览。
3. 用户确认后调用 `/api/storyboardImport/commit` 入库。
4. 调用 `/api/production/workflow/getProgress` 刷新流程按钮状态。
5. 后续复用已有接口：
   - 分镜图：`/api/production/storyboard/batchGenerateImage`
   - 视频提示词：`/api/production/workbench/batchGeneratePrompt`
   - 视频生成：`/api/production/workbench/batchGenerateVideo`

## 流程配置

```txt
POST /api/production/workflow/getConfig
```

用于前端渲染新建项目类型、流程按钮、状态文案。

### 返回字段

| 字段 | 说明 |
| --- | --- |
| `projectTypes` | 可选项目类型列表 |
| `steps` | 流程步骤配置，按 `order` 排序 |
| `stateLabels` | `getProgress` 返回状态对应的中文文案 |

### `steps` 项结构

```ts
{
  key: "generateStoryboardImages",
  label: "生成分镜图",
  description: "根据分镜面板和关联资产生成分镜图片。",
  progressKey: "storyboardImages",
  targetApi: "/api/production/storyboard/batchGenerateImage",
  order: 60
}
```

前端推荐用 `steps[].progressKey` 去匹配 `/api/production/workflow/getProgress` 返回的 `steps` 字段，用 `steps[].key` 调用 `/api/production/workflow/runStep`。

## 一键执行流程步骤

```txt
POST /api/production/workflow/runStep
```

用于前端一键流程按钮。它会先内部调用 `/api/production/workflow/prepareStepRequest` 生成目标接口请求体，再调用对应底层接口启动任务。

### 请求体

```json
{
  "projectId": 1001,
  "scriptId": 2001,
  "step": "generateStoryboardImages",
  "concurrentCount": 5
}
```

支持的 `step` 与 `prepareStepRequest` 相同。

### 返回体：已启动

```json
{
  "code": 200,
  "data": {
    "status": "started",
    "prepared": {
      "step": "generateStoryboardImages",
      "targetApi": "/api/production/storyboard/batchGenerateImage",
      "requestBody": {
        "storyboardIds": [1, 2, 3],
        "projectId": 1001,
        "scriptId": 2001,
        "concurrentCount": 5,
        "compulsory": false
      },
      "total": 3
    },
    "result": {
      "code": 200,
      "data": [],
      "message": "成功"
    }
  },
  "message": "成功"
}
```

### 返回体：无可执行对象

```json
{
  "code": 200,
  "data": {
    "status": "skipped",
    "reason": "没有可执行对象",
    "prepared": {
      "step": "generateStoryboardImages",
      "targetApi": "/api/production/storyboard/batchGenerateImage",
      "requestBody": {
        "storyboardIds": [],
        "projectId": 1001,
        "scriptId": 2001,
        "concurrentCount": 5,
        "compulsory": false
      },
      "total": 0
    }
  },
  "message": "成功"
}
```

### 前端最简调用

```ts
await api.post("/api/production/workflow/runStep", {
  projectId,
  scriptId,
  step: "generateStoryboardImages",
  concurrentCount: 5,
});

await refreshProgress();
```

注意：大多数底层生成接口是“立即返回 + 后台生成”，所以 `runStep` 返回 `started` 只代表任务已提交，不代表生成已完成。前端仍需要轮询对应状态接口或定时刷新 `/api/production/workflow/getProgress`。

## 步骤请求体准备

```txt
POST /api/production/workflow/prepareStepRequest
```

用于把某个流程步骤转换成已有底层接口可直接使用的请求体。它不执行生成任务，只返回 `targetApi` 和 `requestBody`，前端拿到后再调用对应接口。

### 请求体

```json
{
  "projectId": 1001,
  "scriptId": 2001,
  "step": "generateStoryboardImages",
  "concurrentCount": 5
}
```

`step` 支持：

| step | 目标接口 |
| --- | --- |
| `extractOriginalAssets` | `/api/script/extractAssets` |
| `polishOriginalAssetPrompts` | `/api/assetsGenerate/batchPolishAssetsPrompt` |
| `generateOriginalAssetImages` | `/api/assetsGenerate/batchGenerateImageAssets` |
| `polishDerivedAssetPrompts` | `/api/assetsGenerate/batchPolishAssetsPrompt` |
| `generateDerivedAssetImages` | `/api/production/assets/batchGenerateAssetsImage` |
| `generateStoryboardImages` | `/api/production/storyboard/batchGenerateImage` |
| `generateVideoPrompts` | `/api/production/workbench/batchGeneratePrompt` |
| `generateVideos` | `/api/production/workbench/batchGenerateVideo` |

### 返回体示例

```json
{
  "code": 200,
  "data": {
    "step": "generateStoryboardImages",
    "targetApi": "/api/production/storyboard/batchGenerateImage",
    "requestBody": {
      "storyboardIds": [1, 2, 3],
      "projectId": 1001,
      "scriptId": 2001,
      "concurrentCount": 5,
      "compulsory": false
    },
    "total": 3
  },
  "message": "成功"
}
```

### 前端一键按钮推荐流程

```ts
const prepared = await api.post("/api/production/workflow/prepareStepRequest", {
  projectId,
  scriptId,
  step: "generateStoryboardImages",
  concurrentCount: 5,
});

if (prepared.data.total > 0) {
  await api.post(prepared.data.targetApi, prepared.data.requestBody);
}
```

注意：该接口只负责准备请求体，不直接启动任务。这样可以最大程度复用现有接口，同时避免把内部路由函数互相调用导致维护复杂度上升。

## 可执行对象列表

```txt
POST /api/production/workflow/getRunnableData
```

用于前端在流程按钮点击前获取“当前可执行对象”，避免前端重复拼装资产、分镜、轨道等列表。

### 请求体

```json
{
  "projectId": 1001,
  "scriptId": 2001
}
```

`scriptId` 可选。不传时返回整个项目范围内的可执行对象。

### 返回字段

返回体中的 `data.runnable` 包含：

| 字段 | 用途 | 可直接衔接的已有接口 |
| --- | --- | --- |
| `extractOriginalAssets` | 可提取原始资产的剧本 ID 列表 | `/api/script/extractAssets` |
| `polishOriginalAssetPrompts` | 可润色提示词的原始资产 | `/api/assetsGenerate/batchPolishAssetsPrompt` |
| `generateOriginalAssetImages` | 可生成图片的原始资产 | `/api/assetsGenerate/batchGenerateImageAssets` |
| `polishDerivedAssetPrompts` | 可润色提示词的衍生资产 | `/api/assetsGenerate/batchPolishAssetsPrompt` |
| `generateDerivedAssetImages` | 可生成图片的衍生资产 | `/api/production/assets/batchGenerateAssetsImage` 或 `/api/assetsGenerate/batchGenerateImageAssets` |
| `generateStoryboardImages` | 可生成分镜图的分镜 | `/api/production/storyboard/batchGenerateImage` |
| `generateVideoPrompts` | 可生成视频提示词的轨道 | `/api/production/workbench/batchGeneratePrompt` |
| `generateVideos` | 可生成视频的轨道 | `/api/production/workbench/batchGenerateVideo` |

### 典型前端用法

1. 页面加载或流程步骤完成后调用 `/api/production/workflow/getProgress` 刷新总状态。
2. 用户点击某个流程按钮时调用 `/api/production/workflow/getRunnableData`。
3. 根据 `runnable` 对应字段组装已有批量接口的请求体。
4. 调用生成接口后继续轮询已有状态接口，或再次调用 `getProgress` 刷新步骤状态。

## 独立无限画布

无限画布页面入口为 `/#/infinite-canvas`，编辑工作区使用 `/#/infinite-canvas?projectId=<id>`。画布项目、工作区和产物历史与普通短剧项目隔离，所有画布专用接口位于 `/api/infiniteCanvas`。

### 模型列表与能力详情

画布不维护独立模型配置。创建项目、修改项目设置和运行节点时，均实时读取当前已启用 Vendor 的模型。

#### 查询模型列表

```txt
POST /api/modelSelect/getModelList
```

请求体：

```json
{
  "type": "image"
}
```

`type` 支持 `text`、`image`、`video` 和 `all`。画布分别请求 `image` 与 `video`。

当没有启用的 Vendor 时，该历史接口返回 HTTP `404` 和 `{ "error": "模型未找到" }`，不使用统一响应包装。

返回数据示例：

```json
{
  "code": 200,
  "data": [
    {
      "id": "vendor-id",
      "label": "模型显示名称",
      "value": "model-name",
      "type": "image",
      "name": "Vendor 显示名称"
    }
  ],
  "message": "成功"
}
```

提交画布项目或节点配置时，模型键使用 `${id}:${value}`，例如 `vendor-id:model-name`。

#### 查询模型能力

```txt
POST /api/modelSelect/getModelDetail
```

```json
{
  "modelId": "vendor-id:model-name"
}
```

返回已配置 Vendor 中该模型的完整能力对象。前端应根据能力对象动态生成首帧、尾帧、多图片参考和 `videoReference` 端口，并校验模式、参考数量、分辨率、时长及音频选项。模型失效时应阻止运行，不应自动替换模型或删除已有连线。

### 画布项目 CRUD

#### 查询画布项目

```txt
POST /api/infiniteCanvas/projects/list
```

请求体为空对象：

```json
{}
```

`data` 为 `canvas` 项目数组，按工作区更新时间倒序排列。每个项目包含普通项目字段，以及：

| 字段 | 说明 |
| --- | --- |
| `revision` | 工作区当前修订号 |
| `workspaceUpdateTime` | 工作区最后更新时间 |
| `settings` | 默认视频分辨率、时长和音频设置 |
| `thumbnailUrl` | 最近一个成功的当前产物预览地址，无产物时为空字符串 |

#### 新建画布项目

```txt
POST /api/infiniteCanvas/projects/create
```

请求体：

```json
{
  "name": "广告创意画布",
  "intro": "用于商品视频创意探索",
  "imageModel": "vendor-id:image-model",
  "videoModel": "vendor-id:video-model",
  "imageQuality": "2K",
  "videoRatio": "16:9",
  "mode": "text",
  "settings": {
    "defaultVideoResolution": "720p",
    "defaultVideoDuration": 5,
    "defaultVideoAudio": false
  }
}
```

必填字段为 `name`、`imageModel` 和 `videoModel`。`mode` 可以是字符串，也可以是多参考模式数组。后端会验证图片和视频模型是否存在且处于启用状态。

创建成功后返回完整工作区，初始图为空：

```json
{
  "code": 200,
  "data": {
    "project": {
      "id": 1720000000000,
      "projectType": "canvas",
      "name": "广告创意画布"
    },
    "settings": {
      "defaultVideoResolution": "720p",
      "defaultVideoDuration": 5,
      "defaultVideoAudio": false
    },
    "graph": {
      "version": 1,
      "nodes": [],
      "edges": [],
      "viewport": { "x": 0, "y": 0, "zoom": 1 }
    },
    "revision": 1,
    "scriptId": 2001,
    "artifacts": []
  },
  "message": "成功"
}
```

`scriptId` 是画布内部用于复用现有视频轨道和任务接口的占位剧本 ID，客户端应直接保存并回传，不要自行创建或修改对应剧本。

#### 更新画布项目设置

```txt
POST /api/infiniteCanvas/projects/update
```

请求体与创建接口相同，并增加 `projectId`：

```json
{
  "projectId": 1720000000000,
  "name": "广告创意画布（竖屏）",
  "imageModel": "vendor-id:image-model",
  "videoModel": "vendor-id:video-model",
  "imageQuality": "2K",
  "videoRatio": "9:16",
  "mode": ["imageReference:9", "videoReference:3"],
  "settings": {
    "defaultVideoResolution": "1080p",
    "defaultVideoDuration": 10,
    "defaultVideoAudio": true
  }
}
```

更新成功后同样返回完整工作区。项目默认参数可以被节点覆盖，但仍必须引用现有模型配置。

#### 永久删除画布项目

```txt
POST /api/infiniteCanvas/projects/delete
```

```json
{
  "projectId": 1720000000000,
  "confirmationName": "广告创意画布（竖屏）"
}
```

`confirmationName` 去除首尾空格后必须与项目名完全一致。成功返回：

```json
{
  "code": 200,
  "data": { "deleted": 1720000000000 },
  "message": "成功"
}
```

删除是不可逆操作，会清理画布工作区、产物历史、关联视频任务、项目业务数据及 `${projectId}/` 下的素材文件。

### 工作区与 InfiniteCanvasGraph v1

#### 读取工作区

```txt
POST /api/infiniteCanvas/workspace/get
```

```json
{
  "projectId": 1720000000000
}
```

返回结构与创建项目接口一致，包含 `project`、`settings`、`graph`、`revision`、`scriptId` 和 `artifacts`。

#### 图数据结构

```ts
interface InfiniteCanvasGraph {
  version: 1;
  nodes: Array<{
    id: string;
    type: "material" | "image" | "video";
    position: { x: number; y: number };
    data: {
      label?: string;
      prompt?: string;
      mediaType?: "image" | "video";
      modelOverride?: string | null;
      qualityOverride?: string | null;
      ratioOverride?: string | null;
      modeOverride?: string | string[] | null;
      resolutionOverride?: string | null;
      durationOverride?: number | null;
      audioOverride?: boolean | null;
      runtime?: Record<string, unknown>;
      [key: string]: unknown;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourcePort: string;
    targetPort: string;
    order: number;
  }>;
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}
```

服务端执行基础图校验：

- `version` 必须为 `1`，节点类型只能是 `material`、`image` 或 `video`。
- 节点和连线 ID 不得重复；禁止自连、重复端口连线、缺失端点和有向循环。
- 节点位置及视口坐标必须是有限数字，允许负坐标和超长距离。
- `viewport.zoom` 范围为 `0.25`–`2`。
- 未传 `sourcePort`、`targetPort` 或有效 `order` 时，服务端会分别规范化为 `media`、`input` 和数组顺序。

媒体类型、模型能力、动态端口以及首尾帧/多参考数量属于前端运行前校验；服务端保存图时不会因切换模型而静默删除已有边。

#### 保存工作区

```txt
POST /api/infiniteCanvas/workspace/update
```

```json
{
  "projectId": 1720000000000,
  "baseRevision": 7,
  "graph": {
    "version": 1,
    "nodes": [],
    "edges": [],
    "viewport": { "x": 120, "y": -80, "zoom": 0.75 }
  }
}
```

保存成功：

```json
{
  "code": 200,
  "data": {
    "revision": 8,
    "graph": {
      "version": 1,
      "nodes": [],
      "edges": [],
      "viewport": { "x": 120, "y": -80, "zoom": 0.75 }
    }
  },
  "message": "成功"
}
```

`baseRevision` 必须等于服务端当前 `revision`。版本过期时返回 HTTP `409`：

```json
{
  "code": 409,
  "data": null,
  "message": "画布已在另一个窗口更新，请重新加载后再保存"
}
```

前端应串行提交保存请求；成功后用返回的 `revision` 替换本地值。收到 `409` 后停止继续自动保存，提示用户重新加载或处理冲突，不能用旧图静默覆盖新图。当前页面采用语义变更约 420ms、布局变更约 620ms 的防抖保存。

保存图时，被删除节点的产物不会立即删除，而会标记为 `detached: 1`，以支持撤销；重新加入同 ID 节点后会恢复为 `detached: 0`。

### 素材上传

```txt
POST /api/infiniteCanvas/materials/upload
```

上传前必须先在 Graph v1 中保存对应的 `material` 节点。

请求体：

```json
{
  "projectId": 1720000000000,
  "nodeId": "material-01",
  "fileName": "reference.webp",
  "dataBase64": "data:image/webp;base64,..."
}
```

支持格式和单文件限制：

| 媒体 | MIME | 扩展名 | 上限 |
| --- | --- | --- | --- |
| 图片 | `image/jpeg` | `.jpg`、`.jpeg` | 20MB |
| 图片 | `image/png` | `.png` | 20MB |
| 图片 | `image/webp` | `.webp` | 20MB |
| 视频 | `video/mp4` | `.mp4` | 64MB |
| 视频 | `video/webm` | `.webm` | 64MB |

`dataBase64` 必须是完整 Data URL；MIME、文件扩展名、大小、项目归属、节点类型和安全路径均由服务端验证。每次上传都会为该节点创建一个新版本并设为当前版本。

成功后 `data` 为标准产物对象：

```json
{
  "id": 3001,
  "projectId": 1720000000000,
  "nodeId": "material-01",
  "origin": "upload",
  "mediaType": "image",
  "fileName": "reference.webp",
  "mimeType": "image/webp",
  "filePath": "1720000000000/infiniteCanvas/materials/uuid.webp",
  "videoId": null,
  "version": 1,
  "isCurrent": 1,
  "detached": 0,
  "state": "success",
  "prompt": "",
  "model": "",
  "params": {},
  "inputSignature": "",
  "inputArtifactIds": [],
  "errorReason": null,
  "url": "/oss/..."
}
```

浏览器多选上传时应按文件逐个创建素材节点并调用本接口，不要把多个文件合并成一个请求。

### 产物历史与版本

产物状态枚举：

| 状态 | 含义 |
| --- | --- |
| `uploading` | 正在上传或等待写入 |
| `generating` | 正在生成 |
| `success` | 可预览、下载和作为下游输入 |
| `failed` | 生成失败，错误位于 `errorReason` |

`origin` 为 `upload` 或 `generated`；`mediaType` 为 `image` 或 `video`。同一 `projectId + nodeId` 下版本号递增，且只有一个 `isCurrent: 1` 的当前版本。

#### 查询历史

```txt
POST /api/infiniteCanvas/artifacts/list
```

查询项目全部产物：

```json
{
  "projectId": 1720000000000
}
```

查询单个节点：

```json
{
  "projectId": 1720000000000,
  "nodeId": "image-01"
}
```

返回标准产物对象数组，按节点和版本倒序排列。读取列表时会同步关联视频任务的成功或失败状态。

#### 切换当前版本

```txt
POST /api/infiniteCanvas/artifacts/select
```

```json
{
  "projectId": 1720000000000,
  "artifactId": 3001
}
```

只能选择属于当前项目且状态为 `success` 的产物。成功后返回新的当前产物。客户端应重新计算下游节点输入签名，并把受影响的旧结果标记为已过期。

#### 删除非当前版本

```txt
POST /api/infiniteCanvas/artifacts/delete
```

```json
{
  "projectId": 1720000000000,
  "artifactId": 2999
}
```

当前版本不能删除，必须先切换到其他成功版本。删除成功返回 `{ "deleted": 2999 }`，并清理未被其他产物引用的本地文件和关联视频记录。

### 图片生成兼容扩展

图片节点继续调用 AI 短剧现有接口：

```txt
POST /api/production/editImage/generateFlowImage
```

画布请求示例：

```json
{
  "model": "vendor-id:image-model",
  "references": [],
  "quality": "2K",
  "ratio": "16:9",
  "prompt": "电影感城市夜景，霓虹灯反射在雨后的街道上",
  "projectId": 1720000000000,
  "canvasContext": {
    "nodeId": "image-01",
    "inputSignature": "client-computed-signature",
    "inputArtifactIds": [3001, 3002]
  }
}
```

画布模式以 `canvasContext.inputArtifactIds` 指向的当前成功图片产物作为真实输入；服务端会验证项目归属、当前版本、节点有效性和媒体类型。`references` 保留是为了兼容旧请求，画布调用有 `inputArtifactIds` 时不会依赖客户端 URL 读取素材。

成功返回：

```json
{
  "code": 200,
  "data": {
    "url": "/oss/.../smallImage",
    "filePath": "1720000000000/workFlow/uuid.jpg",
    "artifact": {
      "id": 3010,
      "nodeId": "image-01",
      "origin": "generated",
      "mediaType": "image",
      "version": 2,
      "isCurrent": 1,
      "state": "success"
    }
  },
  "message": "成功"
}
```

服务端会在开始生成时登记 `generating` 版本，成功后补充真实 `filePath`，失败后记录 `failed` 和 `errorReason`。未传 `canvasContext` 的旧调用保持原有 `{ "url": "..." }` 返回结构。

纯提示词生成时可传空的 `inputArtifactIds`；是否允许无参考图运行应由所选模型能力和前端端口规则决定。

### 视频生成兼容扩展

#### 创建视频轨道

每个视频节点需要一个属于当前画布内部 `scriptId` 的 `trackId`。节点第一次运行时调用：

```txt
POST /api/production/workbench/addTrack
```

```json
{
  "projectId": 1720000000000,
  "scriptId": 2001,
  "duration": 5
}
```

成功时 `data` 为数字轨道 ID。客户端可保存到节点的 `data.runtime.trackId`，后续运行复用。

#### 提交视频任务

```txt
POST /api/production/workbench/generateVideo
```

画布请求示例：

```json
{
  "projectId": 1720000000000,
  "scriptId": 2001,
  "uploadData": [
    { "sources": "canvas", "artifactId": 3010 },
    { "sources": "canvas", "artifactId": 3005 }
  ],
  "prompt": "镜头缓慢推进，人物转身看向城市天际线",
  "model": "vendor-id:video-model",
  "mode": "[\"imageReference:9\",\"videoReference:3\"]",
  "resolution": "1080p",
  "duration": 5,
  "audio": true,
  "trackId": 1720000000100,
  "canvasContext": {
    "nodeId": "video-01",
    "inputSignature": "client-computed-signature",
    "inputArtifactIds": [3010, 3005]
  }
}
```

注意事项：

- 画布引用固定使用 `{ "sources": "canvas", "artifactId": <id> }`。
- `uploadData` 的顺序就是参考输入顺序，必须与 `canvasContext.inputArtifactIds` 完全一致。
- 画布请求不能混用 `storyboard` 或 `assets` 来源。
- 服务端校验产物属于当前项目、处于成功状态、是当前有效版本且文件存在。
- 图片和视频引用通过通用媒体 Data URL 读取，视频会保留正确的 `video/*` MIME。
- `mode` 接口字段仍为字符串；多参考模式使用 JSON 数组字符串。单模式可直接传 `text`、`singleImage` 等模型声明的值。
- `scriptId` 必须是工作区返回的内部脚本 ID，`trackId` 必须属于相同项目和脚本。

提交成功后立即返回，后台继续生成：

```json
{
  "code": 200,
  "data": {
    "videoId": 4001,
    "artifact": {
      "id": 3020,
      "nodeId": "video-01",
      "origin": "generated",
      "mediaType": "video",
      "videoId": 4001,
      "version": 1,
      "isCurrent": 1,
      "state": "generating"
    }
  },
  "message": "成功"
}
```

未传 `canvasContext` 时，原短剧调用继续返回数字 `videoId`；旧的 `{ "sources": "storyboard", "id": ... }` 和 `{ "sources": "assets", "id": ... }` 仍保持原行为。

纯提示词视频生成可传空的 `uploadData` 和 `inputArtifactIds`，但前端必须先确认当前模型/模式允许无参考素材。

#### 批量查询视频状态

```txt
POST /api/production/workbench/checkVideoStateList
```

```json
{
  "projectId": 1720000000000,
  "scriptId": 2001,
  "videoIds": [4001, 4002]
}
```

接口只返回已经进入终态的视频：

```json
{
  "code": 200,
  "data": [
    {
      "id": 4001,
      "state": "生成成功",
      "errorReason": null,
      "filePath": "1720000000000/video/uuid.mp4",
      "src": "/oss/..."
    }
  ],
  "message": "成功"
}
```

推荐每 3 秒把所有 `generating` 视频的 `videoId` 合并为一次请求；随后重新调用 `/api/infiniteCanvas/artifacts/list` 获取规范化后的产物状态。页面刷新后，从工作区 `artifacts` 中恢复仍在运行的 ID 并继续轮询。

### 输入签名与过期状态

`inputSignature` 是客户端生成并由服务端原样保存的稳定字符串。当前画布前端使用序列化 JSON，包含：

- 提示词和当前有效模型；
- 当前有效的画质、比例、模式、分辨率、时长和音频设置；
- 按输入连线顺序排列的上游当前 `artifactId`。

服务端负责保存签名和输入产物 ID，不替客户端判断“已过期”。当节点配置、连线、模型或上游当前版本变化时，客户端将当前签名与产物的 `inputSignature` 比较，不一致即显示“已过期”。旧结果仍可预览；重新运行会创建新版本。

视频节点执行“运行完整链路”时，客户端应从目标节点反向收集依赖、做拓扑排序，并只补跑缺失、失败或已过期的图片生成节点。生成视频是终点，不应作为其他节点输入。

### 推荐画布接入顺序

1. 分别调用 `/api/modelSelect/getModelList` 获取图片和视频模型。
2. 通过 `/api/infiniteCanvas/projects/list` 展示独立项目列表。
3. 新建项目后保存返回的 `project.id`、`scriptId` 和 `revision`。
4. 打开编辑器时调用 `/api/infiniteCanvas/workspace/get`，再按相关模型调用 `/api/modelSelect/getModelDetail` 生成动态端口。
5. 本地修改 Graph v1，防抖调用 `/api/infiniteCanvas/workspace/update`；保存请求必须串行并处理 HTTP `409`。
6. 上传文件前先保存素材节点，再逐文件调用 `/api/infiniteCanvas/materials/upload`。
7. 运行图片节点时调用兼容扩展后的 `generateFlowImage`；运行视频节点前确保存在 `trackId`，再调用 `generateVideo`。
8. 每 3 秒批量轮询运行中视频，并刷新 `artifacts/list`。
9. 历史面板使用 `artifacts/list`、`select` 和 `delete`；切换当前版本后重算下游签名。
10. 永久删除项目时要求用户输入完整项目名，再调用 `projects/delete`。

### 兼容性边界

- 画布只复用既有图片和视频生成 HTTP 接口，不修改 Vendor 代码、模型适配器或配置表。
- `canvasContext`、`sources: "canvas"` 和 `artifactId` 均为可选兼容扩展；旧短剧请求与返回结构不变。
- 视频素材只能连接到声明支持 `videoReference` 的视频模型；图片生成输入只能使用图片产物。
- 画布第一版不包含音频素材节点、视频剪辑/拼接、字幕、分组便签或多人实时协作。
- 页面层的连线中点删除、边缘自动平移、快捷键、小地图和自动排版属于 Graph v1 的交互实现，不需要额外后端接口。
