# Semantic Transfer 场景清单

本文档记录当前代码中实际经过 `@noobot/semantic-transfer-protocol` 的信息流。它是代码现状清单，不定义第二套协议；wire contract 仍以 `semantic-transfer-protocol/src/index.js` 为唯一规范。

## 1. 层级边界

| 层                           | 职责                                                             | 不负责                                    |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `attachment-protocol`        | 附件身份、descriptor、持久化记录、访问/UI 视图                   | transfer identity、方向、producer、intent |
| `semantic-transfer-protocol` | V2 envelope、场景白名单、工具入/出口策略、三种 payload、严格校验 | 文件系统、Session、路径解析               |
| `agent/src/transfer-adapter` | 将运行时内容物化为附件，并创建/消费 V2 envelope                  | 定义另一种 wire shape                     |
| `tool-runner`、插件运行时    | 选择场景、提供运行身份、传播 envelope                            | 自行构造附件身份或路径协议                |

唯一 envelope 字段为 `transferEnvelopes`。附件引用只携带 attachment-protocol identity 和不可变 descriptor 快照；不得携带 `path`、`relativePath`、`hostPath`、`sandboxPath` 或下载 URL。

## 2. Envelope 形态

当前只有三种 payload：

| mode               | 内容                    | 使用条件                                           |
| ------------------ | ----------------------- | -------------------------------------------------- |
| `direct`           | `payload.content`       | 内容允许直接进入语义传递，不需要附件持久化         |
| `attachment`       | `payload.attachments[]` | 内容需要持久化，或产物本身就是可展示文件           |
| `source_reference` | `payload.reference`     | 引用既有文件或附件的限定内容，不创建第二份附件事实 |

三种 mode 互斥。每个 envelope 必须包含 `transferId`、`messageId`、`sessionId`、producer、direction 和 intent。

## 3. 场景白名单

所有生产者在创建 envelope 前都必须通过 `semantic-transfer-protocol/src/registry.js` 注册。未注册场景、未注册 strategy、未注册工具输入策略或未注册工具出口策略直接失败，不降级、不推断、不走兼容分支。

| scenario   | 注册的 strategy                                 |
| ---------- | ----------------------------------------------- |
| `tool`     | `tool_input`、`tool_output`、`tool_result_text` |
| `workflow` | `workflow_subagent`、`workflow_final_plan`      |
| `harness`  | `harness_summary`                               |

## 4. 工具输入

入口：`agent/src/runtime/tool-execution/tool-runner.js` 调用 `transferSemanticContent({ scenario: "tool", strategy: "tool_input" })`。

| 工具             | 输入字段         | 触发条件                 | direction | 结果                                                              |
| ---------------- | ---------------- | ------------------------ | --------- | ----------------------------------------------------------------- |
| `write_file`     | `content`        | 超过 write-file 输入阈值 | `input`   | 保存完整输入并返回 attachment envelope；具体工具不执行            |
| `execute_script` | `command`        | 超过脚本输入阈值         | `input`   | 保存完整命令并返回 attachment envelope；具体工具不执行            |
| `search`         | `text`           | `source=text` 且超过阈值 | `input`   | 保存完整文本并返回 attachment envelope；具体工具不执行            |
| `patch_file`     | `patch`          | 超过 patch 阈值          | `input`   | 保存完整 patch 并返回 attachment envelope；具体工具不执行         |
| `task_summary`   | `summaryContent` | 强制附件策略             | `input`   | 保存小结内容，将 envelope 合并进工具结果后继续执行 `task_summary` |

工具名单、字段、阈值、强制附件条件、MIME、文件名和提示均由 protocol registry 持有。runner 只通过 `hasToolInputPolicy` 判断是否启用，再通过 `getToolInputPolicy` 获取策略；agent 内没有第二份工具输入名单或策略表。

## 5. 工具输出产物

入口：工具返回内部 `outputArtifacts`，`tool-runner` 在公共结果发布前统一消费。

