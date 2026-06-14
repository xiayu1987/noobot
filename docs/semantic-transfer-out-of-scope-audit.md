# Semantic-Transfer 非原始需求场景审计

> 来源：对照 `docs/semantic-transfer-raw-notes.md` 的边界澄清。
>
> 核心边界：**不是所有附件都走 semantic-transfer**。只有需要语义转换的信息流才走 semantic-transfer：
>
> 1. 工具信息传递：工具输出超限 / 工具输入超限。
> 2. workflow 子 agent 信息流转：子 agent 最终输出转附件，并由 workflow 插件注入下游。
> 3. harness 消息管理：阶段摘要/明细处理、最终消息拼接。
>
> 普通附件保存、模型生成附件、连接器附件等，如果只是“保存附件”，不应因为涉及附件就走 semantic-transfer。

---

## 1. 当前偏离边界的主要场景

### 1.1 通用 generated artifacts 保存

- 状态：**已收口**
- 文件：`agent/src/system-core/bot-manage/session/scoped-artifact-persistence-helpers.js`
- 当前调用：`attachmentService.ingestGeneratedArtifacts(...)`
- 当前用途：通用 generated artifact persister，把生成物保存为附件，再取 attachment metas。
- 判断：**已从 semantic-transfer 回退到 attachment service**。
- 收口要求：该场景不得重新调用 `persistTransferArtifacts(...)` / `persistTransferFile(...)` / `materializeOutput*()`；由 `check:semantic-transfer-compat` 兜底防回归。

---

### 1.2 LLM 输出媒体附件保存

- 状态：**已收口**
- 文件：`agent/src/system-core/agent/core/media/artifact-service.js`
- 当前调用：`attachmentService.ingestGeneratedArtifacts(...)`
- 当前用途：把 assistant/model 输出里的远程图片、视频等媒体资源保存成附件。
- 判断：**已从 semantic-transfer 回退到 attachment service**。
- 说明：本文件仍可消费工具结果中的标准 transfer envelope（例如提取工具产物附件元信息），但 LLM 媒体附件保存本身不得走 semantic-transfer 持久化入口。
- 收口要求：该场景不得重新调用 `persistTransferArtifacts(...)` / `persistTransferFile(...)` / `materializeOutput*()`；由 `check:semantic-transfer-compat` 兜底防回归。

---

### 1.3 多模态生成工具的图片附件保存

- 状态：**已收口**
- 文件：`agent/src/system-core/tools/ai-models/multimodal-generate-tool.js`
- 当前调用：`attachmentService.ingestGeneratedArtifacts(...)`
- 当前用途：图片生成工具生成图片后保存附件。
- 判断：**已从 semantic-transfer 回退到 attachment service**。
- 说明：它不是“工具原始返回超限后保存附件”，而是生成图片附件持久化；后续如需处理返回给模型的文本结果超限/转换，再按工具信息传递策略走 `transferSemanticContent({ scenario: "tool", strategy: ... })`。
- 收口要求：该场景不得重新调用 `persistTransferArtifacts(...)` / `persistTransferFile(...)` / `materializeOutput*()`；由 `check:semantic-transfer-compat` 兜底防回归。

---

### 1.4 email connector 附件保存

- 状态：**已收口**
- 文件：`agent/src/system-core/tools/connectors/connector-toolkit/tool-access-connector.js`
- 位置：`buildEmailAttachmentHandler()`
- 当前调用：`attachmentService.ingestGeneratedArtifacts(...)`
- 当前用途：email connector 读取邮件附件并保存为系统附件。
- 判断：**已从 semantic-transfer 回退到 attachment service**。
- 原因：这是 connector/email 附件持久化，不属于工具输入/输出超限转换、workflow 子 agent 流转或 harness 消息管理。
- 收口要求：该场景不得重新调用 `persistTransferArtifacts(...)` / `persistTransferFile(...)` / `materializeOutput*()`；connector 工具的文本返回超限时，再按工具输出 semantic-transfer 策略处理。

---

### 1.5 agent-collab 异步子任务结果附件保存

