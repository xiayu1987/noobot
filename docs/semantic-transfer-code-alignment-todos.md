# semantic-transfer 当前代码对齐状态与整改项

> 来源：根据 `semantic-transfer-raw-notes.md` 原始需求对照当前代码后整理。  
> 最近一次整改：已将主要场景迁移到 `transferSemanticContent({ scenario, strategy, ... })`；继续收敛 workflow / harness / agent final output legacy mirror，workflow payload / workflow message / nodeSessions 不再输出 `attachmentMetas` mirror，harness relay / final output 附件改为通过 `transferEnvelope(s)` 流转，agent 运行时生成附件与最终 assistant 输出也改为优先通过 `transferEnvelope(s)` 流转；本次完成剩余可整改项：建上下文入口不再输出 `attachmentMetas` mirror，runtime 将用户输入附件与运行时生成附件分离，旧 wrapper 名称已从源码实现中移除，compact payload 字段集合已代码化，普通附件链路继续禁止越权进入 semantic-transfer。

## 1. 对齐状态总览

| 场景 / 要求 | 整改后当前状态 | 结论 | 剩余整改重点 |
| --- | --- | --- | --- |
| 对外只暴露一个统一方法 | `sharedTools.semanticTransfer` 仅暴露 `transferSemanticContent(...)`；public re-export 已移除场景 wrapper：`transferSemanticContentSync`、`transferToolMessage`、`transferSubAgentMessages`、`processStageMessage`、`composeFinalMessage`；源码已不再使用这些 wrapper 名称 | ✅ 已对齐 | 内部实现按策略语义函数分派，不作为公共入口使用 |
| 场景通过策略区分 | 已引入 `SEMANTIC_TRANSFER_STRATEGY`，主要调用点已改为 `scenario + strategy`；统一入口不再从旧字段推断策略 | ✅ 已对齐 | 无主要剩余项 |
| 工具信息传递 | 工具结果超限、文件内容过长、脚本命令过长均已改为 `strategy: "tool_*"` | ✅ 已对齐 | 无主要剩余项 |
| workflow 子agent 信息流转 | 子agent 结果保存附件已改为 `workflow_subagent_result`；失败传播消息生成已接入 `workflow_failure_propagation`；下游拓扑仍由 workflow 编排层完成 | ✅ 已对齐 | 无主要剩余项 |
| workflow 最终返回 | final attachment summary 已改为 `scenario: "workflow" + strategy: "workflow_final_return"` | ✅ 已对齐 | 无主要剩余项 |
| harness 阶段消息 | 阶段明细保存附件已改为 `scenario: "harness" + strategy: "harness_stage_message"` | ✅ 已对齐 | 无主要剩余项 |
| harness 小结注入 | 默认全量注入主 agent 已对齐；inject/separate_model 两条小结主流程均已调用 `harness_summary_injection`，默认 `full`，附件模式映射为 `summary` | ✅ 已对齐 | 无主要剩余项 |
| harness 最终消息 | 最终输出已改为调用 `transferSemanticContent({ scenario: "harness", strategy: "harness_final_message" })`；返回包含标准 transfer 语义与 `finalMessage` | ✅ 已对齐 | 无主要剩余项 |
| 去 legacy / compat | workflow 主输出已去掉 `attachmentMetas` mirror；fallback persister 结果会转换为标准 `transferEnvelope(s)` 后继续流转；harness relay / final assistant output 不再新增 `attachmentMetas` mirror；agent 运行时生成附件会按授权场景白名单转换为 `transferEnvelope(s)`，最终 assistant turn/result 不再新增附件 mirror；agent 建上下文入口已只输出 `inputAttachmentMetas`，runtime 用户输入附件与生成附件已分离；compact payload 字段已代码化；旧 path / `attachmentMetas` 仅保留读取兼容和持久化普通附件协议 | ✅ 当前可整改项完成 | 后续新增必须遵守三类授权场景，不得把普通附件改造成 semantic-transfer |
| semantic-transfer 边界 | 主要编排仍在插件层；semantic-transfer 仅负责三类授权场景的信息转换/附件/返回；多模态图片保存、email connector 附件保存、agent-collab 普通异步结果附件保存已回退到 attachmentService | ✅ 基本对齐 | 继续避免新增越权场景 |

