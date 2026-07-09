# 二次开发：AI 短剧流程接口说明

本文档记录本仓库后端为“基于小说原文 / 基于剧本 / 基于分镜表”三种入口新增和整理的接口，供前端源码仓库接入。

## 项目类型

新建项目接口仍使用：

```txt
POST /api/project/addProject
```

`projectType` 支持以下规范值：

| 值 | 含义 |
| --- | --- |
| `novel` | 基于小说原文 |
| `script` | 基于剧本 |
| `storyboard` | 基于分镜表 |

后端同时兼容中文别名，例如 `基于小说原文`、`基于剧本`、`基于分镜表`，入库时会规范化为上表中的英文值。

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

## 推荐前端接入顺序

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