- 状态：**已按普通异步任务结果附件保存收口**
- 文件：`agent/src/system-core/tools/workflow/agent-collab/collab-artifact-persist.js`
- 当前调用：`attachmentService.ingestGeneratedArtifacts(...)`
- 当前用途：async subtask / agent-collab 的子任务结果保存成附件。
- 判断：**普通 agent-collab / async task 附件保存不走 semantic-transfer**。
- 原因：原始需求指向的是 workflow 插件子 agent 信息流转，不是所有 agent-collab / async task 附件保存。
- 后续评估：如果某条 agent-collab 链路被明确归类为“workflow 子 agent 最终结果流转”，再通过 `transferSemanticContent({ scenario: "workflow", strategy: "workflow_subagent_result", ... })` 接入；在此之前保持普通附件保存。
- 收口要求：该场景不得重新调用 `persistTransferArtifacts(...)` / `persistTransferFile(...)` / `materializeOutput*()`；由 `check:semantic-transfer-compat` 兜底防回归。

---

### 1.6 通用 final assistant transfer 聚合/提升

- 状态：**已收口**
- 文件：`agent/src/system-core/bot-manage/execution/finalizer.js`
- 当前调用：`getTransferAttachmentMetas(...)`（仅消费已有 envelope）
- 当前用途：从消息里的 transfer envelopes 中提取附件，并提升/合并到最终 assistant 消息。
- 判断：**已加授权场景白名单**。
- 说明：finalizer 不再把 semantic-transfer 当成通用附件聚合协议；只有 `semantic_transfer_*`、`workflow_*`、`harness_*`、`tool_result_overflow`、工具输入过长等授权 generationSource 会被提升。普通 `llm_output` / `multimodal_generate_tool` / `email_connector_read` / `async_subtask_result` 不会被转换为 semantic-transfer envelope。

---

## 2. 根因

历史上 `runtime.sharedTools.semanticTransfer` / semantic-transfer public index 暴露过宽，曾容易把以下内部能力当普通业务 API 使用：

```js
persistTransferArtifacts
persistTransferFile
materializeOutput
materializeOutputResult
getTransferFiles
getTransferAttachmentMetas
resolveTransferFilePath
```

当前已收敛：`sharedTools.semanticTransfer` 仅暴露 `transferSemanticContent(...)`，public index 不再 re-export persist/materialize 类 API。历史问题的根因是这些 API 让业务代码容易把 semantic-transfer 当成：

```text
通用附件保存 + 附件路径解析工具
```

而不是原始需求里的：

```text
仅负责三类指定场景的信息转换层
```

---

## 3. 不算偏离的场景

以下属于原始需求授权范围，不应作为问题处理：

### 3.1 工具输入超限

- 文件：
  - `agent/src/system-core/tools/execution/file-tool.js`
  - `agent/src/system-core/tools/execution/script-tool.js`
- 调用：`transferToolMessage({ direction: "input" })`
- 判断：**对齐**。

### 3.2 工具输出超限 / 工具结果 compact

- 文件：
  - `agent/src/system-core/agent/core/execution/tool-runner.js`
  - `agent/src/system-core/semantic-transfer/tool-result-text.js`
- 判断：**对齐**。

### 3.3 data-processing 工具文本结果处理

- 文件：
  - `agent/src/system-core/tools/data-processing/doc2data-tool.js`
  - `agent/src/system-core/tools/data-processing/media2data-tool.js`
  - `agent/src/system-core/tools/data-processing/web2data-tool.js`
- 判断：**基本对齐**。
- 原因：这些属于工具输出文本内容转换/超限处理。

### 3.4 workflow 插件子 agent 输出流转

- 文件：`plugin/noobot-plugin-workflow/src/core/hooks.js`
- 调用：`transferSubAgentMessages(...)`
- 判断：**对齐**。
- 注意：fallback 里直接调用 `persistTransferFile` 的路径后续可收窄。

### 3.5 harness 阶段消息 / 最终拼接

- 文件：
  - `plugin/noobot-plugin-harness/src/capabilities/handlers/shared/attachment-log-utils.js`
  - `plugin/noobot-plugin-harness/src/capabilities/handlers/acceptance/output-finalizer.js`
- 调用：
  - `processStageMessage(...)`
  - `composeFinalMessage(...)`
- 判断：**对齐**。
- 注意：harness 中若只是普通附件保存，不应直接使用 `persistTransferFile/persistTransferArtifacts`。

---

## 4. 收口建议

### 4.1 对外只保留语义入口

建议插件/业务层只使用以下 semantic-transfer 方法：

```js
transferToolMessage
transferSubAgentMessages
processStageMessage
composeFinalMessage
compactTransferPayloadForModel
```

### 4.2 将持久化 API 降为内部实现细节

以下方法可保留在 semantic-transfer 内部，但不建议暴露给普通业务层作为公共 API：

```js
persistTransferArtifacts
persistTransferFile
materializeOutput
materializeOutputResult
```