## 2. 已完成整改

### 2.1 统一入口与 public API 收敛

**整改后状态：✅ 已对齐。**

已完成：

- `sharedTools.semanticTransfer` 现在只暴露：
  - `transferSemanticContent(...)`
- 以下方法已从公共 re-export 与 `sharedTools.semanticTransfer` 暴露面移除：
  - `transferSemanticContentSync(...)`
  - `transferToolMessage(...)`
  - `transferSubAgentMessages(...)`
  - `processStageMessage(...)`
  - `composeFinalMessage(...)`
- 本轮进一步移除了 tool 场景内部 `transferToolMessage(...)` wrapper；统一入口会按 `strategy` 直接调用 `tool_input` / `tool_output` / `tool_result_text` 对应实现，不再把标准策略回译成 `direction` / `transferMode`。
- workflow / harness 的私有实现函数已改为策略语义命名：`transferWorkflowSubagentResult(...)`、`transferHarnessStageMessage(...)`、`composeHarnessFinalMessage(...)`；旧 wrapper 名称不再在源码中使用，外部调用方不得直接使用私有实现函数。

验证：

- `runtime-environment-builder.test.js` 已更新并覆盖：`transferSemanticContentSync` 等不再暴露。
- `semantic-transfer.test.js` 已覆盖 public index 不再导出场景 wrapper。

### 2.2 统一入参模型：场景 + 策略

**整改后状态：✅ 已对齐。**

已完成：

- 新增统一策略枚举：`SEMANTIC_TRANSFER_STRATEGY`。
- 统一入口支持：

```js
transferSemanticContent({
  scenario: "tool" | "workflow" | "harness",
  strategy: "...",
  ...payload,
})
```

已接入策略：

- 工具：
  - `tool_input`
  - `tool_output`
  - `tool_result_text`
- workflow：
  - `workflow_subagent_result`
  - `workflow_upstream_injection`
  - `workflow_final_return`
  - `workflow_failure_propagation`
- harness：
  - `harness_stage_message`
  - `harness_summary_injection`
  - `harness_final_message`

已完成：

- 统一入口不再从旧字段推断策略；标准调用必须显式传入 `strategy`。
- 旧 `scenario`：`subagent`、`harness_stage`、`harness_final` 不再作为标准入口场景。

## 3. 各场景检查明细

### 3.1 工具信息传递

**整改后状态：✅ 已对齐。**

已完成：

- 工具结果超限：已从 `transferMode: "tool_result_text"` 标准调用迁移为 `strategy: "tool_result_text"`。
- 文件写入内容过长：已从 `direction: "input"` 标准调用迁移为 `strategy: "tool_input"`。
- 脚本执行命令过长：已从 `direction: "input"` 标准调用迁移为 `strategy: "tool_input"`。
- 外部不再直接暴露 `transferToolMessage(...)`。
- 返回仍包含标准 transfer payload：
  - `transferResult`
  - `transferEnvelope` / `transferEnvelopes`
  - `compactTransferPayload` / `compactToolPayload`

剩余：

- 无主要剩余项。统一入口的 tool 策略分派已不再使用 `direction` / `transferMode` 适配；`direction` 仅保留为 TransferEnvelope 标准字段。

### 3.2 workflow 子agent 信息流转

**整改后状态：✅ 已对齐。**

已完成：

- 子agent 最终结果保存附件已改为：

```js
transferSemanticContent({
  scenario: "workflow",
  strategy: "workflow_subagent_result",
  ...
})
```

- 子agent 结果会产出 `transferResult / transferEnvelope / transferEnvelopes`，并回填到 workflow payload。
- 下游节点系统消息会基于上游 transfer payload 生成附件引用。
- 上游失败传播逻辑当前已存在于 workflow 编排层：
  - 下游系统消息包含上游失败节点、任务和失败信息；
  - 无附件时仍提示继续可完成部分并说明影响范围。
- 外部不再直接暴露 `transferSubAgentMessages(...)`。

已完成：

- `workflow_failure_propagation` 策略已接入上游失败传播消息生成。
- workflow 编排层仍负责拓扑和下游节点选择，semantic-transfer 负责失败传播注入消息 payload 转换。

### 3.3 workflow 最终返回

