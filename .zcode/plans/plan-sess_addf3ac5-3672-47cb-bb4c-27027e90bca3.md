## 初步判断

这两条日志不是两个独立的前端请求，而是一条嵌套调用链：

1. 前端只请求 `POST /api/production/workflow/runStep`。
2. `runStep` 准备参数后，在服务端内部请求 `POST /api/production/workflow/generateDerivedAssets`（`src/routes/production/workflow/runStep.ts:50-79`）。
3. 内层接口返回 400，随后 `runStep` 把同一错误连同 `prepared` 请求上下文包装成第二个 400。

**最高概率根因是当前项目、当前分镜批次已有一条 `generateDerivedAssets + running` 运行记录。** 创建新运行记录时，`createWorkflowStepRun` 会直接抛出“该工作流步骤正在执行，请勿重复提交”（`src/routes/production/workflow/utils.ts:44-64`）。内层错误响应的估算长度约为 115～117 字节，外层附加 `prepared/storyboardIds` 后约为 329 字节，和日志中的 `117`、`329` 高度吻合。

代码中还存在一个会放大该问题的状态判断不一致：

- `prepareStepRequest` 只检查**最新一条**运行记录（`src/routes/production/workflow/prepareStepRequest.ts:245-248`）；
- 真正创建运行记录时却检查**任意一条**仍为 `running` 的记录（`src/routes/production/workflow/utils.ts:46-49`）。

因此，若历史上遗留了一条旧 `running`，但它后面又存在一条 `failed` 记录，准备阶段会判定可执行，目标接口却仍会拒绝，正好产生目前这组连续 400。异常退出产生的 `running` 目前只会在应用下次启动时统一转成 `failed`（`src/lib/fixDB.ts:50-55`），运行期间没有一致的陈旧记录处理机制。

第二候选是当前批次没有原始资产：目标接口会在 `src/routes/production/workflow/generateDerivedAssets.ts:91-99` 返回“该剧本没有可用于生成衍生资产的原始资产”，但准备阶段没有检查这一前置条件。第三候选才是 `universalAi` 配置或 AI 结构化输出错误。实施时会先用实际响应和数据库记录定案，不根据日志长度盲改。

## 实施计划

### 1. 先确认现场根因，不直接改用户数据

- 按项目规则先执行 `git branch --show-current` 和 `git status --short`，确认仍在 `master` 并记录已有改动。
- 获取这次 400 的实际响应 `message`，并查询当前 `projectId + scriptId + generateDerivedAssets` 的 `o_workflowStepRun` 记录，核对 `state/startTime/updateTime/endTime/errorReason`。
- 同时核对当前批次是否有：
  - `o_scriptAssets` 关联的原始角色、场景或道具；
  - 当前 `scriptId` 下的分镜；
  - 有效的 `universalAi` 部署配置。
- 如果发现历史遗留 `running`，先保留记录作为证据；只有确认它已无实际请求在执行时，才将其终结为 `failed`，不删除运行历史。

### 2. 统一运行状态判定，修复“双阶段判断不一致”

修改 `src/routes/production/workflow/utils.ts` 及调用处：

- 抽出统一的“当前活动运行记录”查询逻辑，让 `prepareStepRequest` 和 `createWorkflowStepRun` 使用同一判定口径，不能一处只看最新记录、另一处扫描全部历史记录。
- 对“旧 running 后面已经存在更新的终态记录”这种自相矛盾数据，将旧记录明确终结为失败并写入可诊断的 `errorReason`，然后再允许新运行；不静默删除记录。
- 如果最新记录确实仍在运行，则继续拒绝重复提交，避免并发调用两次 AI。
- 将重复提交作为明确的冲突状态返回，并让 `runStep` 保留内层 HTTP 状态和具体错误，而不是把所有下游问题一律模糊成普通 400。

### 3. 把前置条件提前到准备阶段

修改 `src/routes/production/workflow/prepareStepRequest.ts`：

- `generateDerivedAssets` 在准备请求时同时校验当前批次有分镜、且至少有一个通过 `o_scriptAssets` 关联的原始角色/场景/道具。
- 若缺少原始资产，返回明确阻塞原因，不再先生成 `prepared.total = 1`、进入目标接口后才报 400。
- 对确实正在运行的步骤返回明确的“正在执行”状态/原因，不用笼统的“没有可执行对象”掩盖状态。

### 4. 改善前端错误呈现和刷新行为

修改 `data/web/secondary-dev-patch.js` 中工作流执行逻辑：

- 展示服务端返回的具体 `message`，区分：正在运行、缺少原始资产、AI 配置错误、AI 输出错误。
- 遇到运行冲突时立即刷新当前批次工作流进度，使按钮状态和服务端保持一致。
- 保留现有本地 `runningSteps` 防重复点击，但不把它当作服务端并发保护的替代品。

### 5. 保证运行记录总能落到终态

检查并完善 `src/routes/production/workflow/generateDerivedAssets.ts:89-277`：

- 保持成功、空结果、业务失败分别落为 `success/empty/failed`。
- 对状态回写失败保留明确日志和上下文，避免只留下无法解释的 `running`。
- 不以简单的短时间阈值误杀仍在等待 AI 的合法任务；陈旧状态只依据可证明的状态矛盾或应用启动恢复处理。

### 6. 回归验证

仓库目前没有自动化测试框架，因此先做针对性接口/数据库回归，并运行项目现有检查：

- 无运行记录：正常生成，最终为 `success` 或 `empty`。
- 最新为 `failed`：允许重试。
- 最新为真实 `running`：只拒绝第二次请求，不重复调用 AI，错误信息明确。
- 历史旧 `running`、其后已有终态：旧记录被可追溯地终结，新请求可执行。
- 当前批次无原始资产：准备阶段直接返回明确阻塞原因。
- `universalAi` 配置错误或 AI 输出非法：运行记录最终为 `failed`，再次点击能够重试。
- 验证不同 `projectId/scriptId` 之间互不阻塞。
- 运行 `yarn lint`。
- 运行 `yarn build`，因为生产启动实际使用 `data/serve/app.js`，确认生产包包含修复。
- 最后再次检查 `git diff` 和 `git status --short`，报告所有修改及验证结果；除非用户另行要求，不提交、不推送。