### 4.3 普通附件保存回到 attachmentService

普通附件保存应直接使用：

```js
attachmentService.ingestGeneratedArtifacts(...)
```

### 4.4 finalizer 按白名单消费 transfer

finalizer 如需处理 transfer envelope，应按原始需求场景白名单判断，而不是无差别聚合所有 transfer envelope。

---

## 5. 待办清单

- [x] `scoped-artifact-persistence-helpers.js`：通用 generated artifacts 保存从 `persistTransferArtifacts` 回退到 `attachmentService.ingestGeneratedArtifacts(...)`。
- [x] `artifact-service.js`：LLM 输出媒体附件保存从 semantic-transfer 收回。
- [x] `multimodal-generate-tool.js`：图片生成附件保存已回退到普通附件服务；是否属于工具语义转换留待后续单独评估。
- [x] `tool-access-connector.js`：email connector 附件保存从 semantic-transfer 收回。
- [x] `collab-artifact-persist.js`：当前按“普通异步结果附件保存”回退到 attachmentService；是否存在应归入 workflow 子 agent 流转的链路留待后续评估。
- [x] `finalizer.js`：transfer 消费改为授权场景白名单，不做全局 transfer 附件提升。
- [x] `runtime-environment-builder.js`：已收窄 `sharedTools.semanticTransfer` 暴露面，仅保留 `transferSemanticContent(...)`；public index 也不再 re-export persist/materialize 类方法。

---

## 6. 当前仍直接走附件服务的场景

> 本节记录“没有走 semantic-transfer、仍按附件系统处理”的当前路径。它们原则上应继续保持附件语义，不应因为涉及附件而迁入 semantic-transfer，除非后续明确属于三类信息转换场景。

### 6.1 用户输入附件 ingest

- 文件：`agent/src/system-core/context/providers/attachment-resolver.js`
- 当前调用：`attachmentService.ingest(...)`
- 当前用途：把本轮用户传入的附件元信息/原始附件解析为运行时可用 attachment metas。
- 判断：**应直接走附件系统**。
- 原因：这是用户原始附件进入上下文，不是 semantic-transfer 的信息转换。

---

### 6.2 附件服务自身的生成物保存能力

- 文件：`agent/src/system-core/attach/service/attachment-service.js`
- 当前能力：
  - `ingestGeneratedArtifacts(...)`
  - `ingestModelGeneratedArtifacts(...)`
- 当前用途：附件服务的基础保存能力，负责把生成物写入附件目录并产出 attachment records/metas。
- 判断：**应作为底层附件能力保留**。
- 说明：semantic-transfer 内部可以在三类授权转换场景中调用它，但业务层普通附件保存也应直接调用它，而不是绕到 semantic-transfer。

---

### 6.3 data-processing 工具对源附件的 parsed-result 回写

- 文件：
  - `agent/src/system-core/tools/data-processing/doc2data-tool.js`
  - `agent/src/system-core/tools/data-processing/media2data-tool.js`
- 当前调用：`attachmentService.linkParsedResultToAttachment(...)`
- 当前用途：把解析后的结果附件信息回写到源附件记录上，例如记录 `parsedResultAttachmentId` / `parsedResultRelativePath`。
- 判断：**应直接走附件系统**。
- 原因：这是附件元数据关联/回写，不是信息转换本身。解析结果内容是否走 semantic-transfer 是另一层逻辑；源附件 backlink 应属于 attachment service。

---

### 6.4 runtime / turn 内 attachmentMetas 合并与传播

- 文件：
  - `agent/src/system-core/attach/runtime-attachment.js`
  - `agent/src/system-core/agent/core/execution/state-committer.js`
- 当前能力：`appendAttachmentMetasToRuntimeAndTurn(...)`
- 当前用途：把附件 metas 合并进 runtime、当前 turn message store、事件流等。
- 判断：**应直接保持附件元数据语义**。
- 原因：这是运行时附件状态维护，不是 semantic-transfer 信息转换。
- 注意：如果来源是 semantic-transfer 产物，可以把 transfer 产出的 attachment metas 映射进这里；但该模块不应反过来变成 semantic-transfer 入口。

---

### 6.5 session message / turn 持久化里的 attachmentMetas

- 文件：
  - `agent/src/system-core/session/services/session-message-service.js`
  - `agent/src/system-core/session/entities/session-entity.js`
  - `agent/src/system-core/context/session/message-converter.js`
  - `agent/src/system-core/bot-manage/execution/turn-persister.js`