**整改后状态：✅ 已对齐。**

已完成：

- workflow final attachment summary 已改为：

```js
transferSemanticContent({
  scenario: "workflow",
  strategy: "workflow_final_return",
  ...
})
```

- 不再复用标准调用里的 `scenario: "subagent"`。
- 结果会合并 `transferResult / transferEnvelope / transferEnvelopes` 后回填到 workflow message/payload。
- workflow 主 payload、workflow turn message、`nodeSessions` 不再输出 `attachmentMetas` mirror；附件路径块改为优先基于 `transferEnvelopes` 生成。
- 当运行环境未提供 semantic-transfer、只能走旧 `generatedArtifactPersister` 时，返回的附件 metas 会先转换为标准 semantic-transfer envelope，再进入 workflow 后续链路，避免重新依赖 `attachmentMetas` mirror。

### 3.4 harness 阶段消息

**整改后状态：✅ 已对齐。**

已完成：

- harness capability output / 阶段明细保存附件已改为：

```js
transferSemanticContent({
  scenario: "harness",
  strategy: "harness_stage_message",
  ...
})
```

- 摘要、明细解析仍在 harness 插件侧。
- semantic-transfer 负责附件落盘、引用生成和标准语义 payload。
- 外部不再直接暴露 `processStageMessage(...)`。

### 3.5 harness 小结注入

**整改后状态：✅ 已对齐。**

已对齐内容：

- 默认未开启明细附件参数时，harness 会将 `rawSummaryText` 作为 `summary` relay 注入主 agent。
- `rawSummaryText` 包含 `[SUMMARY_OVERVIEW]`、`[SUMMARY_DETAIL]` 等小结全量内容。
- `summaryFullText` 保存完整小结。
- `summaryText` 仅保存 overview/摘要用于内部累计。
- 已有测试覆盖：`guidance-summary-detail-inject.test.js` 中 `inject-mode summary defaults to injecting full summary to main agent without attachment`。
- semantic-transfer 统一入口已提供 `harness_summary_injection` 策略，支持默认 `full` 与显式 `summary` 注入模式。
- inject 模式小结主流程已通过 `transferSummaryInjectionMessage(...)` 调用 `harness_summary_injection`。
- separate_model 小结主流程已通过 `transferSummaryInjectionMessage(...)` 调用 `harness_summary_injection`。

当前实际参数：

- `meta.harness.summaryDetailSaveToAttachment`
- `meta.harness.saveSummaryDetailToAttachment`

已完成：

```js
transferSemanticContent({
  scenario: "harness",
  strategy: "harness_summary_injection",
  injectMode: "full" | "summary",
  ...
})
```

- 默认 `full` 语义保持不变。
- 现有附件模式已映射为 `summary` 注入模式。
- 大文本部分仍可保存为附件，主 agent 注入消息按 `injectMode` 生成。
- separate_model / summary detail path 等 harness relay 的附件引用已改为通过 `transferPayload` / `transferEnvelope(s)` 注入；不再在 relay message 上新增 `attachmentMetas` mirror。

### 3.6 harness 最终消息

**整改后状态：✅ 已对齐。**

已完成：

- 最终输出保留主流程结果。
- 最终输出拼接最后一次完整小结，且 `summaryFullText` 优先。
- 最终输出拼接验收单/验收检查结果。
- harness final 已改为统一入口：

```js
transferSemanticContent({
  scenario: "harness",
  strategy: "harness_final_message",
  ...
})
```

- 不再调用 `transferSemanticContentSync(...)` 或 `composeFinalMessage(...)` 作为外部 sharedTools API。
- 统一入口返回标准 transfer 语义结果，并附带 `finalMessage` 供 harness 回填最终 assistant 消息。
- final output 附加验收 checklist artifacts 时，最终 assistant turn / result 不再新增 `attachmentMetas` mirror；附件引用通过 `transferEnvelope(s)` 写回。
- 已有测试覆盖：`acceptance-report-summary-paths.test.js` 中 `before_final_output prepends latest complete summary before acceptance checklist`。

## 4. 标准返回与 legacy 整改

### 4.1 去 legacy / compat 字段

**整改后状态：🟡 部分完成。**

本轮已完成：