```text
tool result.outputArtifacts
  -> parseToolOutputArtifacts
  -> persistTransferArtifacts
  -> attachment service
  -> V2 output attachment envelope
  -> stripToolOutputArtifacts
```

| 生产者                | 产物                                            | direction | 公共结果                                                                                |
| --------------------- | ----------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `write_file`          | `type=text`，写入后的文本文件内容               | `output`  | 只传播 runner 返回的 `transferEnvelopes`；不暴露 `outputArtifacts` 或顶层 `attachments` |
| `multimodal_generate` | `type=attachment_bytes`，生成图片的 base64 内容 | `output`  | 不检查文本长度，直接持久化为附件                                                        |
| 未来工具              | 必须先注册工具出口策略并声明 type               | `output`  | 统一走 runner 出口；未注册或 type 不匹配直接失败                                        |

出口类型只有三种：`text` 使用 UTF-8 文本；`attachment_url` 将 URL 作为文本处理；`attachment_bytes` 只接受 canonical base64 bytes，不做文本大小判断并直接保存附件。每个工具只能使用其注册的出口类型。

`outputArtifacts` 是 runner 内部工具结果契约，不是 Session、事件或前端协议。其唯一定义和剥离规则位于 `agent/src/tools/core/tool-json-result.js`。

## 6. 工具结果文本溢出

入口：每次工具执行结束后，runner 调用 `transferSemanticContent({ scenario: "tool", strategy: "tool_result_text" })`。

| 条件                   | 处理                                                                 | direction       |
| ---------------------- | -------------------------------------------------------------------- | --------------- |
| 工具结果文本未超过阈值 | 保持内联结果，不额外持久化                                           | 无新增 envelope |
| 工具结果文本超过阈值   | `normalizeToolResultOverflow` 保存完整结果，模型只接收压缩结果和引用 | `output`        |

该场景与 `outputArtifacts` 不同：前者保护工具 JSON 文本长度，后者表示工具明确生成的文件/图片资源。两者在 runner 汇总后按 `transferId` 去重。

## 7. 多模态解析

`multimodal_parse` 使用 `materializeTextForToolResult` 持久化 Markdown 解析结果，并把 V2 envelope 放入结构化工具结果。输入必须是逻辑 `filePath` 或完整的 `attachmentId + sessionId + attachmentSource`，允许直接传入图片、文档、音频和视频。接口适配器按运营商协议映射媒体内容；仅当具体模型不支持原格式时，才使用 `execute_native_script` 转换，成功输出的附件身份再传给多模态解析。

## 8. 脚本执行输出

| 场景                    | 代码入口                        | 处理                                                                     |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| 前台 stdout/stderr 溢出 | `script-tool/result-format.js`  | 读取完整输出文件，调用 `persistTransferArtifacts`，返回 output envelopes |
| 后台执行输出            | `script-tool/workspace-meta.js` | 将 stdout/stderr 作为产物持久化，返回 output envelopes                   |
| 普通短输出              | 普通工具 JSON                   | 不创建附件 envelope；仍受统一 `tool_result_text` 溢出检查                |

脚本工具不再返回顶层 `attachments` 镜像；Session 传输事实只来自 `transferEnvelopes`。

## 9. Workflow

统一 dispatcher 支持以下 strategy：

| strategy              | payload              | 用途                              |
| --------------------- | -------------------- | --------------------------------- |
| `workflow_subagent`   | direct 或 attachment | 子 Agent 结果、上游注入和失败传播 |
| `workflow_final_plan` | direct 或 attachment | 最终计划返回主流程                |

插件通过 `runtime.sharedTools.semanticTransfer.transferSemanticContent()` 调用统一入口。runtime builder 负责生成 identity，插件不得自行推测 Session 或 Turn identity。

detached 子 Session 返回时，从 canonical `turnMessages[*].transferEnvelopes` 聚合并按 `transferId` 去重；连接器访问已改为主链路直接调用，不再创建 detached 子 Session。

## 10. Harness