- 当前用途：在会话消息、turn 记录、回放转换中保留/过滤 attachment metas。
- 判断：**应直接属于会话附件元数据持久化**。
- 原因：这是历史消息与 UI/回放层的附件字段，不是 semantic-transfer 信息转换。
- 注意：后续若去 legacy，需要明确 UI/session schema 如何表达普通附件；不能简单把所有 `attachmentMetas` 都替换为 `transferEnvelopes`。

---

### 6.6 bot manager 附件查询与删除

- 文件：`agent/src/system-core/bot-manage/index.js`
- 当前调用：
  - `this.attach.getAttachmentById(...)`
  - `this.attach.deleteScopedAttachmentsBySessionIds(...)`
- 当前用途：附件查询、session 范围附件清理。
- 判断：**应直接走附件系统**。
- 原因：这是附件生命周期管理，不是信息转换。

---

### 6.7 harness 在 semantic-transfer 不可用时的附件 fallback

- 文件：
  - `plugin/noobot-plugin-harness/src/capabilities/handlers/shared/attachment-log-utils.js`
  - `plugin/noobot-plugin-harness/src/capabilities/handlers/acceptance/output-finalizer.js`
- 当前调用：`attachmentService.ingestGeneratedArtifacts(...)`
- 当前用途：当 runtime 未提供 semantic-transfer 持久化能力时，harness 把阶段明细/验收清单保存为附件。
- 判断：**作为 fallback 可以存在，但主路径应按语义区分**。
- 说明：
  - harness 阶段明细/最终验收清单属于原始需求范围，主路径可以走 `processStageMessage(...)` / `composeFinalMessage(...)`。
  - 但 fallback 直接走附件服务是合理兜底，不代表普通附件都应迁入 semantic-transfer。

---

### 6.8 纯附件展示、路径格式化、上下文注入

- 文件：
  - `agent/src/system-core/context/formatters/system-prompt-formatter.js`
  - `agent/src/system-core/agent/core/context/message-builder.js`
  - `plugin/noobot-plugin-workflow/src/core/hooks.js` 中的用户输入附件规划/注入相关逻辑
  - `plugin/noobot-plugin-harness/src/capabilities/handlers/shared/sandbox-path.js`
- 当前用途：把已有 attachment metas 渲染成模型可读路径、系统提示或消息内容。
- 判断：**普通用户附件/已有附件应直接按附件语义处理**。
- 注意：如果输入是 semantic-transfer 的 envelope，可由消费侧解析；但普通附件展示不应强制包装成 transfer envelope。

---

## 7. 直接附件路径的保留原则

1. **用户原始附件**：直接 attachment，不走 semantic-transfer。
2. **普通生成物附件**：直接 attachment，除非它是三类授权场景中的“转换结果”。
3. **附件元数据维护**：直接 attachment，例如 session 持久化、runtime 合并、source attachment backlink。
4. **附件生命周期管理**：直接 attachment，例如查询、删除、清理。
5. **semantic-transfer 只消费必要附件能力**：semantic-transfer 可以作为转换层调用底层 attachment service，但不应替代 attachment service 成为通用附件 API。

---

## 8. 附件保存与 semantic-transfer 的严格边界定义

> 核心原则：**attachment service 负责“存储事实”；semantic-transfer 负责“链路语义转换”。**
>
> 只要任务本质是“把某个文件/内容保存起来”，就是附件系统。
> 只有当任务本质是“为了跨模型/工具/子 agent/harness 阶段传递信息，需要把内容转换成 direct 或 file reference 表达”，才是 semantic-transfer。

### 8.1 一句话边界

#### attachment service

负责：

```text
内容/文件/二进制 -> 附件记录
```

它回答的是：

```text
这个东西保存在哪里？附件 ID 是什么？大小、MIME、路径是什么？
```

#### semantic-transfer

负责：

```text
待传递信息 -> 语义传递结果
```

它回答的是：

```text
这段信息应该直接塞进消息里，还是转成附件引用？
如果转成附件引用，下游应该怎样理解这个引用？
```

---

### 8.2 判断标准

#### 问题 1：这个内容是否要进入“模型 / agent / tool / plugin 之间的信息流”？

如果不是，只是保存、查询、展示、删除文件：

```text
走 attachment service
```

例如：

- 用户上传附件入库。
- 邮件附件保存。
- 图片生成结果保存。
- 会话附件清理。
- 附件元数据回写。
- UI 展示附件列表。

这些不应该走 semantic-transfer。

---