- workflow `subSession.result` 不再追加 `attachmentMetas` mirror。
- workflow 最后一条子消息不再追加 `attachmentMetas` mirror。
- workflow 主 `workflowPayload` 不再输出 `attachmentMetas` mirror。
- workflow `nodeSessions[]` 不再输出 `attachmentMetas` mirror。
- workflow turn message 不再输出 `attachmentMetas` mirror。
- workflow 附件路径块优先从 `transferEnvelope(s).files[].attachmentMeta/pathView` 解析。
- workflow fallback persister 产物已转为标准：
  - `transferResult`
  - `transferEnvelope`
  - `transferEnvelopes`
- harness relay 注入（planning refinement、planning revision、summary detail path、guidance/separate_model relay）已改为优先传递标准 `transferPayload`，不再依赖 relay message 的 `attachmentMetas` mirror。
- harness final output 附加验收附件时，最终 assistant turn / result 不再写入 `attachmentMetas` mirror；测试已验证 checklist artifacts 从 `transferEnvelopes` 获取，且 `finalAssistant.attachmentMetas === undefined`。
- agent 运行时附件追加逻辑 `appendAttachmentMetasToRuntimeAndTurn(...)` 已加白名单：只有 `semantic_transfer_*`、`workflow_*`、`harness_*`、`tool_result_overflow`、工具输入过长等三类授权场景产物才转换/合并为标准 `transferEnvelope(s)`；普通附件（如 `llm_output`、`multimodal_generate_tool`、`email_connector_read`、`async_subtask_result`）继续作为普通 `attachmentMetas`，不再越权伪装为 semantic-transfer。
- agent finalizer 已改为授权场景白名单消费 transfer/legacy metas：只提升 semantic-transfer 授权场景的附件；普通模型/工具/connector 附件不会被提升为 `transferEnvelope(s)`。
- semantic-transfer public index 已停止 re-export `persistTransferArtifacts(...)`、`persistTransferFile(...)`、`materializeOutput(...)`、`materializeOutputResult(...)`；这些仅作为 semantic-transfer 内部存储实现细节存在。
- detached sub-session 快照中的用户输入附件已从通用 `attachmentMetas` mirror 收敛为 `inputAttachmentMetas`，明确其为输入附件上下文，而不是 semantic-transfer 输出。
- agent 正常入口建上下文 payload 已收敛为 `inputAttachmentMetas`：`SessionExecutionRunner` 会把本轮用户输入附件作为 `inputAttachmentMetas` 传给 `prepareAgentTurnExecution`，不再在建上下文 payload 上新增 `attachmentMetas` mirror；`BEFORE_AGENT_DISPATCH` hook context 同步提供 `inputAttachmentMetas`；`SessionExecutionEngine` 与 `AgentRuntimeFacade` 会继续向下透传到 `AgentContextFactory` / `ContextBuilder`。
- detached sub-session context payload 也已移除 `attachmentMetas` mirror，只传递 `inputAttachmentMetas`。
- runtime 已将用户输入附件与运行时生成附件分离：`runtime.inputAttachmentMetas` 保存输入附件；`runtime.attachmentMetas` 初始化为空，仅作为运行时生成普通附件的 mutable bucket，不再镜像输入附件。
- context 构建链路已引入 `inputAttachmentMetas` 作为输入附件语义字段；`AgentContextFactory`、detached sub-session context payload、`resolveAttachments(...)`、`composeSystemInfoSections(...)`、`buildRuntimeContext(...)`、主模型 message-builder 用户 meta 都会优先使用 `inputAttachmentMetas`；`attachmentMetas` 只作为旧调用方读取 fallback 或持久化普通附件协议存在。
- session replay message converter 不再为空附件/空 transfer 生成 `attachmentMetas: []` / `transferEnvelope: null` / `transferEnvelopes: []` mirror，仅在确有内容时保留。
- `SessionTurnPersister` 对最终 assistant message 会持久化标准 `transferEnvelope(s)`；对中间 tool message 仍不持久化 transfer payload，避免中间大结果污染会话。

当前保留的兼容边界包括：