| strategy          | mode                                 | 用途                               |
| ----------------- | ------------------------------------ | ---------------------------------- |
| `harness_summary` | direct，必要时附加 detail attachment | 小结流程的阶段明细、注入和最终消息 |

阶段明细由 `plugin-stage-transfer.js` 物化；summary injection 可以同时产生一个 detail attachment envelope 和一个 direct summary envelope。

## 11. 异步协作任务

`wait_async_task_result` 可以携带子任务已经产生的 `transferEnvelopes`，并在容器结果中去重传播。普通异步任务附件保存仍由 attachment service 负责；只有已有 canonical semantic-transfer envelope 时才作为传输事实继续传播，不能从普通附件路径反向制造 envelope。

## 12. Runtime、Turn 和 Session 消费

| 阶段            | 文件/模块                                               | 行为                                                      |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| 工具状态提交    | `runtime/tool-execution/state-committer.js`             | 把 runner 返回的 envelopes 写入 tool-result message/event |
| Turn 持久化     | `bot/execution/turn-persister.js`                       | 严格校验并保存 message `transferEnvelopes`                |
| 最终消息        | `bot/execution/finalizer.js`                            | 聚合、去重并将允许展示的附件引用提升到最终 assistant      |
| Session 实体    | `session/entities/session-entity.js`                    | 规范化并保存 V2 envelopes                                 |
| Session summary | `session/session-summary-builders.js`                   | 从 envelopes 投影轻量附件引用和统计，不创建新身份         |
| 上下文恢复      | `context/assembly`、`session-execution-engine-utils.js` | 将既有 envelopes 无损带回运行上下文                       |

Session 中的普通用户上传附件仍属于 attachment-protocol 事实。只有发生语义传递时才出现 semantic-transfer envelope。

## 13. 前端消费

前端 `modules/chat/model/transferEnvelopes.js` 只接受 V2 envelope，并拒绝包含路径字段的对象。处理流程：

```text
message.transferEnvelopes
  -> validate/normalize V2 envelope
  -> project attachment identity and descriptor snapshot
  -> message UI attachment view
  -> attachment API 根据 identity 提供预览/下载能力
```

前端不得从 `resolvedPath`、工具日志或文件名推测 attachment identity。

## 14. 不经过 Semantic Transfer 的场景

以下场景本身只属于附件资源管理；除非随后发生明确语义传递，否则不创建 envelope：

- 用户上传、编辑、重发和删除附件。
- 邮件 connector 保存邮件附件。
- 普通 attachment parse-result 回写。
- Session 附件下载、预览、删除和访问授权。
- 仅用于存储审计或运行日志的文件。

判断规则不是“是否存在文件”，而是“该内容是否跨模型、工具、插件或子流程形成语义传递事实”。

## 15. 禁止模式

- 工具直接调用 attachment service 后返回顶层 `attachments` 作为第二传输事实。
- 从路径、文件名或 MIME 推测 attachment identity。
- 同时持久化独立 `attachments` 和 `transferEnvelopes`，再让消费者选择其一。
- 将 `outputArtifacts` 写入事件、Session、summary 或前端协议。
- 遇到非法 envelope 时降级、过滤成旧协议或从路径补全。
- 在工具、插件、Session 或前端重复实现 V2 envelope schema。

## 16. 主要代码索引

- Wire contract：`semantic-transfer-protocol/src/index.js`
- Attachment contract：`attachment-protocol/src/`
- 统一 dispatcher：`agent/src/transfer-adapter/transfer/semantic-transfer.js`
- Storage adapter：`agent/src/transfer-adapter/storage/attachment-adapter.js`
- 工具统一入口/出口：`agent/src/runtime/tool-execution/tool-runner.js`
- 内部工具产物契约：`agent/src/tools/core/tool-json-result.js`
- Turn 持久化：`agent/src/bot/execution/turn-persister.js`
- Session 投影：`agent/src/session/transfer-attachment-refs.js`
- 前端消费：`client/noobot-chat/src/modules/chat/model/transferEnvelopes.js`