#### 问题 2：是否存在“传递策略”？

所谓传递策略包括：

```text
内容短 -> 直接返回 direct
内容长 -> 保存附件并返回引用
强制附件化 -> 返回 file reference
返回给模型前 compact
```

如果有这种策略，才可能是 semantic-transfer。

例如：

- 工具输出过长，不能直接塞回模型上下文。
- 工具输入过长，需要保存为附件引用。
- 子 agent 最终输出必须传给下游子 agent。
- harness 小结明细不能直接注入主链路，只注入摘要 + 附件引用。

这些走 semantic-transfer。

---

#### 问题 3：附件是否只是“最终产物”？

如果附件本身就是最终产物，不是为了缩短、转换、传递信息流：

```text
走 attachment service
```

例如：

- `multimodal_generate` 生成图片。
- email connector 拉取邮件附件。
- LLM 输出图片被保存。
- 普通 generated artifact。

这些是产物，不是 transfer。

---

#### 问题 4：附件是否是“某个 transfer 的承载介质”？

如果附件只是承载一段本来要传递的文本/结构化信息：

```text
走 semantic-transfer
```

例如：

- 工具返回 JSON 太大，保存成 `.json`。
- 子 agent 最终报告保存成 `.md`，给下游节点引用。
- harness 阶段明细保存成 `.md`，主 agent 只看到摘要和引用。
- 工具输入脚本太长，保存成 `.sh` 或 `.txt` 引用。

这里附件不是最终产物，而是**传递介质**。

---

### 8.3 semantic-transfer 的允许范围

当且仅当满足以下条件之一，才允许进入 semantic-transfer：

#### 1. 工具信息传递

- 工具输出需要按长度/策略转换为 direct 或 file transfer。
- 工具输入超过限制，需要保存为 transfer file 并返回引用。

#### 2. workflow 子 agent 信息流转

- 一个或多个子 agent 的最终输出需要传递给直接下游节点。
- 输出必须强制附件化。
- workflow 插件负责拓扑、next steps、注入；semantic-transfer 只产出 transfer payload。

#### 3. harness 消息管理

- 阶段消息的 detail 需要保存为附件，summary 留在主链路。
- 最终消息需要拼接 resultInfo、detailRefs、validationInfo。
- harness 业务解析在插件端，semantic-transfer 只做保存和转换。

除此之外，即使涉及附件保存，也必须走 attachment service，不得走 semantic-transfer。

---

### 8.4 明确不属于 semantic-transfer 的场景

以下一律不属于 semantic-transfer：

1. 用户上传附件 ingest。
2. 普通文件保存。
3. 普通 generated artifact 保存。
4. 模型生成图片、音频、视频作为最终产物保存。
5. email / connector 拉取的原始附件保存。
6. 附件查询、删除、清理。
7. 附件 metadata normalize / merge / persist。
8. session message 中保存 attachmentMetas。
9. UI 附件展示。
10. 源附件 parsedResult backlink 回写。

这些都属于 attachment service 或上下文 / session / UI 层。

---

### 8.5 边界模糊场景判定

#### 场景：工具生成图片

例如：

```text
multimodal_generate -> png 附件
```

判定：

- 图片是最终产物：走 attachment service。
- 工具返回文本结果太长：文本结果走 semantic-transfer。
- 图片附件本身不应包装成 semantic-transfer。

结论：

```text
图片保存 = attachment service
工具返回文本摘要/引用超限 = semantic-transfer
```

---

#### 场景：doc_to_data / media_to_data

判定：

- 解析文本是工具输出信息，要返回模型：可走 semantic-transfer。
- 源附件 backlink 更新：attachment service。
- 原始用户文件：attachment service。

结论：

```text
解析结果文本 = semantic-transfer
源文件/源附件元数据 = attachment service
```

---

#### 场景：email connector 读取邮件

判定：

- 邮件原始附件保存：attachment service。
- 邮件正文/摘要作为工具输出，如果过长：semantic-transfer。
- 附件列表展示：attachment service。

结论：

```text
邮件附件 = attachment service
邮件正文超限返回 = semantic-transfer
```

---

#### 场景：agent-collab / async task

判定：

- 如果是“子 agent 最终输出要传给另一个 agent / 主 agent”：semantic-transfer。
- 如果只是“把异步任务结果归档为附件”：attachment service。

结论：

```text
跨 agent 信息流转 = semantic-transfer
任务结果归档 = attachment service
```

---

#### 场景：finalizer 聚合附件

判定：