- harness 注入工具层仍保留 `legacyAttachmentMetasMirror` 开关和 `attachmentMetas` 入参兼容，但默认不开启；当前 harness 标准调用不再输出该 mirror。
- agent 输入附件、上下文构建、系统提示 formatter、主模型 user meta 已引入 `inputAttachmentMetas` 优先路径；正常会话入口、detached sub-session 快照、子会话上下文 payload、`SessionExecutionEngine` 与 `AgentRuntimeFacade` 均已补充并优先传递 `inputAttachmentMetas`；`attachmentMetas` 入参仅保留为旧调用方读取 fallback。
- 旧的直接 `path / filePath / relativePath` 协议不再作为 semantic-transfer 标准输出扩散；compact payload 会筛选为标准 `transferFiles[]` 字段。普通附件持久化/展示协议中仍允许 `path / relativePath`，但不得输出 `noobot.semantic-transfer` envelope。
- 部分消费端仍兼容 legacy-like 输入；空 mirror 输出已在 session replay converter 中收敛。

整改要求：

- semantic-transfer 授权场景的标准输出中不再新增或依赖 legacy 字段；普通附件场景不得为了“去 legacy”而改走 semantic-transfer。
- 短期可保留内部读取兼容，但不能作为新的标准输出协议。
- 最终阶段只保留 semantic-transfer 标准语义返回：
  - `transferResult`
  - `transferEnvelope`
  - `transferEnvelopes`
  - 必要的 compact payload
- 非三类授权场景必须停留在附件/业务自己的协议里，不允许输出 `noobot.semantic-transfer` envelope。
- 具体禁止越权示例：email connector 附件保存、agent-collab 异步子任务普通结果附件保存、多模态生成工具图片附件保存、LLM output media 附件保存，均不得为了“去 legacy”或“统一附件”而改走 semantic-transfer；后续若要扩展，必须先回到 `semantic-transfer-raw-notes.md` 明确新增授权场景。

### 4.2 返回值精简

**整改后状态：✅ 已对齐。**

已完成：

- 多数 transfer 场景已经提供 compact payload，如 `compactTransferPayload`、`compactToolPayload`。
- compact payload 长期字段集合已代码化：
  - 顶层标准字段：`transferFiles`；
  - `transferFiles[]` 标准字段：`attachmentId`、`sessionId`、`attachmentSource`、`name`、`mimeType`、`size`、`relativePath`、`sandboxPath`、`generatedByModel`、`generationSource`、`parsedResultAttachmentId`、`parsedResultRelativePath`、`parsedResultTool`、`transferFilePath`、`role`。
- `compactTransferPayloadForModel(...)` 会按上述字段集合筛选文件项，避免把 envelope 内部字段、host path 或普通附件兼容字段重新扩散到模型 compact payload。
- harness final 不再只返回字符串，统一入口返回标准 transfer 语义结果，并附带 `finalMessage`。
- tool/workflow/harness 的旧 wrapper 名称已从源码使用中移除；后续如果继续重构，应优先处理策略实现文件边界，而不是重新暴露 wrapper。

剩余：

- compact payload 如需新增字段，必须先更新 `COMPACT_TRANSFER_PAYLOAD_FIELDS` / `COMPACT_TRANSFER_FILE_FIELDS` 并补测试，不能隐式透传 envelope 或普通附件对象。

## 5. 边界整改

**整改后状态：✅ 基本对齐。**

已对齐内容：

- workflow 的拓扑计算、下游节点选择、执行推进仍在 workflow 编排层。
- harness 的摘要/明细解析、验收单生成仍在 harness 插件层。
- 工具执行、参数校验、业务失败判断仍在工具层。
- semantic-transfer 主要负责三类授权场景内的：
  - 信息转换；
  - 附件落盘/引用生成；
  - 注入消息 payload 生成；
  - 标准语义返回。
- 非三类授权场景已继续收口：
  - 多模态生成工具的图片附件保存：回退到 `attachmentService.ingestGeneratedArtifacts(...)`；
  - email connector 附件保存：回退到 `attachmentService.ingestGeneratedArtifacts(...)`，且不再把 connector stdout 中的 transfer-like 字段提升为顶层 semantic-transfer 输出；
  - agent-collab 普通异步子任务结果附件保存：回退到 `attachmentService.ingestGeneratedArtifacts(...)`，后续若明确属于 workflow 子 agent 结果流转再单独评估接入。
