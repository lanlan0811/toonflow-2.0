# Toonflow 二次开发版

> [!IMPORTANT]
> **原创致敬与来源声明**
>
> 本仓库是在 **HBAI-Ltd（北京爱啊科技有限公司）** 原创的 Toonflow 项目代码基础上进行的二次开发。感谢原作者及原项目贡献者提供完整的 AI 影视生产基础能力。本仓库不是官方发行版，二次开发内容、维护节奏和使用支持均由本仓库维护者自行负责。
>
> 原作者 / 原维护组织：**HBAI-Ltd（北京爱啊科技有限公司）**
>
> 原始项目完整仓库地址：
>
> - [![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/HBAI-Ltd/Toonflow-app) <https://github.com/HBAI-Ltd/Toonflow-app>
> - [![Gitee](https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white)](https://gitee.com/HBAI-Ltd/Toonflow-app) <https://gitee.com/HBAI-Ltd/Toonflow-app>
> - [![GitCode](https://img.shields.io/badge/GitCode-FC5531?style=flat-square&logo=git&logoColor=white)](https://gitcode.com/HBAI-Ltd/Toonflow-app) <https://gitcode.com/HBAI-Ltd/Toonflow-app>
> - [![AtomGit](https://img.shields.io/badge/AtomGit-DA203E?style=flat-square&logo=git&logoColor=white)](https://atomgit.com/HBAI-Ltd/Toonflow-app) <https://atomgit.com/HBAI-Ltd/Toonflow-app>
>
> 原项目关联的前端源代码仓库：
>
> - [![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/HBAI-Ltd/Toonflow-web) <https://github.com/HBAI-Ltd/Toonflow-web>
> - [![Gitee](https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white)](https://gitee.com/HBAI-Ltd/Toonflow-web) <https://gitee.com/HBAI-Ltd/Toonflow-web>
>
> 当前二次开发仓库：
>
> - [![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/lanlan0811/toonflaw-2.0.git) <https://github.com/lanlan0811/toonflaw-2.0>
> - [![Gitee](https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white)](https://gitee.com/lan0811/toonflow-2.0) <https://gitee.com/lan0811/toonflow-2.0>
> - [![GitCode](https://img.shields.io/badge/GitCode-FC5531?style=flat-square&logo=git&logoColor=white)](https://gitcode.com/lan0811/toonflow-2.0) <https://gitcode.com/lan0811/toonflow-2.0>

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <a href="https://github.com/HBAI-Ltd">
          <img src="https://github.com/HBAI-Ltd.png?size=160" width="96" height="96" alt="HBAI-Ltd 头像" />
        </a>
        <br />
        <strong>原创作者 · HBAI-Ltd</strong>
        <br />
        <sub>Toonflow 原项目作者与维护组织</sub>
        <br /><br />
        <a href="https://github.com/HBAI-Ltd">
          <img src="https://img.shields.io/badge/GitHub-原创主页-181717?style=flat-square&amp;logo=github&amp;logoColor=white" alt="HBAI-Ltd GitHub 主页" />
        </a>
        <a href="https://gitee.com/HBAI-Ltd">
          <img src="https://img.shields.io/badge/Gitee-原创主页-C71D23?style=flat-square&amp;logo=gitee&amp;logoColor=white" alt="HBAI-Ltd Gitee 主页" />
        </a>
      </td>
      <td align="center" width="50%">
        <a href="https://gitee.com/lan0811">
          <img src="https://foruda.gitee.com/avatar/1769601315847069536/16529552_lan0811_1769601315.png" width="96" height="96" alt="Lan0811 头像" />
        </a>
        <br />
        <strong>二次开发维护者 · Lan0811</strong>
        <br />
        <sub>当前扩展版本的开发与维护</sub>
        <br /><br />
        <a href="https://gitee.com/lan0811">
          <img src="https://img.shields.io/badge/Gitee-我的主页-C71D23?style=flat-square&amp;logo=gitee&amp;logoColor=white" alt="Lan0811 Gitee 主页" />
        </a>
        <a href="https://github.com/lanlan0811">
          <img src="https://img.shields.io/badge/GitHub-我的主页-181717?style=flat-square&amp;logo=github&amp;logoColor=white" alt="Lan0811 GitHub 主页" />
        </a>
      </td>
    </tr>
  </table>
</div>

## 项目定位

这是一个面向 AI 短剧、漫剧和商品视觉内容生产的本地工作台。项目保留 Toonflow 原有的小说、剧本、资产、分镜和视频生产能力，并在此基础上补充了三条独立业务线：

1. 以分镜表为起点的 AI 短剧生产闭环。
2. 以多 SKU 节点工作流为核心的商品视觉工厂 v2。
3. 以素材、提示词和生成结果自由编排为核心的独立无限画布。

当前版本号为 `1.1.9`。应用可作为 Electron 桌面端运行，也可以单独启动本地 HTTP 服务。业务数据、生成素材和工作流状态默认保存在本机。

## 本仓库新增内容

### 1. 基于分镜表的独立项目类型

项目类型现统一为：

| 值 | 页面含义 | 主要输入 |
| --- | --- | --- |
| `novel` | 基于小说原文 | 小说章节与事件 |
| `script` | 基于剧本 | 单集或批量剧本 |
| `storyboard` | 基于分镜表 | 结构化分镜表 |
| `commerce` | 商品视觉工厂 | SKU、商品/品牌参考图与生产模板 |
| `canvas` | 独立无限画布 | 图片、视频素材与提示词 |

`storyboard` 项目拥有独立的分镜表管理入口，不再被当作普通剧本项目显示或跳转。

#### 分镜表列表的“编辑生成”

“分镜表管理 → 分镜表列表”的每条分镜都提供“编辑生成”操作，用于打开该分镜专属的全屏画布：

- 默认载入当前分镜关联的角色、场景和道具图片节点，并连接到分镜图生成节点；
- 支持画布平移、`25%–200%` 缩放、节点拖拽与连线、适配视图、自动布局、撤销和重做；单击连线后可点击曲线中间的 `×` 断开连接，也可双击连线快捷断开；
- 可以为角色、场景和道具上传本地 PNG/JPEG 覆盖图。覆盖只在当前分镜画布中使用，不会修改资产库中的原图，并可随时恢复原资产；
- 可以新增图片或生成节点，通过“图片/生成结果 → 生成节点”的连线组织参考关系；重复连接、自连接和循环连接会被拒绝；
- 生成提示词支持输入 `@` 插入结构化 `@图片N` 引用。引用绑定对应节点，支持悬停预览；引用失效时会阻止生成和保存；
- 每个生成节点可以单独选择图片模型、比例和画质。保存前需要指定一个有效的“最终结果”，保存后图片和提示词会回写当前分镜并刷新列表缩略图；
- 画布通过分镜记录的 `flowId` 保存到 `o_imageFlow`，再次进入时可恢复节点、连线、提示词、参数、视口和资产覆盖状态，不依赖浏览器本地存储。

如果保存过程中某个接口失败，画布会保留当前编辑结果并允许重试；关闭存在未保存修改的画布时会要求确认。

### 2. 分镜表解析、预览与入库

二次开发接口支持解析以下输入：

- 标准 TXT 分镜格式；
- Markdown 表格；
- Word DOCX 表格；
- JSON；
- CSV / TSV；
- 直接粘贴的结构化文本。

解析阶段会标准化镜号、时长、景别、镜头运动、场景、画面描述、台词、音效、道具和备注等字段。用户确认后，系统会在事务内创建或复用：

- 内部分镜批次；
- 角色、场景、道具原始资产；
- 分镜记录及排序；
- 分镜与资产关联；
- 视频轨道。

### 3. 分镜表资产统计与关联修复

资产统计以最终分镜行实际使用的 `roleNames`、`sceneNames` 和 `toolNames` 为准，不再把未使用的参考资料混入主统计。

当前实现还包含：

- 未使用角色参考的明确警告；
- 缺少场景美术参考的明确警告；
- 同一批次内已明确道具的跨镜头补关联；
- 场景、角色、道具按类型去重；
- 解析端与提交端资产统计一致性校验；
- 防止无依据的模糊资产推断；
- 分镜关联资产的查询、编辑和重算。

### 4. 可观察、可重试的生产工作流

分镜表项目可以按以下步骤继续生产：

```text
导入分镜表
  → 原始资产提示词
  → 原始资产图片
  → 创建衍生资产
  → 衍生资产提示词
  → 衍生资产图片
  → 分镜图
  → 视频提示词
  → 视频
```

工作流会按 `projectId + scriptId` 隔离不同项目与导入批次，并为每一步提供总数、已完成数、失败数、生成中数量、可执行数量和阻塞原因。已完成项不会在普通执行中重复提交；失败项可以单独重试，必要时也可以强制重新生成。

### 5. 商品视觉工厂 v2（SKU 工作流画布）

访问地址：

```text
/#/product-factory
/#/product-factory?projectId=<项目ID>
```

商品视觉工厂项目使用 `commerce` 项目类型，与普通短剧项目隔离。一个项目可以管理多个 SKU，但画布一次只加载当前 SKU；项目入口负责 SKU 摘要列表和批量操作，单 SKU 详情再加载对应工作流与产物。工作区由顶栏、SKU 列表、中央画布和右侧节点检查器组成，主要能力包括：

- SKU 摘要分页（默认每页 50 条）、搜索、状态筛选、批量勾选、CSV/图片文件夹导入和单个 SKU 新建；
- 品牌设置、商品参考图、图片/视频模型、并发数和默认生成参数配置；
- 无限画布、鼠标锚点缩放（`25%–200%`）、空格平移、`Shift` 框选、`Ctrl/Cmd` 多选、小地图、适配视图和自动排版；
- 复制、粘贴、删除、撤销、重做，以及非执行型分组框和便签；来源节点与人工审核节点为受保护系统节点；
- `source`、`image`、`review`、`video` 四类生产节点，另有 `group` 和 `note` 装饰节点。标准工作流提供四种图片角色（主图、棚拍场景、生活场景、材质特写）和两种视频角色（英雄镜头、生活镜头），支持 `9:16` 与 `16:9`；
- 端口化连线表达真实参考图输入，支持图片派生链、人工审核候选，以及视频的主参考、首帧、尾帧和多参考输入；服务端拒绝循环、无效端口和绕过审核门的视频连线；
- 单节点执行、运行下游和跨 SKU 批量执行。运行前必须先预览任务数、跳过原因、模型、参考图和费用风险，并明确确认后入队；缺失或失效的必要上游会按拓扑自动补齐；
- 节点提示词模板预览、分区覆盖、恢复、升级和可选 AI 润色；节点可以继承项目模型，也可以单独覆盖，模型能力会校验参考图数量、时长、分辨率和音频参数；
- 图片候选审核和视频端口绑定。审核门未完成时不会提交视频任务；任务中心提供进度、暂停/中断恢复、失败重试和重复签名跳过；
- 项目工作流模板保存、差异预览和批量应用。默认保留 SKU 自定义节点、提示词、模型覆盖和布局，强制覆盖需要二次确认；
- 导出已批准图片、成功视频和 `manifest.csv` 的 ZIP 素材包。删除节点只会将其从当前生产流程移除，历史产物仍保留并标记为脱离工作流。

工作流图使用 Graph v2（`version: 2`），节点带有稳定的 `outputKey`、`roleKey`、模型覆盖、运行参数和端口信息，连线带有 `sourcePort`/`targetPort`。工作流保存带 `revision` 和基础版本检测，布局变化与语义变化分开计算：移动、缩放、分组和便签不会使历史产物失效；模型、提示词、连线或输入变化只影响对应节点及其下游。

数据保存在 `o_productFactory*` 本地表中，v1 工作流会在首次读取时幂等迁移并保留 `v1Backup`；旧模型和 Vendor 配置不会被迁移或改写。旧版 `/#/product-promo` 路由仍可进入迁移流程：系统会尝试导入旧本地画布和可定位的历史媒体，迁移可重复执行，旧本地存储不会自动删除。

### 6. 独立无限画布

访问地址：

```text
/#/infinite-canvas
/#/infinite-canvas?projectId=<项目ID>
```

独立无限画布使用 `canvas` 项目类型，与普通短剧项目和 `commerce` 商品视觉工厂完全隔离。侧边栏入口先进入画布项目列表；新建项目后进入空白工作区，采用“左侧节点库 + 中央画布 + 右侧属性与历史”布局。

当前版本提供以下能力：

- 上传 JPG、PNG、WebP 图片和 MP4、WebM 视频；多选上传时，每个文件创建一个独立素材节点。图片单文件默认不超过 20MB，视频单文件默认不超过 64MB；
- 使用 `material`、`image`、`video` 三类节点组织“素材 + 提示词 → 图片”“上传/生成图片 + 提示词 → 视频”和模型允许时的纯提示词生成；生成视频节点是终点；
- 项目设置保存默认图片/视频模型、画质、比例、视频模式、分辨率、时长和音频选项；图片和视频节点可以覆盖项目默认参数，但只引用当前已启用 Vendor 的模型配置；
- 端口根据模型模式动态显示首帧、尾帧、多图片参考和视频参考。系统阻止自连、重复边、循环和媒体类型不兼容连接；切换模型时不静默删除旧连线，而是把不兼容节点标记为“不可运行”；
- 使用虚拟世界坐标支持负坐标、任意距离连线、四向平移、`25%–200%` 缩放、边缘自动平移、框选/多选、复制粘贴、撤销重做、适配视图、自动排版和小地图；
- SVG 贝塞尔连线不依赖固定画布尺寸。单击连线后，曲线真实中点会显示固定屏幕尺寸的圆形 `X`，点击即可断开并写入撤销历史；
- 每个生成节点可以单独运行。视频节点的“运行完整链路”会反向收集依赖，并按拓扑顺序补跑缺失或已经过期的上游图片节点；
- 节点配置、连线和上游当前版本参与输入签名。输入变化后旧结果仍可预览，但会标记为过期；重新运行会创建新版本；
- 节点只显示当前结果，右侧“版本历史”支持预览、切换当前版本、下载和删除非当前版本；切换版本会重新计算下游过期状态；
- 视频生成沿用现有异步任务和状态接口，每 3 秒批量刷新运行中的视频；刷新页面后会从持久化任务状态恢复轮询；
- 画布约 420ms 防抖自动保存，并显示保存中、已保存或冲突状态。工作区使用 `revision` 阻止多个窗口静默互相覆盖；
- 删除节点只将节点和连线移出当前图，历史产物仍保留以支持撤销；永久删除画布项目需要输入项目名二次确认，并清理关联工作区、历史、任务和项目素材目录。

图片生成继续复用 `/api/production/editImage/generateFlowImage`，视频生成继续复用 `/api/production/workbench/generateVideo` 和原有视频状态查询。画布只通过可选 `canvasContext`、`sources: "canvas"` 和 `artifactId` 做向后兼容扩展，不修改模型适配器、Vendor 代码或模型配置；原有短剧和商品视觉工厂请求形态保持不变。

## 保留的 Toonflow 基础能力

在原项目能力基础上，本仓库仍可使用：

- 小说章节导入、事件提取与剧本改编；
- ScriptAgent 与 ProductionAgent；
- 角色、场景、道具的原始资产和衍生资产管理；
- 资产提示词润色与图片生成；
- 分镜面板、分镜图和参考资产关联；
- 视频提示词、视频任务、候选结果和轨道管理；
- 多模型供应商配置与可编程 Vendor；
- Agent 技能文件和本地记忆；
- SQLite 本地数据存储；
- Electron 桌面端与 HTTP 服务模式。

## 技术组成

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Node.js-24-5FA04E?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24" />
  <img src="https://img.shields.io/badge/Express-5-000000?style=flat-square&amp;logo=express&amp;logoColor=white" alt="Express 5" />
  <img src="https://img.shields.io/badge/SQLite-本地数据-003B57?style=flat-square&amp;logo=sqlite&amp;logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Electron-40-47848F?style=flat-square&amp;logo=electron&amp;logoColor=white" alt="Electron 40" />
  <img src="https://img.shields.io/badge/Socket.IO-4.x-010101?style=flat-square&amp;logo=socketdotio&amp;logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Yarn-Classic-2C8EBB?style=flat-square&amp;logo=yarn&amp;logoColor=white" alt="Yarn Classic" />
  <img src="https://img.shields.io/badge/Docker-Node_24-2496ED?style=flat-square&amp;logo=docker&amp;logoColor=white" alt="Docker" />
</p>

| 层级 | 主要技术 |
| --- | --- |
| 运行时 | Node.js 24 |
| 语言 | TypeScript 5 |
| 服务端 | Express 5、Express WebSocket、Socket.IO |
| 数据库 | SQLite、Knex、better-sqlite3 |
| AI 接入 | Vercel AI SDK 与可编程模型供应商 |
| 本地推理 | Hugging Face Transformers / ONNX |
| 图像处理 | Sharp |
| 桌面端 | Electron 40、electron-builder |
| 构建 | esbuild、tsx |
| 内置前端 | 已构建 Web 资源 + TypeScript 商品视觉工厂/独立无限画布 bundle + 原生 JavaScript/CSS 二开补丁 |

## 目录说明

```text
.
├─ src/
│  ├─ agents/                         # ScriptAgent 与 ProductionAgent
│  ├─ constants/                      # 项目类型和工作流步骤定义
│  ├─ lib/                            # 数据库、资产统计和通用能力
│  │  ├─ productFactory/              # Graph、迁移、提示词、队列和导出
│  │  └─ infiniteCanvas/              # 独立画布 Graph v1、表结构与产物服务
│  ├─ routes/
│  │  ├─ storyboardImport/            # 分镜表解析、提交和管理接口
│  │  ├─ production/workflow/         # 生产步骤准备、进度和执行接口
│  │  ├─ productFactory/              # 商品视觉工厂 v2 API
│  │  └─ infiniteCanvas/              # 独立无限画布项目、工作区、素材与历史 API
│  └─ web/
│     ├─ productFactory/              # 商品视觉工厂 TypeScript 前端与画布
│     └─ infiniteCanvas/              # 独立无限画布 TypeScript 前端与画布控制器
├─ data/
│  ├─ serve/app.js                    # 构建后的生产服务入口
│  ├─ skills/                         # Agent 与美术风格技能文件
│  ├─ vendor/                         # 模型供应商实现
│  ├─ web/                            # 内置前端及二开页面
│  ├─ db2.sqlite                      # 本地业务数据库
│  └─ oss/                            # 本地生成素材
├─ scripts/                           # 构建、Electron 和打包脚本
├─ test/storyboardImport/             # 分镜表资产与解析回归测试
├─ test/productFactory/                # 商品视觉工厂 Graph、迁移、队列和 API 测试
├─ test/infiniteCanvas/                # 独立无限画布 Graph、修订、上传和版本测试
├─ .zcode/plans/                       # 已有二次开发计划记录
└─ .codex/plans/                       # 当前协作计划记录
```

`data/web/index.html` 是已构建前端产物，并非完整可维护的 Vue 源码。本仓库新增页面通过 `secondary-dev-patch.js`、`product-factory-studio.js`、`infinite-canvas-studio.js` 及对应样式注入；`product-promo-studio.js` 仅用于旧版宣传片兼容。替换或重新构建 `data/web` 前，请先确认这些二开文件和入口引用不会被覆盖。

## 环境准备

建议使用：

- Node.js `24.x`；
- Yarn Classic；
- Git；
- 可用的文本、图片和视频模型接口；
- Windows、macOS 或 Linux 桌面环境（运行 Electron 时）。

项目涉及 `better-sqlite3`、`sharp` 和 Electron 等原生或平台相关依赖。若依赖安装失败，请先确认 Node.js 版本、系统编译工具和当前平台架构一致。

## 获取与安装

```bash
# GitHub
git clone https://github.com/lanlan0811/toonflaw-2.0.git

# 或 Gitee
git clone https://gitee.com/lan0811/toonflow-2.0.git

# 或 GitCode
git clone https://gitcode.com/lan0811/toonflow-2.0.git

cd toonflaw-2.0
yarn install --frozen-lockfile
```

如果只是研究原始 Toonflow，请从本页开头列出的 HBAI-Ltd 原始仓库获取代码；上面的地址对应本二次开发版本。

## 启动方式

### Electron 桌面端

```bash
yarn dev:gui
```

该命令会启动本地后端，并通过 Electron 加载仓库内置前端，是体验完整功能的推荐开发方式。

如需连接单独运行的前端开发服务器：

```bash
yarn dev:gui-vite
```

此模式默认连接 `http://localhost:50188`，需要另行准备兼容的前端开发服务。

### 本地 HTTP 服务

```bash
yarn dev
```

默认监听：

```text
http://localhost:10588
```

内置页面入口为：

```text
http://localhost:10588/index.html
```

### 生产模式

```bash
yarn build
yarn start
```

`yarn start` 运行 `data/serve/app.js`。每次修改 TypeScript 路由后都应重新执行 `yarn build`，否则生产服务仍会使用旧的路由包。

## 首次使用

首次初始化数据库时会创建默认账户：

```text
用户名：admin
密码：admin123
```

登录后请立即修改默认密码，然后在设置中心完成以下配置：

1. 添加或启用模型供应商；
2. 配置文本、图片和视频模型；
3. 完成模型映射；
4. 为 Agent 工作流选择通用文本模型；
5. 分别测试文本、图片和视频请求。

模型调用会产生外部服务费用，实际费用、内容合规和数据处理规则由所选择的服务商决定。

## 使用分镜表工作流

1. 新建项目并选择“基于分镜表”。
2. 打开分镜表管理页，上传 TXT、Markdown 或 DOCX，或直接粘贴内容。
3. 检查解析后的镜头字段、资产统计和 warnings。
4. 确认导入并选择当前分镜批次。
5. 检查和编辑角色、场景、道具及其分镜关联。
6. 在需要单独调整的分镜行点击“编辑生成”，进入无限画布；可以上传仅对当前画布生效的资产覆盖图，也可以新增图片或生成节点并调整连线。需要断开连接时，单击连线并点击曲线中间的 `×`（或直接双击连线）。
7. 编辑生成节点提示词；输入 `@` 可以插入 `@图片N` 结构化引用。选择模型、比例和画质后生成图片，并将需要回写的节点设为“最终结果”。
8. 点击“保存”，将画布工作流、最终提示词和最终图片写回当前分镜；返回列表后检查对应缩略图。
9. 按需继续执行原始资产、衍生资产、批量分镜图和视频步骤；对失败项查看具体原因并重试。

同一项目可以存在多个导入批次。涉及资产、分镜和视频的操作应始终确认当前 `scriptId`，避免跨批次执行。

无限画布中上传的资产覆盖图不会回写角色、场景或道具资产库；只有最终生成节点的图片和提示词会在保存后更新当前分镜。关闭存在未保存修改的画布时，页面会提示确认。

## 使用商品视觉工厂

1. 从侧边栏进入“商品视觉工厂”，新建或打开 `commerce` 项目。
2. 在项目设置中配置品牌信息、默认图片/视频模型、画质、比例、并发数和提示词策略。
3. 新建单个 SKU，或导入包含 `sku`、`name`、`category`、`description`、`selling_points` 的 CSV；也可以选择图片文件夹按 SKU 匹配参考图。
4. 打开 SKU 画布，上传商品主参考、补充参考或品牌参考，按需编辑图片/视频节点提示词、运行参数和模型覆盖。
5. 通过端口连线表达真实输入，使用画布工具完成平移、缩放、框选、多选、复制粘贴、撤销重做和自动排版。
6. 先点击节点“运行”或“运行下游”，在任务预览中检查任务数量、跳过原因、参考图和费用风险，确认后再入队；跨 SKU 任务从批量中心选择图片/视频阶段与角色。
7. 在审核节点选择图片候选，并在视频节点中绑定主参考、首尾帧或多参考端口；审核完成后再预览并提交视频任务。
8. 在任务中心查看进度，必要时恢复暂停/中断任务或重试失败任务；完成后从导出抽屉下载已批准图片、成功视频和 `manifest.csv`。

商品视觉工厂的工作流、版本和产物保存在本地 SQLite 数据库与素材目录中。清理 Electron 用户数据目录、删除项目或迁移旧版宣传片前，请先确认是否需要保留工作流和历史产物。

## 使用独立无限画布

1. 从主页侧边栏进入“无限画布”，在独立列表中新建或打开 `canvas` 项目。
2. 在项目设置中选择默认图片/视频模型，以及画质、比例、视频模式、分辨率、时长和音频选项。
3. 点击“上传素材”选择图片或视频；也可以直接创建“图片生成”和“视频生成”节点。新项目默认没有任何节点。
4. 从来源节点右侧“输出”端口拖线到目标节点左侧端口；也可以先点击输出端口，再点击目标端口。端口名称和数量会随视频模型模式变化。
5. 在右侧属性栏编辑提示词和节点覆盖参数。图片节点可以接收图片参考，视频节点可以按模型能力接收首帧、尾帧、多图片或视频参考。
6. 点击节点“生成图片”或“生成视频”单独执行；需要自动补齐上游图片时，在视频节点点击“运行完整链路”。
7. 在右侧版本历史中预览、下载或切换当前版本。删除历史前需要先切换到其他当前版本，当前版本本身不能直接删除。
8. 使用 Space/中键平移、滚轮缩放、左键框选、`Ctrl/Cmd+C`/`V` 复制粘贴、`Delete` 删除、`Ctrl/Cmd+Z` 撤销；单击连线后点击曲线中点的圆形 `X` 断开连接。

画布会自动保存，无需手动提交。若顶部显示“另一窗口已更新”，当前窗口会停止继续保存；请重新加载服务器版本后再编辑，避免覆盖其他窗口的修改。

## 常用检查

```bash
# TypeScript 类型检查
yarn lint

# 分镜表解析与资产关联回归测试
yarn test:storyboard-import

# 商品视觉工厂 v2 回归测试
yarn test:product-factory

# 独立无限画布 Graph、修订、上传和版本回归测试
yarn test:infinite-canvas

# 二开前端脚本语法检查
node --check data/web/secondary-dev-patch.js
node --check data/web/product-factory-studio.js
node --check data/web/infinite-canvas-studio.js
node --check data/web/product-promo-studio.js

# 生成生产服务和 Electron 主进程构建文件
yarn build

# 检查补丁中的空白和冲突标记
git diff --check
```

分镜表、商品视觉工厂和独立无限画布自动化测试使用独立测试初始化，不应修改 `data/db2.sqlite` 或真实 Vendor 配置。商品视觉工厂测试覆盖 Graph v2、v1 迁移、模板差异、节点/下游任务、审核端口、重试和导出；独立无限画布测试覆盖 Graph v1、负坐标/超长连接、循环与重复边、修订冲突、上传校验和历史版本切换。

## 桌面端打包

```bash
# 仅生成未封装目录
yarn pack

# 当前平台完整打包
yarn dist

# 指定平台
yarn dist:win
yarn dist:mac
yarn dist:linux
```

打包前应先完成类型检查、分镜表测试和生产构建。跨平台打包可能还需要对应系统的签名、图标或原生依赖环境。

## 二次开发 API

主要新增接口如下：

| 接口 | 用途 |
| --- | --- |
| `POST /api/storyboardImport/parse` | 解析并预览分镜表 |
| `POST /api/storyboardImport/commit` | 提交分镜、资产和轨道 |
| `POST /api/storyboardImport/list` | 查询导入批次、分镜和关联资产 |
| `POST /api/storyboardImport/update` | 更新单条分镜 |
| `POST /api/storyboardImport/updateAsset` | 调整分镜资产关系 |
| `POST /api/storyboardImport/delete` | 删除分镜记录 |
| `POST /api/production/workflow/getConfig` | 获取项目类型和工作流配置 |
| `POST /api/production/workflow/getProgress` | 查询各生产步骤进度 |
| `POST /api/production/workflow/getRunnableData` | 查询当前可执行对象 |
| `POST /api/production/workflow/prepareStepRequest` | 准备底层步骤请求体 |
| `POST /api/production/workflow/runStep` | 统一启动一个生产步骤 |
| `POST /api/production/workflow/generateDerivedAssets` | 创建并关联衍生资产 |

商品视觉工厂 v2 API（全部为 `POST`）如下：

| 接口 | 用途 |
| --- | --- |
| `/api/productFactory/workspace/get`、`/update` | 读取或保存品牌、默认参数、并发和模板配置 |
| `/api/productFactory/products/list`、`/get`、`/upsert`、`/import`、`/delete` | SKU 摘要分页、单 SKU 详情、新建/更新、CSV 导入和删除 |
| `/api/productFactory/references/upload`、`/setPrimary`、`/delete` | 上传商品/品牌参考图、设置主参考和删除参考图 |
| `/api/productFactory/workflow/get`、`/update` | 读取或保存 Graph v2；更新使用 `baseRevision` 检测冲突 |
| `/api/productFactory/workflow/saveTemplate`、`/syncTemplate`、`/templatePreview`、`/templateApply` | 保存项目模板、同步模板修订、预览差异和应用模板 |
| `/api/productFactory/prompts/preview`、`/polish`、`/saveOverride`、`/reset`、`/upgrade` | 节点提示词编译、润色、覆盖、恢复和模板升级 |
| `/api/productFactory/review/submit` | 提交图片候选审核，并保存视频端口输入绑定 |
| `/api/productFactory/jobs/preview`、`/start` | 预览并确认单节点、下游或跨 SKU 批量任务；`start` 要求 `confirmed: true` |
| `/api/productFactory/jobs/progress`、`/resume`、`/retry`、`/cancelQueued` | 查询任务进度、恢复中断、重试失败和取消排队任务 |
| `/api/productFactory/models/list` | 获取图片/视频模型及参考图能力元数据 |
| `/api/productFactory/export/create` | 导出已批准图片、成功视频和 `manifest.csv` ZIP |
| `/api/productFactory/migration/importLegacy` | 幂等迁移旧 `product-promo` 项目及可定位的历史媒体 |

独立无限画布 API（全部为 `POST`）如下：

| 接口 | 用途 |
| --- | --- |
| `/api/infiniteCanvas/projects/list`、`/create`、`/update`、`/delete` | 查询、新建、更新和永久删除 `canvas` 项目；删除要求项目名确认 |
| `/api/infiniteCanvas/workspace/get`、`/update` | 读取或保存 InfiniteCanvasGraph v1、项目设置、内部 `scriptId` 和 `revision` |
| `/api/infiniteCanvas/materials/upload` | 上传 JPG/PNG/WebP/MP4/WebM 素材并登记节点历史版本 |
| `/api/infiniteCanvas/artifacts/list`、`/select`、`/delete` | 查询节点完整历史、切换当前版本和删除非当前版本 |
| `/api/modelSelect/getModelList`、`/getModelDetail` | 复用现有模型列表与能力详情，不建立画布专用模型配置 |
| `/api/production/editImage/generateFlowImage` | 复用图片生成；画布请求可附带 `canvasContext` 登记产物与输入签名 |
| `/api/production/workbench/generateVideo` | 复用视频生成；画布引用使用 `{ sources: "canvas", artifactId }` |
| `/api/production/workbench/checkVideoStateList` | 批量查询运行中的画布视频任务，刷新后可继续轮询 |

请求需要先登录并携带有效 Token。

## 数据与升级注意事项

- `data/db2.sqlite` 保存本地业务数据，调试和测试前请先备份。
- `data/oss` 保存图片、视频和缩略图等生成素材。
- 商品视觉工厂的 SKU、参考图、Graph v2、任务和产物保存在 `o_productFactoryConfig`、`o_productFactoryItem`、`o_productFactoryReference`、`o_productFactoryWorkflow`、`o_productFactoryJob` 和 `o_productFactoryArtifact` 表中。
- 独立无限画布的 Graph v1、项目默认参数、内部 `scriptId` 和修订号保存在 `o_infiniteCanvasWorkspace`；上传/生成来源、媒体类型、版本、当前版本、文件路径、`videoId`、输入签名和错误信息保存在 `o_infiniteCanvasArtifact`。
- Electron 安装版会把运行数据复制到应用用户数据目录，源码目录不一定是实际数据目录。
- 不要手工编辑 `data/serve/app.js`；它应由 `yarn build` 从 TypeScript 源码生成。
- 不要把 API Key、Token、真实数据库或生成素材提交到公开仓库。
- 更新内置前端时应重新验证分镜表页面、`/#/product-factory`、`/#/infinite-canvas` 路由、旧 `/#/product-promo` 迁移、侧边栏入口和 Electron `file://` 模式。
- 模型供应商对参考图数量、时长、分辨率和音频参数的支持不同，提交前会按模型详情进行校验。

## 当前边界

- 内置 Web 前端是构建产物，注入式二开对原页面 DOM 和路由结构存在依赖。
- 商品视觉工厂 v2 面向本地单用户生产，当前以节点生成图片和单条视频资产为主，不负责多片段剪辑、字幕合成或独立音轨混音。
- 独立无限画布第一版不提供音频素材节点、视频剪辑/拼接、字幕、分组便签或多人实时协作，也不会迁移旧产品宣传片和商品视觉工厂数据。
- 旧版 `product-promo` 画布只作为迁移入口；迁移依赖旧本地存储或仍可定位的历史媒体，无法定位的原始文件不会被凭空恢复。
- AI 生成结果受模型、提示词、服务可用性和供应商限制影响，不能保证每次输出一致。
- 本项目默认以本地单机工作流为主，不等同于多租户生产平台。
- 计划文档用于记录设计与修复过程；功能状态应以当前代码、路由和测试结果为准。

## 协作规则

本二次开发仓库只在 `master` 分支进行开发、提交和推送。修改前请确认当前分支和工作区状态，并保留已有未提交内容：

```bash
git branch --show-current
git status --short
```

提交前至少运行与修改范围对应的检查。修改分镜表解析、生产工作流或前端补丁时，建议执行“常用检查”中的完整命令集。

## 许可证与版权

本仓库继续保留原项目的 [LICENSE](./LICENSE) 与 [NOTICES.txt](./NOTICES.txt)。使用、修改和分发本项目时，应同时遵守：

1. Apache License 2.0；
2. `LICENSE` 末尾由 HBAI-Ltd 提供的补充协议；
3. 原项目关于商标、标识和版权信息的保留要求；
4. 第三方依赖各自的许可证。

将本软件或衍生版本作为产品向两个及以上独立第三方分发、销售或提供使用前，请先阅读补充协议并向 HBAI-Ltd 确认是否需要书面商业授权。

### 原有版权、专利、商标及署名声明

本仓库是基于 Toonflow 的二次开发项目。原项目及其第三方组件中已有的版权、专利、商标、服务标志、项目名称、Logo 和署名声明，均归各自权利人所有，并继续受其适用许可证及相关法律保护。本仓库不因复制、修改或分发相关代码而主张上述权利的所有权，也不授予任何超出对应许可证范围的专利权或商标权。

使用、修改或分发本项目时，应完整保留适用的 `LICENSE`、`NOTICES.txt`、源文件头部声明及其他版权、专利、商标和署名信息，并对修改过的文件作出清晰说明。未经相应权利人书面许可，不得删除、遮盖或擅自修改原有权利声明，也不得以任何方式暗示原作者、贡献者或 HBAI-Ltd 对本二次开发版本提供背书、担保或技术支持。
