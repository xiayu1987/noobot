# hooks.js 语义拆分实施文档

> 适用范围：`src/core/hooks.js`
> 目标：在不改变行为的前提下，按语义拆分为多个模块，降低单文件复杂度并提升可测性。

## 1. 总体目标

- 保持对外接口不变：
  - `createRegisterWorkflowHooks`
  - `registerWorkflowHooks`
- 保持运行行为不变：
  - hook 注册点、优先级、超时、回退策略、trace/event 结构不变。
- 保持测试通过：
  - 现有 `__tests__/workflow-*.test.js` 全部通过。

## 2. 拆分原则

1. **先搬运，后优化**：第一轮仅做函数迁移与 import/export 调整，不改业务逻辑。
2. **单向依赖**：优先沉淀底层工具模块，避免循环依赖。
3. **分步可回滚**：每一步拆分后立即运行测试验证。

## 3. 目标目录结构（第一阶段）

```txt
src/core/hooks/
  runtime.js        # 运行时/中断/超时/配置解析
  attachments.js    # 附件与 transfer payload 相关
  messages.js       # 文本归一化、语义上下文、系统消息拼装
  index.js          # 导出 registerWorkflowHooks（第二阶段再落）
```

> 本次优先执行：`runtime.js`、`attachments.js`、`messages.js`。

## 4. 分步执行清单

### Step 0：准备文档与基线

- 新增本实施文档。
- 记录当前测试基线（可选）。

### Step 1：提取 runtime 模块

迁移以下函数到 `src/core/hooks/runtime.js`：

- `resolveWorkflowRuntimeFromContext`
- `resolveWorkflowAbortSignal`
- `createWorkflowAbortError`
- `isWorkflowAbortError`
- `throwIfWorkflowAborted`
- `resolveWorkflowParentRunConfig`
- `hasOwnObjectKey`
- `withTimeout`

`hooks.js` 改为 import 使用。

### Step 2：提取 attachments 模块

迁移以下函数到 `src/core/hooks/attachments.js`：

- `mergeAttachmentMetas`
- `resolveWorkflowInputAttachmentMetas`
- `normalizeAttachmentRefs`
- `isAllUserAttachmentRef`
- `resolveSemanticAttachmentDeclarationMap`
- `resolveNodeInputAttachmentMetas`
- `resolveAttachmentDisplayPath`
- `isPlainObject`
- `normalizeWorkflowTransferPayload`
- `getWorkflowTransferPayloadFromResult`
- `applyWorkflowTransferPayload`
- `resolveWorkflowTransferFilesFromPayload`
- `resolveWorkflowAttachmentMetasFromTransferPayload`
- `resolveWorkflowCompatAttachmentMetas`
- `resolveWorkflowTransferFileDisplayPath`

### Step 3：提取 messages 模块

迁移以下函数到 `src/core/hooks/messages.js`：

- `resolveAssistantOutput`
- `resolveWorkflowSourceText`
- `extractWorkflowMessageTextContent`
- `compactWorkflowText`
- `resolveWorkflowAvailableToolCatalog`
- `resolveWorkflowAvailableToolNames`
- `buildWorkflowAvailableToolsPlanningBlock`
- `resolveWorkflowCompatibleRole`
- `resolveWorkflowToolCallName`
- `resolveWorkflowToolCallArguments`
- `buildWorkflowToolCallSemanticText`
- `normalizeWorkflowSemanticContextMessage`
- `resolveWorkflowSemanticContextMessages`

### Step 4：测试与回归

- 执行：`npm test`（在插件目录）
- 如有失败，优先排查 import 路径、命名导出、循环依赖。

## 5. 验收标准

- `hooks.js` 行数显著下降。
- 新模块职责清晰，命名语义一致。
- 所有现有测试通过。
- 对外导出与插件行为无变化。

## 6. 后续可选（第二阶段）

- 再提取：
  - `node-agent.js`
  - `persistence.js`
  - `phase.js`
- 让 `hooks.js` 仅保留 orchestration 主流程。

## 7. 实施进度回写（2026-06-08）

### 7.1 步骤状态

- [x] Step 0：准备文档与基线
- [x] Step 1：提取 runtime 模块
- [x] Step 2：提取 attachments 模块
- [x] Step 3：提取 messages 模块
- [x] Step 4：测试与回归

### 7.2 已完成产物

- 新增文档：
  - `docs/hooks-refactor-plan.md`
- 新增模块：
  - `src/core/hooks/runtime.js`
  - `src/core/hooks/attachments.js`
  - `src/core/hooks/messages.js`
- 改造文件：
  - `src/core/hooks.js`（改为按语义模块 import，移除对应内联实现）

### 7.3 回归验证结果

- 执行目录：`noobot/plugin/noobot-plugin-workflow`
- 执行命令：`npm test --silent`
- 结果：`32 passed, 0 failed`

### 7.4 备注

- 本阶段遵循“先搬运、后优化”，未做行为层改动。
- 下一步进入第二阶段：继续提取 `node-agent.js / persistence.js / phase.js`，进一步瘦身 `hooks.js`。

## 8. 第二阶段进度回写（2026-06-08）

### 8.1 步骤状态

- [x] Step A：提取 phase/trace 相关函数到 `phase.js`
- [x] Step B：提取 persistence/event 相关函数到 `persistence.js`
- [x] Step C：提取 node-agent 相关函数到 `node-agent.js`
- [x] Step D：执行测试并回写进度

### 8.2 第二阶段新增模块

- `src/core/hooks/phase.js`
- `src/core/hooks/persistence.js`
- `src/core/hooks/node-agent.js`

### 8.3 hooks.js 收敛结果

- `src/core/hooks.js` 当前仅保留：
  - `buildWorkflowInputAttachmentPlanningBlock`
  - `resolveSemanticText`
  - `createRegisterWorkflowHooks` 主编排
- 其余 runtime / attachments / messages / phase / persistence / node-agent 逻辑均已模块化。

### 8.4 回归验证结果

- 执行目录：`noobot/plugin/noobot-plugin-workflow`
- 执行命令：`npm test --silent`
- 结果：`32 passed, 0 failed`

## 9. 收尾整理进度（2026-06-08）

### 9.1 统一导出入口

- 新增：`src/core/hooks/index.js`
  - 对外统一导出 `createRegisterWorkflowHooks`、`registerWorkflowHooks`
  - 同时导出 runtime / attachments / messages / phase / persistence / node-agent 子模块

### 9.2 引用规范化

- 更新：`src/core/plugin.js`
  - `registerWorkflowHooks` 引用由 `./hooks.js` 调整为 `./hooks/index.js`

### 9.3 验证结果

- 执行目录：`noobot/plugin/noobot-plugin-workflow`
- 执行命令：`npm test --silent`
- 结果：`32 passed, 0 failed`

## 10. 命名语义化收尾（2026-06-08）

### 10.1 主编排文件命名优化

- 新增：`src/core/orchestrator.js`（由原 `hooks.js` 主编排逻辑迁移）
- 保留：`src/core/hooks.js` 作为兼容层（shim），继续导出：
  - `createRegisterWorkflowHooks`
  - `registerWorkflowHooks`

### 10.2 导出路径调整

- 更新：`src/core/hooks/index.js`
  - 统一从 `../orchestrator.js` 导出主入口
- 更新：`src/index.js`
  - 从 `./core/orchestrator.js` 导出 `registerWorkflowHooks` / `createRegisterWorkflowHooks`

### 10.3 验证结果

- 执行目录：`noobot/plugin/noobot-plugin-workflow`
- 执行命令：`npm test --silent`
- 结果：`32 passed, 0 failed`