- `check:semantic-transfer-compat` 已把上述普通附件保存文件列入防回归检查，禁止重新调用 `persistTransferArtifacts(...)` / `persistTransferFile(...)` / `materializeOutput*()`，也禁止在这些普通附件链路重新调用 `transferSemanticContent(...)` / `runtime.sharedTools.semanticTransfer` 或输出 `noobot.semantic-transfer` envelope；同时新增已移除 wrapper API 防回归检查，源码中禁止重新引入 `transferSemanticContentSync(...)`、`transferToolMessage(...)`、`transferSubAgentMessages(...)`、`processStageMessage(...)`、`composeFinalMessage(...)`。

剩余：

- 非 `semantic-transfer-raw-notes.md` 授权场景不应扩展进 semantic-transfer。
- 已出现的越权实现需要继续保持收敛。

## 6. 验证结果

已运行：

```bash
node plugin/noobot-plugin-workflow/__tests__/workflow-hook-session-strategy.test.js
node --test agent/__tests__/system-core/semantic-transfer/semantic-transfer.test.js agent/__tests__/system-core/context/runtime-environment-builder.test.js plugin/noobot-plugin-harness/__tests__/acceptance-report-summary-paths.test.js plugin/noobot-plugin-harness/__tests__/guidance-summary-detail-inject.test.js plugin/noobot-plugin-workflow/__tests__/workflow-hook-session-strategy.test.js
npm -w plugin/noobot-plugin-harness test
npm -w agent test
npm test
npm -w agent test -- __tests__/system-core/attach/runtime-attachment.test.js __tests__/system-core/bot-manage/session-execution-finalizer-transfer.test.js __tests__/system-core/bot-manage/session-turn-persister-sanitizer.test.js __tests__/system-core/semantic-transfer/semantic-transfer.test.js __tests__/system-core/context/runtime-environment-builder.test.js
npm -w plugin/noobot-plugin-workflow test
npm -w plugin/noobot-plugin-harness test -- __tests__/acceptance-report-summary-paths.test.js __tests__/harness-optimization.test.js __tests__/harness-review-acceptance.test.js
npm run check:semantic-transfer-compat
npm -w agent test -- __tests__/system-core/tools/connector-toolkit.test.js __tests__/system-core/tools/model-tool.test.js __tests__/system-core/tools/agent-collab-wait.test.js __tests__/system-core/tools/agent-collab-delegate-wait-flow.test.js
npm -w agent test -- __tests__/system-core/attach/runtime-attachment.test.js __tests__/system-core/bot-manage/session-execution-finalizer-transfer.test.js __tests__/system-core/bot-manage/session-closure-flow.test.js __tests__/system-core/semantic-transfer/semantic-transfer.test.js __tests__/system-core/context/runtime-environment-builder.test.js __tests__/system-core/tools/connector-toolkit.test.js __tests__/system-core/tools/model-tool.test.js __tests__/system-core/tools/agent-collab-wait.test.js __tests__/system-core/tools/agent-collab-delegate-wait-flow.test.js
cd agent && node --test --test-force-exit __tests__/system-core/bot-manage/detached-subsession-runner.test.js __tests__/system-core/context/message-converter-transfer.test.js __tests__/system-core/context/data-providers.test.js __tests__/system-core/context/context-builder-normalization.test.js __tests__/system-core/context/runtime-environment-builder.test.js
cd agent && node --test --test-force-exit __tests__/system-core/context/context-builder-normalization.test.js __tests__/system-core/context/data-providers.test.js __tests__/system-core/context/system-prompt-formatter.test.js __tests__/system-core/context/runtime-environment-builder.test.js
cd agent && node --test --test-force-exit __tests__/system-core/context/context-builder-normalization.test.js __tests__/system-core/context/data-providers.test.js __tests__/system-core/context/system-prompt-formatter.test.js __tests__/system-core/context/runtime-environment-builder.test.js __tests__/system-core/bot-manage/detached-subsession-runner.test.js
cd agent && node --test --test-force-exit __tests__/system-core/attach/runtime-attachment.test.js __tests__/system-core/bot-manage/session-execution-finalizer-transfer.test.js __tests__/system-core/bot-manage/session-closure-flow.test.js __tests__/system-core/semantic-transfer/semantic-transfer.test.js __tests__/system-core/tools/connector-toolkit.test.js __tests__/system-core/tools/agent-collab-delegate-wait-flow.test.js
cd agent && node --test --test-force-exit __tests__/system-core/agent/core/runtime/agent-runtime-facade.test.js __tests__/system-core/bot-manage/execution/runner-bot-hook.test.js __tests__/system-core/bot-manage/detached-subsession-runner.test.js __tests__/system-core/bot-manage/session-execution-engine-runtime-ref.test.js __tests__/system-core/context/context-builder-normalization.test.js __tests__/system-core/context/data-providers.test.js __tests__/system-core/context/system-prompt-formatter.test.js __tests__/system-core/context/runtime-environment-builder.test.js __tests__/system-core/bot-manage/session-closure-flow.test.js
cd agent && node --test --test-force-exit __tests__/system-core/semantic-transfer/semantic-transfer.test.js __tests__/system-core/context/runtime-environment-builder.test.js
```