- 最终 assistant 消息附带普通生成附件：attachment metas。
- 对工具 overflow / workflow / harness transfer 结果做引用保留：可以消费 semantic-transfer。
- 不应该无差别把所有 transfer envelope 当成最终附件提升。

结论：

```text
普通附件提升 = attachment/session 层
transfer 结果保留 = 仅限白名单 semantic-transfer 场景
```

---

### 8.6 代码层硬规则

#### 规则 1：业务代码不能直接调用 semantic-transfer persist API

禁止业务层直接调用：

```js
semanticTransfer.persistTransferFile(...)
semanticTransfer.persistTransferArtifacts(...)
semanticTransfer.materializeOutput(...)
semanticTransfer.materializeOutputResult(...)
```

这些如果保留，也只能作为 semantic-transfer 内部实现。

业务层普通附件保存必须调用：

```js
attachmentService.ingestGeneratedArtifacts(...)
attachmentService.ingest(...)
attachmentService.linkParsedResultToAttachment(...)
```

---

#### 规则 2：业务代码只能调用语义入口

允许业务层调用：

```js
semanticTransfer.transferToolMessage(...)
semanticTransfer.transferSubAgentMessages(...)
semanticTransfer.processStageMessage(...)
semanticTransfer.composeFinalMessage(...)
```

也就是：

```text
方法名必须说明“哪类语义转换”
```

而不是泛泛地：

```text
persist / materialize / save
```

---

#### 规则 3：semantic-transfer 产物必须带 scenario/reason 白名单

semantic-transfer envelope 的 meta 中建议必须有：

```js
meta: {
  source,
  reason,
  semanticTransferScenario
}
```

其中 `semanticTransferScenario` 只能来自授权场景，例如：

```js
"tool_output_overflow"
"tool_input_overflow"
"workflow_subagent_result"
"harness_stage_detail"
"harness_final_composition"
```

这样 finalizer / consumer 可以按白名单处理，不会误吞普通附件。

---

#### 规则 4：普通附件不能伪装成 transfer envelope

普通附件只应该有：

```js
attachmentMetas
```

或附件记录。

不要为了统一结构把它包装成：

```js
transferEnvelope
```

除非它确实是三类语义转换的结果。

---

#### 规则 5：transfer envelope 内可以有附件信息，但不是附件主协议

semantic-transfer 可以返回：

```js
transferEnvelope.files[*].attachmentMeta
```

但这表示：

```text
这个附件是某次信息传递的承载文件
```

不是说：

```text
所有附件都应该变成 transferEnvelope.files
```

---

### 8.7 建议写入正式规范的定义

```text
Attachment Service Boundary:
- 管理附件的存储、索引、元数据、查询、删除、生命周期。
- 普通附件、用户附件、生成物附件、连接器附件、UI 展示附件均属于此层。

Semantic Transfer Boundary:
- 管理跨上下文信息传递时的表达转换。
- 只覆盖工具信息传递、workflow 子 agent 信息流转、harness 消息管理三类场景。
- 可以使用 attachment service 作为底层存储，但不得替代 attachment service 成为通用附件保存接口。
- 任何新增 semantic-transfer 调用必须声明 scenario/reason，并能映射到三类授权场景之一。
```

---

### 8.8 当前代码收口建议

1. 从 `runtime.sharedTools.semanticTransfer` 移除或隐藏：

```js
persistTransferArtifacts
persistTransferFile
materializeOutput
materializeOutputResult
```

2. 保留：

```js
transferToolMessage
transferSubAgentMessages
processStageMessage
composeFinalMessage
```

3. 普通附件保存改回：

```js
attachmentService.ingestGeneratedArtifacts(...)
```

4. finalizer 消费 transfer 时加白名单，例如：

```js
allowedReasons = [
  "tool_result_overflow",
  "tool_input_overflow",
  "workflow_node_agent_result",
  "workflow_subagent_result",
  "harness_stage_message",
  "harness_checklist"
]
```

5. 增加检查脚本：

- 禁止业务层直接调用 `semanticTransfer.persistTransfer*`。
- 禁止非白名单文件 import `persistTransferArtifacts`。
- 禁止普通附件场景输出 `transferEnvelope`。

---

### 8.9 最简结论

```text
附件系统管“保存什么文件”；semantic-transfer 管“这段信息如何在上下文链路中传递”。
```

- 如果附件是最终产物，走 attachment service。
- 如果附件是为了传递一段本应进入模型/agent 链路但过大/需隔离的信息，走 semantic-transfer。