结果：

- 定向 agent / workflow / harness 相关测试与 `check:semantic-transfer-compat`：通过。
- 全 workspace `npm test`：历史记录中曾通过；本次使用跨 workspace 路径过滤参数试跑时，因 service / client workspace 也接收到不属于自身的测试路径导致过滤失败，不作为本次整改验证结论。

覆盖范围包括：

- agent semantic-transfer 测试；
- runtime sharedTools 暴露面测试；
- 工具输入/输出长度保护测试；
- harness 小结注入与最终验收输出测试；
- harness relay / final output 附件改走 `transferEnvelope(s)`，并验证不再新增 `attachmentMetas` mirror；
- workflow 子agent 与最终附件摘要流转测试；
- workflow 无 semantic-transfer fallback persister 场景下，仍通过标准 `transferEnvelope(s)` 生成最终附件路径块，并验证 workflow 主输出不再写 `attachmentMetas` mirror；
- agent runtime attachment、finalizer、turn persister 已覆盖：生成附件提升为 `transferEnvelope(s)`，当前 turn 已有 transfer payload 时会继续合并新附件到 `transferEnvelopes`，最终 assistant 不再新增 `attachmentMetas` mirror，中间 tool transfer 不持久化；
- semantic-transfer compat guard；本轮已加严 out-of-scope 文件检查，普通附件链路不得重新引用 semantic-transfer 入口/API 或直接输出 `noobot.semantic-transfer` envelope，并新增 removed wrapper API 防回归检查；旧 wrapper 名称已不再在源码中使用；
- out-of-scope 附件保存收口测试：email connector、agent-collab async task、multimodal/model tool 相关 agent 测试；
- detached sub-session 快照不再输出 `attachmentMetas` mirror，改用 `inputAttachmentMetas`；
- session replay converter 不再输出空 legacy mirrors；
- context/provider/formatter/message-builder 已新增 `inputAttachmentMetas` 优先路径并覆盖 fallback 行为。
- 正常会话入口到 runtime facade 的 `inputAttachmentMetas` 透传已覆盖：`SessionExecutionRunner` buildContextPayload、`BEFORE_AGENT_DISPATCH` hook context、`SessionExecutionEngine` 与 `AgentRuntimeFacade`；建上下文 payload 与 detached sub-session payload 不再新增 `attachmentMetas` mirror。
- runtime 用户输入附件与运行时生成附件已分离：输入保存在 `inputAttachmentMetas`，生成附件才进入 `attachmentMetas`。

## 7. 后续剩余工作

当前文档列出的可整改项已完成。后续只保留以下维护约束：

1. `attachmentMetas` 只能作为旧调用方读取 fallback、会话持久化普通附件字段、运行时生成普通附件 bucket 使用；不得在 semantic-transfer 标准输出或建上下文新入口中重新作为 mirror 输出。
2. compact payload 的长期标准字段集合已代码化；后续新增字段需同步更新常量与测试，不能隐式透传 envelope、host path 或普通附件对象。
3. 旧 wrapper 名称与 tool 场景 `direction` / `transferMode` 适配已移除，`direction` 仅作为 envelope 字段保留；后续不得重新暴露 wrapper API。
4. 非三类授权场景继续停留在 attachmentService / 业务协议，不得输出 `noobot.semantic-transfer` envelope。
